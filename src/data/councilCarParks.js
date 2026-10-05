// Belfast City Council's own rules about its 30 car parks, taken from the
// council's car parks page rather than inferred.
//
// WHY THIS FILE EXISTS. Two of the council's rules are the kind ParkEasy gets
// wrong by omission, and one of them it already had wrong:
//
//   1. "All charged car parks (EXCEPT Corporation Square, Corporation Street
//      and Smithfield) are open and free to use outside of charged hours."
//
//      Every other charged council car park is free in the evening. Those three
//      are not. Our Smithfield entry said "Charged Mon-Sat 8am-6pm, Thu to
//      9pm" and nothing else, which a driver reads as "free after six" — the
//      exact inference the council's exception list forbids, and the same shape
//      of error as Junction One claiming to be free while running ANPR.
//
//   2. On six dates a year EVERY council car park is free, charged ones
//      included. That is a real fact a driver can act on and nobody tells them.
//
// THE PAGE CONTRADICTS ITSELF ON THE EXCEPTION LIST. One line names three
// exceptions, a later line names only Smithfield. Where an official source is
// inconsistent about whether parking is free, the only safe reading is the one
// that cannot cost a driver a ticket, so all three are treated as exceptions.
// If the council clarifies, widen it then — not before.

/** The charged car parks that are NOT free outside charged hours. Lower-case. */
export const NOT_FREE_OUTSIDE_HOURS = [
  'corporation square',
  'corporation street',
  'smithfield',
];

/**
 * Dates on which every Belfast City Council car park is free, as the council
 * publishes them — the ALLOCATED holiday, not the nominal date, because that
 * is the day the machines are actually switched off.
 *
 * ISO dates, so no parsing of "Easter Monday" and no timezone to get wrong.
 */
export const COUNCIL_FREE_DAYS = [
  { date: '2026-04-06', name: 'Easter Monday' },
  { date: '2026-07-13', name: '12 July holiday' },
  { date: '2026-07-14', name: '13 July holiday' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-28', name: 'Boxing Day holiday' },
  { date: '2027-01-01', name: "New Year's Day" },
];

/** The last date this list can speak for. Past it, we know nothing. */
export const COVERED_UNTIL = COUNCIL_FREE_DAYS[COUNCIL_FREE_DAYS.length - 1].date;

const iso = (d) => {
  if (typeof d === 'string') return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    // Local date parts, not toISOString(): a driver in Belfast at 00:30 BST is
    // on today's date, and toISOString() would hand them yesterday.
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
};

/**
 * Is this a day when all council car parks are free?
 *
 * Returns null — not false — once the date is past what the published list
 * covers. "We do not know" and "it is chargeable" are different answers, and
 * only one of them is honest after the list runs out.
 */
export const councilFreeDay = (when = new Date()) => {
  const d = iso(when);
  if (!d) return null;
  const hit = COUNCIL_FREE_DAYS.find((f) => f.date === d);
  if (hit) return hit;
  return d > COVERED_UNTIL ? null : false;
};

/** True only for a spot this rule actually governs — a council car park. */
export const isCouncilCarPark = (spot) =>
  Boolean(spot) && String(spot.by || '').toLowerCase() === 'belfast city council';

/**
 * Does this spot keep charging outside its charged hours?
 *
 * Matched on the spot NAME against the council's exception list. A name that is
 * not on the list returns false, which is the council's general rule.
 */
export const chargesOutsideHours = (spot) => {
  const name = String(spot?.name || '').toLowerCase();
  return NOT_FREE_OUTSIDE_HOURS.some((ex) => name.includes(ex));
};
