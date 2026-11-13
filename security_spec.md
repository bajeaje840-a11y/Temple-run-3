# Firestore Security Specification — Temple Run 3: Lost Kingdom

## 1. Data Invariants
1. **Default Deny**: Any collection or document not explicitly matched under `/saves/{userId}` or `/leaderboard/{userId}` MUST be denied (`allow read, write: if false`).
2. **Owner-Only Cloud Saves (`/saves/{userId}`)**:
   - No `list` queries allowed (`allow list: if false`).
   - Only the verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`) may `get`, `create`, `update`, or `delete` their own `/saves/{userId}` document.
   - `userId` must pass `isValidId(userId)` (`^[a-zA-Z0-9_\-]+$`, length `<= 128`).
   - `ownerId` is immutable after creation (`incoming().ownerId == existing().ownerId == request.auth.uid`).
   - All numeric counters (`version`, `highScore`, `bestDistance`, `coins`, `total*`, `runsPlayed`) must be non-negative integers within finite sane bounds.
   - All arrays (`unlockedCharacters`, `unlockedBiomes`, `completedMissions`, `unlockedAchievements`, `dailyMissions.missions`) are strictly size-bounded and type-checked on index `0` when non-empty.
   - `updatedAt` MUST be a timestamp within ±10 seconds of `request.time` on both `create` and `update`.
   - No extra/ghost fields are permitted (`hasAll` + `hasOnly` on `create`; `affectedKeys().hasOnly(...)` on `update`).
3. **PII-Free Global Leaderboard (`/leaderboard/{userId}`)**:
   - Contains ZERO PII (no `email`, `phone`, `address`, or private auth tokens).
   - `get` and `list` require authentication and evaluate `resource.data.highScore >= 0` plus `request.query.limit <= 50` (matching client query `where('highScore', '>=', 0), orderBy('highScore', 'desc'), limit(20)`). Zero `get()` or `exists()` calls inside `allow list`.
   - `create` and `update` require `isVerifiedUser()`, `isValidId(userId)`, `request.auth.uid == userId`, `incoming().uid == request.auth.uid`, valid bounded `displayName` (`1..48` chars), valid hero ID enum, non-negative integer `highScore`/`bestDistance`, and `updatedAt` within ±10 seconds of `request.time`.
   - `uid` is immutable on update (`incoming().uid == existing().uid`).

## 2. The "Dirty Dozen" Attack Payloads
1. **Unauthenticated Write to `/saves/alice`**: `request.auth == null` attempting `create` on `/saves/alice` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: `request.auth = { uid: 'alice', token: { email_verified: false } }` creating `/saves/alice` -> `PERMISSION_DENIED`.
3. **Cross-User Save Read/Write (IDOR)**: `bob` attempting `get` or `update` on `/saves/alice` -> `PERMISSION_DENIED`.
4. **Save Collection Scraping (`list`)**: `alice` attempting `list` on `/saves` -> `PERMISSION_DENIED`.
5. **Shadow / Ghost Field Injection on `/saves/alice`**: Valid save payload plus `{ isAdmin: true, role: 'superadmin' }` -> `PERMISSION_DENIED`.
6. **Identity Spoofing on `/saves/alice`**: `alice` writing `{ ownerId: 'bob', ... }` -> `PERMISSION_DENIED`.
7. **Malicious Path ID Poisoning**: Attempting write to `/saves/${'a'.repeat(200)}` or `/leaderboard/bad$id` -> `PERMISSION_DENIED`.
8. **Client Timestamp Forgery**: Payload with `updatedAt: new Date('2099-01-01')` instead of `request.time` -> `PERMISSION_DENIED`.
9. **Array Resource Exhaustion / Type Poisoning**: `/saves/alice` with `completedMissions: [123]` or `completedMissions` of length `31` -> `PERMISSION_DENIED`.
10. **Negative Coin / Score Underflow**: `/saves/alice` with `coins: -500` or `/leaderboard/alice` with `highScore: -1` -> `PERMISSION_DENIED`.
11. **Leaderboard Display Name Overflow / PII Leak**: `/leaderboard/alice` with `displayName` of `100` chars or extra field `email: 'a@b.com'` -> `PERMISSION_DENIED`.
12. **Blanket Unfiltered Leaderboard List**: Unauthenticated client or missing/invalid `resource.data` constraint check on `/leaderboard` -> `PERMISSION_DENIED`.
