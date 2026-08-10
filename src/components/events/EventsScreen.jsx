// What's on in Northern Ireland — and where to park for it.
//
// THE COMMERCIAL POINT. An event is the one moment a driver will happily pay
// for a space: the venue car park is full, the streets around it are permit-
// only, and being late is not an option. So this screen leads with the two
// things that earn — host spaces you can book, and hidden gems that sell
// Premium — and puts the free community spots underneath rather than deleting
// them. Third-party operator car parks (NCP, Q-Park, APCOA) are collapsed
// behind a disclosure: a driver at a sold-out venue may genuinely need one,
// but they are not a recommendation and they don't get a card.
//
// The ranking itself lives in ../../data/eventParking.js — this file is only
// the presentation of it.
//
// DESIGN NOTE ON HONESTY. Several venue coordinates in events.js are our own
// estimates (`approx`), because every geocoder is blocked in the build
// environment. A wrong venue pin doesn't just look untidy — it silently shows
// the wrong car parks. Where a venue is approximate the detail view says so,
// rather than presenting a radius search as if it were surveyed.
import React, { useMemo, useState } from 'react';
import { X, ChevronLeft, ChevronDown, Clock, MapPin, AlertTriangle, Users, Calendar } from 'lucide-react';
import { upcomingEvents, venueOf, startOf, endOf, formatWhen } from '../../data/events';
import { parkingForEvent, TIER } from '../../data/eventParking';

// Tag → accent. Colour carries the category faster than the word does when
// you're scanning thirty rows for "the football one".
const TAG_TONE = {
  Football:    '#6BEFB9',
  Rugby:       '#6BEFB9',
  'Ice hockey':'#7CC4FF',
  Running:     '#7CC4FF',
  Concert:     '#C9A7FF',
  Show:        '#C9A7FF',
  Festival:    '#FFD27A',
  Snooker:     '#FFD27A',
};
const toneOf = (tag) => TAG_TONE[tag] || '#8da2bd';

const MONTH_LABEL = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

const monthKeyOf = (ev) => startOf(ev).slice(0, 7);
const monthNameOf = (key) => {
  const [y, m] = key.split('-');
  return `${MONTH_LABEL[Number(m) - 1]} ${y}`;
};

// "£23.00/all-in" → 2300. Rental spots carry the all-in figure in `price`
// already (s.230 applies wherever a consumer sees a price), so the cheapest
// bookable space for an event is read back off the card rather than recomputed
// from the listing — one source of truth, and no risk of the teaser quoting a
// figure the booking sheet then contradicts.
const penceOf = (spot) => {
  const m = String(spot?.price || '').match(/£\s*([\d.]+)/);
  return m ? Math.round(Number(m[1]) * 100) : null;
};
const gbp = (p) => `£${(p / 100).toFixed(2)}`;

const Chip = ({ children, tone = '#8da2bd', solid = false }) => (
  <span className="inline-flex items-center gap-1 text-[10.5px] font-extrabold px-2 py-[3px] rounded-full whitespace-nowrap"
    style={solid
      ? { color: '#06231f', background: tone }
      : { color: tone, border: `1px solid ${tone}55`, background: `${tone}1A` }}>
    {children}
  </span>
);

/**
 * One line under each event saying what parking we have — the reason to tap.
 * Deliberately leads with the bookable count and the price: "3 free spots
 * nearby" is true of almost every event and tells a driver nothing about
 * whether they'll actually get parked.
 */
const parkingTeaser = (groups) => {
  const g = (t) => groups.find(x => x.tier === t);
  const book = g(TIER.BOOKABLE), gem = g(TIER.PREMIUM_GEM), free = g(TIER.COMMUNITY);
  if (book?.items.length) {
    const prices = book.items.map(x => penceOf(x.spot)).filter(Boolean);
    const from = prices.length ? ` from ${gbp(Math.min(...prices))}` : '';
    return { text: `${book.items.length} space${book.items.length !== 1 ? 's' : ''} to book${from}`, tone: '#6BEFB9' };
  }
  if (gem?.items.length) return { text: `${gem.items.length} premium pick${gem.items.length !== 1 ? 's' : ''} nearby`, tone: '#C9A7FF' };
  if (free?.items.length) return { text: `${free.items.length} free spot${free.items.length !== 1 ? 's' : ''} nearby`, tone: '#8da2bd' };
  return { text: 'No spots mapped here yet', tone: '#8da2bd' };
};

const DateBlock = ({ ev }) => {
  const d = new Date(`${startOf(ev)}T12:00:00Z`);
  const multi = Array.isArray(ev.date) && endOf(ev) !== startOf(ev);
  return (
    <div className="w-[52px] flex-shrink-0 rounded-[14px] py-1.5 text-center"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}>
      <span className="block font-display text-[9.5px] font-extrabold tracking-[0.12em] uppercase text-[#8da2bd]">
        {d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}
      </span>
      <span className="block font-display text-[19px] font-extrabold leading-none text-[#EAF1F8] mt-0.5">
        {d.getUTCDate()}
      </span>
      {multi && <span className="block text-[9px] font-bold text-[#8da2bd] mt-0.5">
        –{new Date(`${endOf(ev)}T12:00:00Z`).getUTCDate()}
      </span>}
    </div>
  );
};

const EventRow = ({ ev, groups, onOpen }) => {
  const venue = venueOf(ev);
  const teaser = parkingTeaser(groups);
  return (
    <button onClick={() => onOpen(ev)}
      className="w-full flex items-start gap-3 text-left rounded-[20px] p-3 active:scale-[0.99] transition glass">
      <DateBlock ev={ev} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display font-bold text-[15px] text-[#EAF1F8] leading-tight">{ev.name}</h3>
          <Chip tone={toneOf(ev.tag)}>{ev.tag}</Chip>
        </div>
        <p className="flex items-center gap-1 text-[11.5px] text-[rgba(234,241,248,0.55)] mt-1 min-w-0">
          <MapPin size={11} className="flex-shrink-0" />
          <span className="truncate">{venue?.name}{venue?.area ? ` · ${venue.area}` : ''}</span>
        </p>
        <p className="flex items-center gap-1 text-[11.5px] text-[rgba(234,241,248,0.55)] mt-0.5">
          <Clock size={11} className="flex-shrink-0" />{formatWhen(ev)}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <Chip tone={teaser.tone} solid={teaser.tone === '#6BEFB9'}>{teaser.text}</Chip>
          {ev.soldOut && <Chip tone="#FF8A8A">Sold out</Chip>}
          {ev.closures && <Chip tone="#FF8A8A">Road closures</Chip>}
        </div>
      </div>
    </button>
  );
};

// ── Detail ───────────────────────────────────────────────────────────────────

const TierSection = ({ group, renderSpot, isPremium, sole = false }) => {
  // Tier 4 only reaches this screen when it is the ONLY thing within walking
  // distance — parkingForEvent drops it entirely otherwise. So it opens
  // expanded: a page whose single answer is hidden behind a disclosure reads
  // as a page with no answer. Still plain text, still no cards.
  const [open, setOpen] = useState(sole);
  if (group.tier === TIER.THIRD_PARTY) {
    return (
      <div className="mt-4">
        <button onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl text-left bg-white/[0.03] border border-white/10">
          <span className="text-[12.5px] font-bold text-[rgba(234,241,248,0.6)]">
            {sole ? 'Nothing of ours here' : group.label} ({group.items.length})
          </span>
          <ChevronDown size={15} className={`text-[#8da2bd] transition ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="mt-2 px-3.5">
            <p className="text-[11.5px] leading-relaxed text-[rgba(234,241,248,0.45)]">
              Commercial operators. We don&rsquo;t set these prices and can&rsquo;t hold a space for you —
              check the operator&rsquo;s own app for event rates.
            </p>
            <ul className="mt-2 space-y-1.5">
              {group.items.map(({ spot, walkMin }) => (
                <li key={spot.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-[rgba(234,241,248,0.75)] truncate">{spot.name}</span>
                  <span className="text-[11.5px] font-bold text-[#8da2bd] flex-shrink-0">{walkMin} min</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  const accent = group.tier === TIER.BOOKABLE ? '#6BEFB9'
    : group.tier === TIER.PREMIUM_GEM ? '#C9A7FF' : '#8da2bd';
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="font-display font-bold text-[15px]" style={{ color: group.promoted ? accent : '#EAF1F8' }}>
          {group.label}
        </h3>
        <span className="text-[11px] font-bold text-[#8da2bd]">{group.items.length}</span>
      </div>
      {group.tier === TIER.BOOKABLE && (
        <p className="text-[12px] text-[rgba(234,241,248,0.55)] mb-2.5">
          Reserved and paid in advance, held for you when you arrive.
        </p>
      )}
      {group.tier === TIER.PREMIUM_GEM && !isPremium && (
        <p className="text-[12px] text-[rgba(234,241,248,0.55)] mb-2.5">
          Free to park, if you know where they are.
        </p>
      )}
      <div className="space-y-2.5">
        {group.items.map(({ spot, walkMin }) => (
          <div key={spot.id}>
            {renderSpot(spot)}
            <p className="text-[10.5px] font-bold text-[#8da2bd] mt-1 ml-1">{walkMin} min walk to the venue</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const EventDetail = ({ ev, groups, onBack, renderSpot, isPremium, onOpenFleadh, onAddSpot }) => {
  const venue = venueOf(ev);
  const hasBookable = groups.some(g => g.tier === TIER.BOOKABLE && g.items.length);
  return (
    <>
      <button onClick={onBack}
        className="flex items-center gap-1.5 text-[13px] font-bold text-[#5BE7DA] mb-3 active:opacity-70 transition">
        <ChevronLeft size={16} />All events
      </button>
      <Chip tone={toneOf(ev.tag)}>{ev.tag}</Chip>
      <h2 className="font-display font-extrabold text-[23px] text-[#EAF1F8] mt-2 leading-tight">{ev.name}</h2>
      <p className="flex items-center gap-1.5 mt-2 text-[13px] text-[#cdd9e8]"><Clock size={14} />{formatWhen(ev)}</p>
      <p className="flex items-center gap-1.5 mt-1 text-[13px] text-[#cdd9e8]">
        <MapPin size={14} />{venue?.name}{venue?.area ? ` · ${venue.area}` : ''}
      </p>
      {venue?.aka && <p className="text-[11.5px] text-[#8da2bd] mt-0.5 ml-[22px]">{venue.aka}</p>}

      <div className="flex flex-wrap gap-1.5 mt-3">
        {ev.soldOut && <Chip tone="#FF8A8A">Sold out — expect a full venue</Chip>}
        {ev.crowd && <Chip tone="#FFD27A"><Users size={10} />{ev.crowd.toLocaleString('en-GB')} expected</Chip>}
        {!ev.time && <Chip>Start time not confirmed</Chip>}
      </div>

      {ev.closures && (
        <div className="mt-3.5 rounded-2xl px-4 py-3.5"
          style={{ background: 'rgba(255,92,92,0.10)', border: '1px solid rgba(255,122,122,0.35)' }}>
          <p className="flex items-center gap-1.5 font-display font-bold text-[13.5px] text-[#FF8A8A]">
            <AlertTriangle size={14} />Road closures expected
          </p>
          <p className="text-[12px] text-[#cdd9e8] mt-1 leading-relaxed">
            Streets around the venue are likely to be closed. Park outside the area and walk in —
            and check the organiser&rsquo;s travel page before you set off.
          </p>
          {onOpenFleadh && ev.id === 'fleadh-2026' && (
            <button onClick={onOpenFleadh} className="mt-2 font-bold text-[12.5px] text-[#5BE7DA] underline">
              See the closed streets and Park &amp; Ride &rarr;
            </button>
          )}
        </div>
      )}

      {/* An estimated venue pin moves the whole parking radius. Say so where it
          applies rather than letting a confident-looking list imply a survey. */}
      {venue?.approx && (
        <p className="text-[11.5px] leading-relaxed text-[rgba(234,241,248,0.45)] mt-3">
          Venue location is approximate, so walking times are a guide.
        </p>
      )}

      {groups.length === 0 && (
        <div className="mt-5 rounded-2xl px-4 py-4 bg-white/[0.04] border border-white/10">
          <p className="font-display font-bold text-[14px] text-[#EAF1F8]">No spots mapped here yet</p>
          <p className="text-[12.5px] text-[#cdd9e8] mt-1 leading-relaxed">
            We haven&rsquo;t got parking within walking distance of this venue on the map.
            If you know somewhere, adding it takes a minute.
          </p>
          {onAddSpot && (
            <button onClick={onAddSpot}
              className="mt-3 w-full py-3 rounded-2xl font-display font-bold text-[14px] text-[#EAF1F8] bg-white/8 border border-white/15 active:scale-95 transition">
              Add a spot
            </button>
          )}
        </div>
      )}

      {groups.map(g => (
        <TierSection key={g.tier} group={g} renderSpot={renderSpot} isPremium={isPremium}
          sole={groups.length === 1 && g.tier === TIER.THIRD_PARTY} />
      ))}

      {/* Where we have nothing to sell beside a venue full of people who want to
          buy, the missing thing is supply. Ask for it here, at the exact moment
          a host can see the demand. */}
      {!hasBookable && groups.length > 0 && (
        <div className="mt-5 rounded-2xl px-4 py-4"
          style={{ background: 'linear-gradient(135deg, rgba(46,211,198,0.10), rgba(91,231,218,0.04))', border: '1px solid rgba(91,231,218,0.35)' }}>
          <p className="font-display font-bold text-[14px] text-[#EAF1F8]">
            Live near {venue?.name}?
          </p>
          <p className="text-[12.5px] text-[#cdd9e8] mt-1 leading-relaxed">
            Nobody is renting out a space here yet. Drivers coming to this event are looking for one —
            list your driveway or yard and keep 85% of every booking.
          </p>
          {onAddSpot && (
            <button onClick={onAddSpot}
              className="mt-3 w-full py-3 rounded-2xl font-display font-bold text-[14px] text-[#06231f] btn-teal active:scale-95 transition">
              Rent out my space
            </button>
          )}
        </div>
      )}
    </>
  );
};

// ── Screen ───────────────────────────────────────────────────────────────────

/**
 * @param spots       every spot in the network
 * @param isGated     App.jsx's predicate — decides what counts as a Premium gem
 * @param renderSpot  render-prop returning the app's SpotCard, so this file
 *                    never has to reach into App.jsx internals
 */
export default function EventsScreen({
  onClose, spots = [], isGated, isPremium, renderSpot,
  onOpenFleadh, onAddSpot, todayISO,
}) {
  const [openId, setOpenId] = useState(null);
  const [month, setMonth] = useState('all');

  const events = useMemo(() => upcomingEvents(todayISO), [todayISO]);

  // Parking is resolved once for every event rather than on open: it drives the
  // teaser line on each row, and recomputing on tap made the detail view arrive
  // a frame late on a phone.
  const parking = useMemo(() => {
    const out = {};
    for (const ev of events) out[ev.id] = parkingForEvent(spots, venueOf(ev), isGated);
    return out;
  }, [events, spots, isGated]);

  const months = useMemo(() => {
    const seen = [];
    for (const ev of events) { const k = monthKeyOf(ev); if (!seen.includes(k)) seen.push(k); }
    return seen;
  }, [events]);

  const shown = month === 'all' ? events : events.filter(ev => monthKeyOf(ev) === month);
  const open = openId ? events.find(e => e.id === openId) : null;

  // Group the filtered list by month so the headings survive the "all" view.
  const grouped = [];
  for (const ev of shown) {
    const k = monthKeyOf(ev);
    const last = grouped[grouped.length - 1];
    if (last && last.key === k) last.items.push(ev); else grouped.push({ key: k, items: [ev] });
  }

  return (
    <div className="fixed inset-0 z-[66] flex flex-col overflow-auto" style={{ background: 'var(--bg-solid)' }}>
      <div className="w-full mx-auto px-5 pb-16" style={{ maxWidth: 680, paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-[12px] font-bold tracking-[0.18em] text-[#5BE7DA] uppercase">Event parking</p>
            <h1 className="font-display font-extrabold text-[26px] text-[#EAF1F8] mt-1 leading-tight">What&rsquo;s on</h1>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-10 h-10 rounded-full bg-white/8 border border-white/15 flex items-center justify-center text-[#EAF1F8] flex-shrink-0 active:scale-90 transition">
            <X size={19} />
          </button>
        </div>

        {open ? (
          <div className="mt-4">
            <EventDetail ev={open} groups={parking[open.id] || []} onBack={() => setOpenId(null)}
              renderSpot={renderSpot} isPremium={isPremium} onOpenFleadh={onOpenFleadh} onAddSpot={onAddSpot} />
          </div>
        ) : (
          <>
            <p className="text-[13px] text-[#cdd9e8] mt-1.5 leading-relaxed">
              {events.length} events across Northern Ireland, each with the closest spaces you can
              actually book and the gems within walking distance.
            </p>

            <div className="flex gap-2 mt-4 overflow-x-auto no-scrollbar -mx-5 px-5 pb-1">
              {[['all', 'All'], ...months.map(k => [k, monthNameOf(k).split(' ')[0]])].map(([k, label]) => (
                <button key={k} onClick={() => setMonth(k)}
                  className={`px-3.5 py-2 rounded-full text-[12.5px] font-extrabold whitespace-nowrap flex-shrink-0 transition ${
                    month === k
                      ? 'text-[#06231f] btn-teal'
                      : 'text-[#cdd9e8] bg-white/6 border border-white/12'}`}>
                  {label}
                </button>
              ))}
            </div>

            {grouped.length === 0 && (
              <div className="mt-8 text-center">
                <Calendar size={26} className="mx-auto text-[#8da2bd]" />
                <p className="font-display font-bold text-[15px] text-[#EAF1F8] mt-3">Nothing listed yet</p>
                <p className="text-[12.5px] text-[#8da2bd] mt-1">We add events as venues confirm their dates.</p>
              </div>
            )}

            {grouped.map(g => (
              <div key={g.key}>
                <h2 className="font-display font-bold text-[12px] tracking-[0.14em] uppercase text-[#8da2bd] mt-6 mb-2.5">
                  {monthNameOf(g.key)}
                </h2>
                <div className="space-y-2.5">
                  {g.items.map(ev => (
                    <EventRow key={ev.id} ev={ev} groups={parking[ev.id] || []} onOpen={e => { setOpenId(e.id); window.scrollTo?.(0, 0); }} />
                  ))}
                </div>
              </div>
            ))}

            {/* Said plainly rather than buried in a settings page: the calendar
                is compiled by hand and venues move things. */}
            <p className="text-[11.5px] leading-relaxed text-[rgba(234,241,248,0.4)] mt-8">
              Dates and times come from venue and organiser listings and can change — check with the
              venue before you travel. Parking distances are straight-line, so allow a little more.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
