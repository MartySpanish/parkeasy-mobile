// ParkEasy UI primitives.
//
// Every screen composes from these rather than writing its own padding and
// shadows. The app before this had ~40 hand-rolled button styles; the point of
// this file is that there is now one, and changing it changes all of them.
//
// Styling uses inline style objects driven by tokens, not Tailwind classes,
// for anything token-derived. That is deliberate: Tailwind's arbitrary-value
// syntax (`text-[13.5px]`) is exactly how the drift happened in the first
// place, and a value that must come from the scale should be impossible to
// type by hand.
import React from 'react';
import { space, type, color, radius, elevation, motion, TAP_MIN } from '../../theme/tokens';

const typeStyle = (role) => {
  const t = type[role] || type.body;
  return { fontSize: t.size, lineHeight: t.lineHeight, fontWeight: t.weight, letterSpacing: t.tracking };
};

// ── Text ─────────────────────────────────────────────────────────────────────
export const Text = ({ as: As = 'span', role = 'body', tone = 'ink', style, children, ...rest }) => {
  const tones = { ink: color.ink, muted: color.inkMuted, faint: color.inkFaint,
                  brand: color.brandBright, premium: color.premium,
                  success: color.successBright, warning: color.warningBright, danger: color.dangerBright };
  return (
    <As style={{ ...typeStyle(role), color: tones[tone] || tones.ink, ...style }} {...rest}>
      {children}
    </As>
  );
};

// Small uppercase kicker. The transform is CSS so assistive tech reads the
// original string rather than a shouted one.
export const Overline = ({ tone = 'brand', style, children, ...rest }) => (
  <Text role="overline" tone={tone} style={{ textTransform: 'uppercase', display: 'block', ...style }} {...rest}>
    {children}
  </Text>
);

// ── Button ───────────────────────────────────────────────────────────────────
const BUTTON_VARIANTS = {
  primary:   { background: color.brandGrad, color: color.brandInk, border: '1px solid transparent', boxShadow: elevation.brandGlow },
  premium:   { background: color.premiumGrad, color: color.brandInk, border: '1px solid transparent', boxShadow: elevation.md },
  secondary: { background: 'rgba(255,255,255,0.08)', color: color.ink, border: `1px solid ${color.hairline}`, boxShadow: 'none' },
  ghost:     { background: 'transparent', color: color.brandBright, border: '1px solid transparent', boxShadow: 'none' },
  danger:    { background: 'rgba(255,92,92,0.12)', color: color.dangerBright, border: '1px solid rgba(255,92,92,0.40)', boxShadow: 'none' },
};

const BUTTON_SIZES = {
  sm: { padding: `${space[2]} ${space[3]}`, ...typeStyle('label'), minHeight: 36 },
  md: { padding: `${space[3]} ${space[4]}`, ...typeStyle('h3'),    minHeight: TAP_MIN },
  lg: { padding: `${space[4]} ${space[5]}`, ...typeStyle('h3'),    minHeight: 52 },
};

export const Button = ({
  variant = 'primary', size = 'md', full, loading, disabled,
  leftIcon, rightIcon, as, href, style, children, ...rest
}) => {
  const As = as || (href ? 'a' : 'button');
  const isOff = disabled || loading;
  return (
    <As
      href={href}
      disabled={As === 'button' ? isOff : undefined}
      aria-busy={loading || undefined}
      className="pe-pressable"
      style={{
        ...BUTTON_VARIANTS[variant], ...BUTTON_SIZES[size],
        width: full ? '100%' : undefined,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: space[2],
        borderRadius: radius.lg, cursor: isOff ? 'not-allowed' : 'pointer',
        opacity: isOff ? 0.55 : 1, textDecoration: 'none',
        transition: `transform ${motion.fast} ${motion.ease}, opacity ${motion.fast} ${motion.ease}`,
        ...style,
      }}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </As>
  );
};

// ── Card ─────────────────────────────────────────────────────────────────────
export const Card = ({ interactive, padded = true, tone = 'surface', style, children, ...rest }) => {
  const tones = {
    surface: { background: color.surface, border: `1px solid ${color.hairline}` },
    sheet:   { background: color.sheet,   border: `1px solid ${color.hairline}` },
    brand:   { background: 'linear-gradient(135deg, rgba(46,211,198,0.14), rgba(91,231,218,0.06))', border: '1px solid rgba(91,231,218,0.32)' },
    premium: { background: 'linear-gradient(135deg, rgba(201,167,255,0.16), rgba(91,231,218,0.08))', border: '1px solid rgba(201,167,255,0.35)' },
    warning: { background: 'rgba(255,194,75,0.10)', border: '1px solid rgba(255,194,75,0.30)' },
    danger:  { background: 'rgba(255,92,92,0.10)',  border: '1px solid rgba(255,122,122,0.35)' },
  };
  return (
    <div
      className={interactive ? 'pe-pressable' : undefined}
      style={{
        ...tones[tone], borderRadius: radius.xl, padding: padded ? space[4] : 0,
        boxShadow: elevation.sm, overflow: 'hidden',
        transition: `transform ${motion.fast} ${motion.ease}, border-color ${motion.base} ${motion.ease}`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
};

// ── Badge ────────────────────────────────────────────────────────────────────
export const Badge = ({ tone = 'neutral', style, children, ...rest }) => {
  const tones = {
    neutral: { background: 'rgba(255,255,255,0.10)', color: color.inkMuted },
    brand:   { background: color.brandGrad, color: color.brandInk },
    premium: { background: color.premiumGrad, color: color.brandInk },
    success: { background: 'rgba(52,224,160,0.15)', color: color.successBright },
    warning: { background: 'rgba(255,194,75,0.15)', color: color.warningBright },
    danger:  { background: 'rgba(255,92,92,0.15)',  color: color.dangerBright },
  };
  return (
    <span style={{
      ...tones[tone], ...typeStyle('overline'), textTransform: 'uppercase',
      padding: `${space[1]} ${space[2]}`, borderRadius: radius.pill,
      display: 'inline-flex', alignItems: 'center', gap: space[1], whiteSpace: 'nowrap', ...style,
    }} {...rest}>{children}</span>
  );
};

// ── Section header ───────────────────────────────────────────────────────────
export const SectionHeader = ({ overline, title, action, style }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                gap: space[3], marginBottom: space[3], ...style }}>
    <div style={{ minWidth: 0 }}>
      {overline && <Overline>{overline}</Overline>}
      {title && <Text as="h2" role="h2" style={{ display: 'block', marginTop: overline ? space[1] : 0 }}>{title}</Text>}
    </div>
    {action}
  </div>
);

// ── Feedback ─────────────────────────────────────────────────────────────────
export const Spinner = ({ size = 18, tone = 'ink' }) => (
  <span
    role="status" aria-label="Loading"
    style={{
      width: size, height: size, borderRadius: '50%', display: 'inline-block',
      border: `2px solid ${tone === 'ink' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)'}`,
      borderTopColor: tone === 'ink' ? color.brandBright : color.brandInk,
      animation: 'pe-spin 700ms linear infinite',
    }}
  />
);

// Skeletons match the shape of what is coming, not a generic grey box — a
// placeholder that is the wrong size makes the page jump when data lands.
export const Skeleton = ({ height = 16, width = '100%', radius: r = radius.sm, style }) => (
  <div aria-hidden style={{
    height, width, borderRadius: r, background: 'rgba(255,255,255,0.07)',
    backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0) 100%)',
    backgroundSize: '200% 100%', animation: 'pe-shimmer 1.3s ease-in-out infinite', ...style,
  }} />
);

export const SkeletonCard = () => (
  <Card padded={false} style={{ marginBottom: space[3] }}>
    <Skeleton height={132} radius="0" />
    <div style={{ padding: space[4] }}>
      <Skeleton height={18} width="70%" />
      <Skeleton height={13} width="45%" style={{ marginTop: space[2] }} />
      <Skeleton height={13} width="60%" style={{ marginTop: space[2] }} />
    </div>
  </Card>
);

// One banner for every success / warning / error state, so the app speaks with
// one voice. `action` is for recovery — an error with no way forward is just
// bad news.
export const Banner = ({ tone = 'success', title, children, action, onDismiss, style }) => (
  <Card tone={tone === 'success' ? 'brand' : tone} style={{ ...style }}>
    <div style={{ display: 'flex', gap: space[3], alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <Text role="h3" style={{ display: 'block' }}>{title}</Text>}
        {children && <Text role="bodySm" tone="muted" style={{ display: 'block', marginTop: title ? space[1] : 0 }}>{children}</Text>}
        {action && <div style={{ marginTop: space[3] }}>{action}</div>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss"
          style={{ background: 'rgba(255,255,255,0.10)', border: 0, borderRadius: radius.pill,
                   width: 24, height: 24, color: color.inkFaint, cursor: 'pointer', flexShrink: 0 }}>×</button>
      )}
    </div>
  </Card>
);

export const EmptyState = ({ icon, title, children, action }) => (
  <div style={{ textAlign: 'center', padding: `${space[8]} ${space[4]}` }}>
    {icon && <div style={{ marginBottom: space[3], opacity: 0.7 }}>{icon}</div>}
    <Text role="h3" style={{ display: 'block' }}>{title}</Text>
    {children && <Text role="bodySm" tone="muted" style={{ display: 'block', marginTop: space[2] }}>{children}</Text>}
    {action && <div style={{ marginTop: space[4] }}>{action}</div>}
  </div>
);

export { space, type, color, radius, elevation, motion } from '../../theme/tokens';
