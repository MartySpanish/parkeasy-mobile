// Event landing page — the SpotHero "Official Parking" pattern.
//
// SCAFFOLD: built against the design system and driven entirely by props, but
// not yet mounted in the app's navigation. It replaces nothing; the live
// Fleadh overlay (EventOverlay in App.jsx) keeps running until this is wired
// deliberately, which is not something to do during Fleadh week.
//
// The commercial point of this screen is the OFFICIAL badge. A venue that has
// an agreement with us gets ranked first and visibly endorsed, which is what
// makes an official-partner deal worth signing — and what stops the page
// becoming an undifferentiated list where the nearest car park always wins.
import React from 'react';
import { MapPin, Clock, ShieldCheck, ChevronRight, Navigation } from 'lucide-react';
import { space, color, radius, elevation } from '../../theme/tokens';
import { Text, Overline, Badge, Button, Card, SectionHeader, EmptyState } from '../ui';

/**
 * @param {object}   event   { name, subtitle, startsAt, endsAt, blurb, heroUrl, logoUrl, venue }
 * @param {array}    lots    [{ id, name, official, distanceM, walkMin, price, spaces, url, lat, lng }]
 * @param {function} onOpenLot
 * @param {node}     footer  Deep-link/partner CTA slot — a ticketing or hotel
 *                           flow can inject its own call to action here
 *                           without this component knowing anything about it.
 */
export default function EventLanding({ event, lots = [], onOpenLot, onClose, footer }) {
  const official = lots.filter(l => l.official);
  const nearby   = lots.filter(l => !l.official);
  const when = event?.startsAt
    ? new Date(event.startsAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    : null;

  return (
    <div style={{ background: color.bg, minHeight: '100%' }}>
      {event?.heroUrl && (
        <div style={{ position: 'relative', height: 200 }}>
          <img src={event.heroUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div aria-hidden style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, rgba(10,17,30,0.15) 0%, rgba(10,17,30,0.92) 100%)',
          }} />
        </div>
      )}

      <div style={{ padding: space[4], marginTop: event?.heroUrl ? -56 : 0, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
          {event?.logoUrl && (
            <img src={event.logoUrl} alt="" style={{
              width: 48, height: 48, borderRadius: radius.md, objectFit: 'cover',
              border: `1px solid ${color.hairline}`, boxShadow: elevation.md,
            }} />
          )}
          <div style={{ minWidth: 0 }}>
            <Overline>Event parking</Overline>
            <Text as="h1" role="h1" style={{ display: 'block', marginTop: space[1] }}>{event?.name}</Text>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[3], marginTop: space[3] }}>
          {when && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[1] }}>
              <Clock size={14} color={color.brandBright} />
              <Text role="bodySm" tone="muted">{when}</Text>
            </span>
          )}
          {event?.venue && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[1] }}>
              <MapPin size={14} color={color.brandBright} />
              <Text role="bodySm" tone="muted">{event.venue}</Text>
            </span>
          )}
        </div>

        {event?.blurb && (
          <Text role="body" tone="muted" style={{ display: 'block', marginTop: space[3] }}>{event.blurb}</Text>
        )}
      </div>

      <div style={{ padding: `0 ${space[4]} ${space[8]}` }}>
        {official.length > 0 && (
          <>
            <SectionHeader
              overline="Official parking"
              title={`Booked through ${event?.name || 'the venue'}`}
            />
            {official.map(lot => <LotRow key={lot.id} lot={lot} onOpen={onOpenLot} />)}
          </>
        )}

        {nearby.length > 0 && (
          <>
            <SectionHeader
              overline="Also nearby"
              title="Other spots within walking distance"
              style={{ marginTop: space[6] }}
            />
            {nearby.map(lot => <LotRow key={lot.id} lot={lot} onOpen={onOpenLot} />)}
          </>
        )}

        {lots.length === 0 && (
          <EmptyState
            title="No parking listed for this event yet"
            action={onClose && <Button variant="secondary" onClick={onClose}>Back to search</Button>}
          >
            We add official car parks as venues confirm them. Search the venue name meanwhile.
          </EmptyState>
        )}

        {footer && <div style={{ marginTop: space[6] }}>{footer}</div>}
      </div>
    </div>
  );
}

const LotRow = ({ lot, onOpen }) => (
  <Card
    interactive
    onClick={() => onOpen?.(lot)}
    style={{ marginBottom: space[3], cursor: onOpen ? 'pointer' : 'default' }}
  >
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[3] }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {lot.official && (
          <Badge tone="brand" style={{ marginBottom: space[2] }}>
            <ShieldCheck size={11} strokeWidth={2.6} /> Official
          </Badge>
        )}
        <Text role="h3" style={{ display: 'block' }}>{lot.name}</Text>
        <Text role="caption" tone="faint" style={{ display: 'block', marginTop: space[1] }}>
          {[lot.walkMin ? `${lot.walkMin} min walk` : null,
            lot.spaces ? `${lot.spaces} spaces` : null].filter(Boolean).join(' · ')}
        </Text>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <Text role="h3" tone="success" style={{ display: 'block' }}>{lot.price || 'Free'}</Text>
        {lot.price && <Text role="caption" tone="faint" style={{ display: 'block' }}>all-in</Text>}
      </div>
    </div>
    <div style={{ display: 'flex', gap: space[2], marginTop: space[3] }}>
      <Button size="sm" variant="primary" style={{ flex: 1 }}>
        {lot.price ? 'Reserve' : 'View'}<ChevronRight size={14} />
      </Button>
      {(lot.url || (lot.lat && lot.lng)) && (
        <Button
          size="sm" variant="secondary" href={lot.url || `https://www.google.com/maps/dir/?api=1&destination=${lot.lat},${lot.lng}`}
          target="_blank" rel="noreferrer" aria-label={`Directions to ${lot.name}`}
        >
          <Navigation size={14} />
        </Button>
      )}
    </div>
  </Card>
);
