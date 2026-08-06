// ParkEasy design tokens — the single source of truth for spacing, type,
// colour, radii and elevation.
//
// These sit ON TOP of the CSS custom properties already in src/index.css
// (--ink, --sheet, --hairline, --surface-solid …). Those variables are what
// makes light mode work: every surface colour flips when data-theme changes.
// Replacing them with hard-coded hexes would have quietly broken light mode
// across the whole app, so the colour tokens below REFERENCE them rather than
// duplicating them. Only brand and semantic colours — which are the same in
// both themes — are literal values here.
//
// Import these instead of writing arbitrary values. If a component needs a
// number that isn't in a scale, the scale is probably wrong.

// ── Spacing ──────────────────────────────────────────────────────────────────
// Strict 8pt system. 2 and 4 exist because icon/label gaps genuinely need a
// half and quarter step; nothing smaller is permitted.
export const space = {
  0: '0px',
  0.5: '2px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '24px',
  6: '32px',
  7: '40px',
  8: '48px',
  9: '64px',
  10: '80px',
};

// ── Type ─────────────────────────────────────────────────────────────────────
// One family, three weights. `display` is the same family at heavier weights —
// a second font family is the fastest way to make a product look amateur.
export const font = {
  family: "'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif",
  weight: { regular: 400, semibold: 600, bold: 700, extrabold: 800 },
};

// Type scale with ROLES, not sizes. Components ask for `type.h1`, never 30px,
// so a change to the scale lands everywhere at once.
export const type = {
  hero:    { size: '32px', lineHeight: '36px', weight: 800, tracking: '-0.02em' },
  h1:      { size: '24px', lineHeight: '30px', weight: 800, tracking: '-0.01em' },
  h2:      { size: '19px', lineHeight: '24px', weight: 700, tracking: '-0.01em' },
  h3:      { size: '16px', lineHeight: '21px', weight: 700, tracking: '0' },
  body:    { size: '14px', lineHeight: '21px', weight: 400, tracking: '0' },
  bodySm:  { size: '13px', lineHeight: '19px', weight: 400, tracking: '0' },
  label:   { size: '12px', lineHeight: '16px', weight: 600, tracking: '0' },
  // Eyebrow/kicker text above headings. Uppercase is applied by the component,
  // not baked in, so screen readers still get the real string.
  overline:{ size: '11px', lineHeight: '14px', weight: 800, tracking: '0.16em' },
  caption: { size: '11px', lineHeight: '15px', weight: 500, tracking: '0' },
};

// ── Colour ───────────────────────────────────────────────────────────────────
// Brand and semantic values are literal (identical in both themes).
// Everything surface-related defers to the CSS variables so light mode works.
export const color = {
  brand:       '#2ED3C6',
  brandBright: '#5BE7DA',
  brandInk:    '#06231F',   // text ON brand — always this, never white
  brandGrad:   'linear-gradient(135deg, #54E6D8, #2ED3C6)',

  premium:     '#C9A7FF',
  premiumGrad: 'linear-gradient(135deg, #C9A7FF, #8B5CF6)',

  success: '#34E0A0',
  successBright: '#6BEFB9',
  warning: '#FFC24B',
  warningBright: '#FFD27A',
  danger:  '#FF5C5C',
  dangerBright: '#FF8A8A',

  // Theme-aware. Do not replace with hexes.
  ink:        'var(--ink)',
  inkMuted:   'rgba(234,241,248,0.62)',
  inkFaint:   'rgba(234,241,248,0.45)',
  surface:    'var(--surface-solid)',
  sheet:      'var(--sheet)',
  bg:         'var(--bg-solid)',
  hairline:   'var(--hairline)',
  float:      'var(--float)',
};

// ── Radii ────────────────────────────────────────────────────────────────────
export const radius = {
  sm: '8px', md: '12px', lg: '16px', xl: '20px', xxl: '24px', pill: '999px',
};

// ── Elevation ────────────────────────────────────────────────────────────────
// Four steps only. A shadow that isn't on this list is a shadow nobody chose.
export const elevation = {
  none: 'none',
  sm:  '0 1px 2px rgba(0,0,0,0.20)',
  md:  '0 4px 18px rgba(0,0,0,0.30)',
  lg:  '0 12px 40px rgba(0,0,0,0.50)',
  brandGlow: '0 6px 20px rgba(46,211,198,0.28)',
};

// ── Motion ───────────────────────────────────────────────────────────────────
// Press feedback is 0.985, not 0.95: a card that visibly shrinks feels like a
// toy. Durations are short enough that nothing feels like it's waiting.
export const motion = {
  fast: '120ms', base: '180ms', slow: '260ms',
  ease: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  pressScale: 0.985,
};

// Minimum tap target. 44px is the accessibility floor and this app is used
// one-handed, in the rain, next to moving traffic.
export const TAP_MIN = 44;

export default { space, font, type, color, radius, elevation, motion, TAP_MIN };
