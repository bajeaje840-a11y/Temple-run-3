import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Security Rules Specification Verifier for Temple Run 3: Lost Kingdom.
 * Models the exact boolean invariants enforced in /firestore.rules against
 * all 12 Dirty Dozen attack payloads and valid client payloads.
 */

const REQUEST_TIME_MS = Date.UTC(2026, 10, 13, 18, 0, 0);
const SERVER_TIME = new Date(REQUEST_TIME_MS);

interface AuthContext {
  uid: string;
  token: { email_verified: boolean };
}

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}

function isNonNegInt(val: unknown, maxVal: number): val is number {
  return typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= maxVal;
}

function isValidServerTimestamp(ts: unknown): boolean {
  if (!(ts instanceof Date) || Number.isNaN(ts.getTime())) return false;
  const delta = Math.abs(ts.getTime() - REQUEST_TIME_MS);
  return delta <= 10_000;
}

function isValidPlayerSave(data: Record<string, unknown>, auth: AuthContext | null): boolean {
  if (!auth) return false;
  const required = [
    'ownerId', 'version', 'highScore', 'bestDistance', 'coins',
    'totalCoinsCollected', 'totalDistance', 'totalJumps', 'totalSlides',
    'totalPowerUps', 'runsPlayed', 'selectedCharacter', 'unlockedCharacters',
    'selectedStartBiome', 'unlockedBiomes', 'upgradeLevels',
    'completedMissions', 'unlockedAchievements', 'dailyMissions',
    'settings', 'updatedAt',
  ];
  const keys = Object.keys(data);
  if (!required.every((k) => keys.includes(k))) return false;
  if (!keys.every((k) => required.includes(k))) return false;
  if (!isValidId(data.ownerId) || data.ownerId !== auth.uid) return false;
  if (!isNonNegInt(data.version, 100) || (data.version as number) < 1) return false;
  if (!isNonNegInt(data.highScore, 1_000_000_000)) return false;
  if (!isNonNegInt(data.bestDistance, 100_000_000)) return false;
  if (!isNonNegInt(data.coins, 100_000_000)) return false;
  if (!Array.isArray(data.unlockedCharacters) || data.unlockedCharacters.length < 1 || data.unlockedCharacters.length > 10) return false;
  if (typeof data.unlockedCharacters[0] !== 'string' || data.unlockedCharacters[0].length < 1 || data.unlockedCharacters[0].length > 32) return false;
  if (!Array.isArray(data.unlockedBiomes) || data.unlockedBiomes.length < 1 || data.unlockedBiomes.length > 10) return false;
  if (!Array.isArray(data.completedMissions) || data.completedMissions.length > 30) return false;
  if (data.completedMissions.length > 0 && (typeof data.completedMissions[0] !== 'string' || data.completedMissions[0].length > 48)) return false;
  if (!Array.isArray(data.unlockedAchievements) || data.unlockedAchievements.length > 30) return false;
  if (data.updatedAt !== SERVER_TIME && !isValidServerTimestamp(data.updatedAt)) return false;
  return true;
}

function isValidLeaderboardEntry(data: Record<string, unknown>, auth: AuthContext | null): boolean {
  if (!auth) return false;
  const required = ['uid', 'displayName', 'selectedCharacter', 'highScore', 'bestDistance', 'updatedAt'];
  const keys = Object.keys(data);
  if (!required.every((k) => keys.includes(k)) || !keys.every((k) => required.includes(k))) return false;
  if (!isValidId(data.uid) || data.uid !== auth.uid) return false;
  if (typeof data.displayName !== 'string' || data.displayName.length < 1 || data.displayName.length > 48) return false;
  if (!['aurelia', 'cross', 'kael', 'solara'].includes(String(data.selectedCharacter))) return false;
  if (!isNonNegInt(data.highScore, 1_000_000_000)) return false;
  if (!isNonNegInt(data.bestDistance, 100_000_000)) return false;
  if (!isValidServerTimestamp(data.updatedAt)) return false;
  return true;
}

function evaluateRule(params: {
  collection: 'saves' | 'leaderboard' | 'other';
  op: 'get' | 'list' | 'create' | 'update';
  docId?: string;
  auth: AuthContext | null;
  incoming?: Record<string, unknown>;
  existing?: Record<string, unknown> | null;
  queryLimit?: number;
}): 'ALLOW' | 'PERMISSION_DENIED' {
  const { collection, op, docId = '', auth, incoming = {}, existing = null, queryLimit = 20 } = params;
  const isSignedIn = auth !== null;
  const isVerified = isSignedIn && auth.token.email_verified === true;

  if (collection === 'other') return 'PERMISSION_DENIED';

  if (collection === 'saves') {
    if (op === 'list') return 'PERMISSION_DENIED';
    if (!isSignedIn || !isValidId(docId) || auth.uid !== docId) return 'PERMISSION_DENIED';
    if (op === 'get') return 'ALLOW';
    if (!isVerified) return 'PERMISSION_DENIED';
    if (!isValidPlayerSave(incoming, auth)) return 'PERMISSION_DENIED';
    if (op === 'update' && existing && incoming.ownerId !== existing.ownerId) return 'PERMISSION_DENIED';
    return 'ALLOW';
  }

  if (collection === 'leaderboard') {
    if (op === 'get') {
      if (!isSignedIn || !isValidId(docId)) return 'PERMISSION_DENIED';
      if (existing !== null && (typeof existing.highScore !== 'number' || existing.highScore < 0)) return 'PERMISSION_DENIED';
      return 'ALLOW';
    }
    if (op === 'list') {
      if (!isSignedIn || !existing || typeof existing.highScore !== 'number' || existing.highScore < 0 || queryLimit > 50) return 'PERMISSION_DENIED';
      return 'ALLOW';
    }
    if (!isVerified || !isValidId(docId) || auth.uid !== docId) return 'PERMISSION_DENIED';
    if (!isValidLeaderboardEntry(incoming, auth)) return 'PERMISSION_DENIED';
    if (op === 'update' && existing) {
      if (incoming.uid !== existing.uid) return 'PERMISSION_DENIED';
      if ((incoming.highScore as number) < (existing.highScore as number)) return 'PERMISSION_DENIED';
      if ((incoming.bestDistance as number) < (existing.bestDistance as number)) return 'PERMISSION_DENIED';
    }
    return 'ALLOW';
  }

  return 'PERMISSION_DENIED';
}

function validSavePayload(uid = 'alice'): Record<string, unknown> {
  return {
    ownerId: uid,
    version: 1,
    highScore: 1500,
    bestDistance: 320,
    coins: 200,
    totalCoinsCollected: 250,
    totalDistance: 500,
    totalJumps: 20,
    totalSlides: 10,
    totalPowerUps: 3,
    runsPlayed: 2,
    selectedCharacter: 'aurelia',
    unlockedCharacters: ['aurelia'],
    selectedStartBiome: 'jungle_temple',
    unlockedBiomes: ['jungle_temple'],
    upgradeLevels: { magnet: 1, shield: 1, multiplier: 1, boost: 1, invincibility: 1 },
    completedMissions: ['m_dist_200'],
    unlockedAchievements: ['a_first_run'],
    dailyMissions: { dateKey: '2026-11-13', missions: [] },
    settings: { quality: 'high', musicVolume: 0.55, sfxVolume: 0.75, muted: false },
    updatedAt: SERVER_TIME,
  };
}

function validLeaderboardPayload(uid = 'alice'): Record<string, unknown> {
  return {
    uid,
    displayName: 'Explorer Alice',
    selectedCharacter: 'aurelia',
    highScore: 1500,
    bestDistance: 320,
    updatedAt: SERVER_TIME,
  };
}

test('firestore.rules file exists and enforces default deny + verified users', () => {
  const rulesText = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
  assert.ok(rulesText.includes("rules_version = '2';"));
  assert.ok(rulesText.includes('allow read, write: if false;'));
  assert.ok(rulesText.includes('request.auth.token.email_verified == true'));
  assert.ok(rulesText.includes('match /saves/{userId}'));
  assert.ok(rulesText.includes('match /leaderboard/{userId}'));
});

test('Dirty Dozen security payloads all return PERMISSION_DENIED and legitimate writes ALLOW', () => {
  const aliceAuth: AuthContext = { uid: 'alice', token: { email_verified: true } };
  const bobAuth: AuthContext = { uid: 'bob', token: { email_verified: true } };
  const unverifiedAlice: AuthContext = { uid: 'alice', token: { email_verified: false } };

  // 1. Unauthenticated write
  assert.equal(
    evaluateRule({ collection: 'saves', op: 'create', docId: 'alice', auth: null, incoming: validSavePayload('alice') }),
    'PERMISSION_DENIED'
  );

  // 2. Unverified email write
  assert.equal(
    evaluateRule({ collection: 'saves', op: 'create', docId: 'alice', auth: unverifiedAlice, incoming: validSavePayload('alice') }),
    'PERMISSION_DENIED'
  );

  // 3. Cross-user save IDOR
  assert.equal(
    evaluateRule({ collection: 'saves', op: 'get', docId: 'alice', auth: bobAuth }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateRule({ collection: 'saves', op: 'update', docId: 'alice', auth: bobAuth, incoming: validSavePayload('alice'), existing: validSavePayload('alice') }),
    'PERMISSION_DENIED'
  );

  // 4. Save collection scraping (list)
  assert.equal(
    evaluateRule({ collection: 'saves', op: 'list', auth: aliceAuth }),
    'PERMISSION_DENIED'
  );

  // 5. Shadow / Ghost field injection
  assert.equal(
    evaluateRule({
      collection: 'saves',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: { ...validSavePayload('alice'), isAdmin: true },
    }),
    'PERMISSION_DENIED'
  );

  // 6. Identity spoofing
  assert.equal(
    evaluateRule({
      collection: 'saves',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: validSavePayload('bob'),
    }),
    'PERMISSION_DENIED'
  );

  // 7. Malicious path ID poisoning
  assert.equal(
    evaluateRule({
      collection: 'saves',
      op: 'create',
      docId: 'a'.repeat(200),
      auth: aliceAuth,
      incoming: validSavePayload('alice'),
    }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateRule({
      collection: 'leaderboard',
      op: 'create',
      docId: 'bad$id',
      auth: aliceAuth,
      incoming: validLeaderboardPayload('alice'),
    }),
    'PERMISSION_DENIED'
  );

  // 8. Client timestamp forgery
  assert.equal(
    evaluateRule({
      collection: 'saves',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: { ...validSavePayload('alice'), updatedAt: new Date('2099-01-01') },
    }),
    'PERMISSION_DENIED'
  );

  // 9. Array exhaustion / index 0 type poisoning
  assert.equal(
    evaluateRule({
      collection: 'saves',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: { ...validSavePayload('alice'), completedMissions: [123] },
    }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateRule({
      collection: 'saves',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: { ...validSavePayload('alice'), completedMissions: Array.from({ length: 31 }, (_, i) => `m_${i}`) },
    }),
    'PERMISSION_DENIED'
  );

  // 10. Negative coin / score underflow
  assert.equal(
    evaluateRule({
      collection: 'saves',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: { ...validSavePayload('alice'), coins: -500 },
    }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateRule({
      collection: 'leaderboard',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: { ...validLeaderboardPayload('alice'), highScore: -1 },
    }),
    'PERMISSION_DENIED'
  );

  // 11. Leaderboard displayName overflow & PII injection
  assert.equal(
    evaluateRule({
      collection: 'leaderboard',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: { ...validLeaderboardPayload('alice'), displayName: 'x'.repeat(100) },
    }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateRule({
      collection: 'leaderboard',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: { ...validLeaderboardPayload('alice'), email: 'alice@example.com' },
    }),
    'PERMISSION_DENIED'
  );

  // 12. Blanket unauthenticated or invalid leaderboard list
  assert.equal(
    evaluateRule({
      collection: 'leaderboard',
      op: 'list',
      auth: null,
      existing: validLeaderboardPayload('alice'),
    }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateRule({
      collection: 'leaderboard',
      op: 'list',
      auth: aliceAuth,
      existing: { highScore: -5 },
    }),
    'PERMISSION_DENIED'
  );

  // Legitimate verified owner writes (including sub-second serverTimestamp skew) & reads ALLOW
  assert.equal(
    evaluateRule({
      collection: 'saves',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: { ...validSavePayload('alice'), updatedAt: new Date(REQUEST_TIME_MS + 250) },
    }),
    'ALLOW'
  );
  assert.equal(
    evaluateRule({
      collection: 'saves',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: { ...validSavePayload('alice'), updatedAt: new Date(REQUEST_TIME_MS + 30_000) },
    }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateRule({
      collection: 'leaderboard',
      op: 'create',
      docId: 'alice',
      auth: aliceAuth,
      incoming: validLeaderboardPayload('alice'),
    }),
    'ALLOW'
  );
  assert.equal(
    evaluateRule({
      collection: 'leaderboard',
      op: 'list',
      auth: aliceAuth,
      existing: validLeaderboardPayload('alice'),
    }),
    'ALLOW'
  );
  assert.equal(
    evaluateRule({
      collection: 'leaderboard',
      op: 'list',
      auth: aliceAuth,
      existing: validLeaderboardPayload('alice'),
      queryLimit: 100,
    }),
    'PERMISSION_DENIED'
  );
});
