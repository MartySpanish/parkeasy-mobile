// Operator / host surfaces — dashboard, listing wizard, availability calendar.
//
// SCAFFOLD: real components built on the design system, driven by props, with
// no data layer wired. They replace nothing. The live host experience
// (ListSpaceForm, HostEarnings, EventPricingPanel in App.jsx) keeps running
// until these are connected deliberately.
//
// Scaled to Belfast, not to AirGarage. We have two organisation hosts and a
// handful of driveways, so the useful things are: what did I earn, who is
// coming, and how do I block out a date. Occupancy heatmaps and dynamic
// pricing engines would be furniture nobody sits on.
import React, { useState } from 'react';
import {
  TrendingUp, Calendar, Car, ChevronLeft, ChevronRight, Check, PoundSterling, Users,
} from 'lucide-react';
import { space, color, radius, elevation } from '../../theme/tokens';
import { Text, Overline, Badge, Button, Card, SectionHeader, Skeleton, EmptyState } from '../ui';

const gbp = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;

// ── Dashboard ────────────────────────────────────────────────────────────────
const Metric = ({ label, value, sub, Icon, tone = 'brand', loading }) => (
  <Card style={{ flex: 1, minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[2] }}>
      <span style={{
        width: 28, height: 28, borderRadius: radius.sm, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        background: tone === 'premium' ? color.premiumGrad : color.brandGrad,
      }}>
        <Icon size={15} color={color.brandInk} strokeWidth={2.4} />
      </span>
      <Text role="caption" tone="faint">{label}</Text>
    </div>
    {loading
      ? <Skeleton height={26} width="60%" />
      : <Text role="h1" style={{ display: 'block' }}>{value}</Text>}
    {sub && <Text role="caption" tone="faint" style={{ display: 'block', marginTop: space[1] }}>{sub}</Text>}
  </Card>
);

export function HostDashboard({ loading, earnedPence, bookingsCount, spacesLive, upcoming = [], onOpenBooking }) {
  return (
    <div style={{ padding: space[4] }}>
      <SectionHeader overline="Your spaces" title="Dashboard" />

      <div style={{ display: 'flex', gap: space[3], marginBottom: space[3] }}>
        <Metric label="Earned" value={gbp(earnedPence)} sub="paid weekly by Stripe"
          Icon={PoundSterling} loading={loading} />
        <Metric label="Bookings" value={bookingsCount ?? 0} sub="all time"
          Icon={TrendingUp} loading={loading} />
      </div>
      <Metric label="Spaces live" value={spacesLive ?? 0} Icon={Car} loading={loading} />

      <SectionHeader overline="Next few days" title="Who's coming" style={{ marginTop: space[6] }} />
      {loading && <><Skeleton height={64} style={{ marginBottom: space[2] }} /><Skeleton height={64} /></>}

      {!loading && upcoming.length === 0 && (
        <EmptyState title="Nothing booked yet">
          Bookings appear here the moment someone pays. You&rsquo;ll get an email too, with the
          registration of the car so you know who has paid when they arrive.
        </EmptyState>
      )}

      {!loading && upcoming.map(b => (
        <Card key={b.id} interactive={!!onOpenBooking} onClick={() => onOpenBooking?.(b)}
          style={{ marginBottom: space[2], cursor: onOpenBooking ? 'pointer' : 'default' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text role="h3" style={{ display: 'block' }}>{b.spaceTitle}</Text>
              <Text role="caption" tone="faint" style={{ display: 'block', marginTop: space[1] }}>
                {b.when}{b.durationLabel ? ` · ${b.durationLabel}` : ''}
              </Text>
            </div>
            {/* The registration is the thing a marshal in a car park actually
                needs, so it gets the emphasis, not the money. */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <Text role="h3" style={{ display: 'block', letterSpacing: '0.08em' }}>{b.vehicleReg || '—'}</Text>
              <Text role="caption" tone="success" style={{ display: 'block' }}>{gbp(b.hostReceivesPence)} to you</Text>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Availability / pricing calendar ──────────────────────────────────────────
// A month grid where a host taps a date to block it out or set an event price.
// Blocking is the feature clubs actually asked for — clause 3 of the Davitt's
// agreement gives them an unconditional right to it, so it has to be one tap.
export function AvailabilityCalendar({ month = new Date(), blockedDates = [], priceOverrides = {}, onToggleBlock, onSetPrice }) {
  const [cursor, setCursor] = useState(new Date(month.getFullYear(), month.getMonth(), 1));
  const year = cursor.getFullYear(), m = cursor.getMonth();
  const first = new Date(year, m, 1);
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  // ISO weeks: Monday first, which is what a UK host expects.
  const lead = (first.getDay() + 6) % 7;
  const ymd = (d) => `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const blocked = new Set(blockedDates.map(String));

  return (
    <div style={{ padding: space[4] }}>
      <SectionHeader
        overline="Availability"
        title={cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        action={
          <div style={{ display: 'flex', gap: space[2] }}>
            <Button size="sm" variant="secondary" aria-label="Previous month"
              onClick={() => setCursor(new Date(year, m - 1, 1))}><ChevronLeft size={16} /></Button>
            <Button size="sm" variant="secondary" aria-label="Next month"
              onClick={() => setCursor(new Date(year, m + 1, 1))}><ChevronRight size={16} /></Button>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: space[1], marginBottom: space[2] }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} role="caption" tone="faint" style={{ textAlign: 'center' }}>{d}</Text>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: space[1] }}>
        {Array.from({ length: lead }).map((_, i) => <div key={`p${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1, key = ymd(day);
          const isBlocked = blocked.has(key);
          const override = priceOverrides[key];
          return (
            <button
              key={key}
              onClick={() => onToggleBlock?.(key)}
              onDoubleClick={() => onSetPrice?.(key)}
              className="pe-pressable"
              aria-label={`${key}${isBlocked ? ' — blocked' : ''}${override ? ` — £${override} event price` : ''}`}
              aria-pressed={isBlocked}
              style={{
                aspectRatio: '1', borderRadius: radius.md, cursor: 'pointer',
                background: isBlocked ? 'rgba(255,92,92,0.14)' : override ? 'rgba(255,194,75,0.14)' : color.surface,
                border: `1px solid ${isBlocked ? 'rgba(255,122,122,0.45)' : override ? 'rgba(255,194,75,0.40)' : color.hairline}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text role="label" tone={isBlocked ? 'danger' : override ? 'warning' : 'ink'}>{day}</Text>
              {override && <Text role="caption" tone="warning">£{override}</Text>}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: space[4], marginTop: space[4], flexWrap: 'wrap' }}>
        <Legend colour="rgba(255,92,92,0.45)" label="Blocked — not for sale" />
        <Legend colour="rgba(255,194,75,0.45)" label="Event price" />
      </div>
      <Text role="caption" tone="faint" style={{ display: 'block', marginTop: space[3] }}>
        Tap a date to block it out. Anyone already booked for that day is cancelled and refunded
        automatically, at our cost. Double-tap to set an event price.
      </Text>
    </div>
  );
}

const Legend = ({ colour, label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[2] }}>
    <span style={{ width: 10, height: 10, borderRadius: 3, background: colour }} />
    <Text role="caption" tone="faint">{label}</Text>
  </span>
);

// ── Listing wizard ───────────────────────────────────────────────────────────
// Multi-step because the single long form we have today is where hosts drop
// out: it asks for photos and pricing before it has told them what they'll
// earn. Steps are declared as data so the order can change without touching
// the component.
export const LISTING_STEPS = [
  { id: 'where',  title: 'Where is it?',        blurb: 'Address and how to find the entrance' },
  { id: 'what',   title: 'What are you letting?', blurb: 'Type, how many spaces, access hours' },
  { id: 'photos', title: 'Photos',              blurb: 'Two or more — the entrance and the bays' },
  { id: 'price',  title: 'Price',               blurb: 'What you charge, and event overrides' },
  { id: 'rules',  title: 'Rules & payouts',     blurb: 'Site rules, then your bank details' },
];

export function ListingWizard({ step = 0, onStep, onNext, onBack, onSubmit, children, canContinue = true, submitting }) {
  const current = LISTING_STEPS[step] || LISTING_STEPS[0];
  const last = step === LISTING_STEPS.length - 1;
  return (
    <div style={{ padding: space[4], display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Progress as segments rather than a percentage: a host wants to know
          how many more screens, not that they are 62% done. */}
      <div style={{ display: 'flex', gap: space[1], marginBottom: space[4] }}>
        {LISTING_STEPS.map((s, i) => (
          <button
            key={s.id} onClick={() => i < step && onStep?.(i)}
            aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === step ? 'step' : undefined}
            style={{
              flex: 1, height: 4, borderRadius: radius.pill, border: 0, padding: 0,
              cursor: i < step ? 'pointer' : 'default',
              background: i <= step ? color.brand : 'rgba(255,255,255,0.12)',
            }}
          />
        ))}
      </div>

      <Overline>Step {step + 1} of {LISTING_STEPS.length}</Overline>
      <Text as="h1" role="h1" style={{ display: 'block', marginTop: space[1] }}>{current.title}</Text>
      <Text role="bodySm" tone="muted" style={{ display: 'block', marginTop: space[2] }}>{current.blurb}</Text>

      <div style={{ flex: 1, marginTop: space[5] }}>{children}</div>

      <div style={{ display: 'flex', gap: space[3], marginTop: space[5] }}>
        {step > 0 && <Button variant="secondary" onClick={onBack} style={{ flex: 1 }}>Back</Button>}
        <Button
          variant="primary" style={{ flex: 2 }} loading={submitting} disabled={!canContinue || submitting}
          onClick={last ? onSubmit : onNext}
        >
          {last ? <><Check size={16} />Submit for review</> : <>Continue<ChevronRight size={16} /></>}
        </Button>
      </div>
    </div>
  );
}

export default { HostDashboard, AvailabilityCalendar, ListingWizard, LISTING_STEPS };
