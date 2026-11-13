export function createTitleLockupSvg(): string {
  return `
    <svg viewBox="0 0 620 175" style="width:100%;height:auto;display:block" role="img" aria-label="Temple Run 3: Lost Kingdom" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="goldStone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fff0a6"/>
          <stop offset="48%" stop-color="#eab32e"/>
          <stop offset="100%" stop-color="#915709"/>
        </linearGradient>
        <linearGradient id="jadeStone" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#2fd69d"/>
          <stop offset="100%" stop-color="#8bf5d1"/>
        </linearGradient>
      </defs>

      <!-- Carved Temple Crest Emblem -->
      <g transform="translate(14, 22)">
        <polygon points="48,4 92,30 78,94 18,94 4,30" fill="#18201c" stroke="#eab32e" stroke-width="3.5"/>
        <polygon points="48,14 78,34 68,82 28,82 18,34" fill="#10362a" stroke="#2fd69d" stroke-width="2"/>
        <circle cx="36" cy="48" r="5" fill="#ffd95a"/>
        <circle cx="60" cy="48" r="5" fill="#ffd95a"/>
        <polygon points="48,56 54,70 42,70" fill="#eab32e"/>
        <path d="M30 76 H66" stroke="#ffd95a" stroke-width="3" stroke-linecap="round"/>
      </g>

      <!-- Main Title Typography -->
      <text x="122" y="80" fill="#140c02" stroke="#140c02" stroke-width="10" stroke-linejoin="round"
            font-family="'Cinzel', Georgia, serif" font-weight="900" font-size="48" letter-spacing="2">
        TEMPLE RUN
      </text>
      <text x="122" y="80" fill="url(#goldStone)"
            font-family="'Cinzel', Georgia, serif" font-weight="900" font-size="48" letter-spacing="2">
        TEMPLE RUN
      </text>

      <!-- Numeral 3 Badge -->
      <g transform="translate(548, 34)">
        <polygon points="24,0 48,14 48,42 24,56 0,42 0,14" fill="#1b2620" stroke="#ffd95a" stroke-width="3"/>
        <text x="24" y="38" text-anchor="middle" fill="#ffd95a"
              font-family="'Cinzel', Georgia, serif" font-weight="900" font-size="30">3</text>
      </g>

      <!-- Subtitle Bar -->
      <path d="M124 98 H596" stroke="#e6a825" stroke-width="2" stroke-opacity="0.75"/>
      <text x="126" y="132" fill="#09130f" stroke="#09130f" stroke-width="6" stroke-linejoin="round"
            font-family="'Cinzel', Georgia, serif" font-weight="700" font-size="25" letter-spacing="8">
        LOST KINGDOM
      </text>
      <text x="126" y="132" fill="url(#jadeStone)"
            font-family="'Cinzel', Georgia, serif" font-weight="700" font-size="25" letter-spacing="8">
        LOST KINGDOM
      </text>
    </svg>
  `;
}

export function svgCoin(size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#e6a825" stroke="#523204" stroke-width="2"/>
    <circle cx="12" cy="12" r="7" fill="#ffd95a"/>
    <polygon points="12,7 16,12 12,17 8,12" fill="#b4700a"/>
  </svg>`;
}

export function svgIcon(
  name:
    | 'play'
    | 'pause'
    | 'volume'
    | 'mute'
    | 'character'
    | 'shop'
    | 'mission'
    | 'settings'
    | 'magnet'
    | 'shield'
    | 'multiplier'
    | 'boost'
    | 'invincibility'
    | 'close'
    | 'trophy'
    | 'cloud',
  size = 20
): string {
  const paths: Record<typeof name, string> = {
    play: '<polygon points="6,4 20,12 6,20" fill="currentColor"/>',
    pause:
      '<rect x="6" y="4" width="4.5" height="16" rx="1" fill="currentColor"/><rect x="13.5" y="4" width="4.5" height="16" rx="1" fill="currentColor"/>',
    volume:
      '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    mute:
      '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    character:
      '<circle cx="12" cy="7.5" r="4" fill="currentColor"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5" fill="currentColor"/>',
    shop:
      '<path d="M4 7h16l-1.5 13h-13L4 7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 7V5.5a3.5 3.5 0 0 1 7 0V7" stroke="currentColor" stroke-width="2"/>',
    mission:
      '<path d="M5 4h14v16l-7-4-7 4V4z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.2" fill="currentColor"/>',
    settings:
      '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    magnet:
      '<path d="M6 4v8a6 6 0 0 0 12 0V4h-3.5v8a2.5 2.5 0 0 1-5 0V4H6z" fill="currentColor"/>',
    shield:
      '<path d="M12 3l8 3.5v5.5c0 4.6-3.4 8.5-8 9.8-4.6-1.3-8-5.2-8-9.8V6.5L12 3z" fill="currentColor"/>',
    multiplier:
      '<polygon points="12,3 15,9 21,9.8 16.5,14 17.6,20 12,17 6.4,20 7.5,14 3,9.8 9,9" fill="currentColor"/>',
    boost: '<path d="M13 2L4 14h6l-1 8 11-12h-6l-1-8z" fill="currentColor"/>',
    invincibility:
      '<circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    close:
      '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    trophy:
      '<path d="M6 4h12v4a6 6 0 0 1-12 0V4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 6H3.5a1.5 1.5 0 0 0-1.5 1.5v1A3.5 3.5 0 0 0 5.5 12H6M18 6h2.5A1.5 1.5 0 0 1 22 7.5v1a3.5 3.5 0 0 1-3.5 3.5H18" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 14v4M8.5 20h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    cloud:
      '<path d="M7 18h10a4 4 0 0 0 .8-7.92A5.5 5.5 0 0 0 7.2 8.6 4.2 4.2 0 0 0 7 18z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  };

  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths[name]}</svg>`;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
