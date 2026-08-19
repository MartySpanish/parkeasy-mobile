// The car wash add-on, priced and worded.
//
// PARKEASY IS A BOOKING AGENT HERE, NOT THE SERVICE PROVIDER. The wash is
// carried out by an independent contractor and the contract for it is between
// the driver and them. That is not a disclaimer bolted on afterwards, it is why
// this money does not go through Connect and does not split: ParkEasy is
// arranging, not performing. DISCLAIMER below has to appear wherever a driver
// can tick the box, and the same words go in the confirmation email.
//
// Prices in integer pence, like every other price in this codebase.
export const WASH_TIERS = [
  { id: 'standard', label: 'Standard car',    hint: 'Hatchback, saloon, estate', pricePence: 3000 },
  { id: 'large',    label: 'Large / SUV / 4×4', hint: 'X5, Sportage, pickup',     pricePence: 4000 },
  { id: 'van',      label: 'Van / 7-seater',  hint: 'Transit, Zafira, minibus',   pricePence: 5000 },
];

export const tierById = (id) => WASH_TIERS.find(t => t.id === id) || null;

/** Requests close this many hours before the wash day starts. */
export const CUTOFF_HOURS = 24;

export const DISCLAIMER =
  'ParkEasy arranges the wash with an independent contractor. The wash itself is '
  + 'a contract between you and them — ParkEasy is booking it, not carrying it out.';

const DOW = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Mondays" / "Mondays and Sundays" — the days this site actually washes. */
export function washDaysLabel(days = [1]) {
  const names = (days || []).slice().sort().map(d => `${DOW[d]}s`).filter(Boolean);
  if (!names.length) return 'selected days';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The wash dates a driver can still ask for.
 *
 * Two rules, both of which have to hold: it is a day this site washes, and it is
 * more than CUTOFF_HOURS away. The cutoff is not arbitrary — somebody has to
 * tell a valeter how many cars to turn up for, and "tomorrow morning" is not
 * enough notice to add one.
 *
 * @param washDays ISO weekdays (1=Mon..7=Sun)
 * @param now      injectable so this is testable without mocking the clock
 */
export function availableWashDates(washDays = [1], now = new Date(), weeksAhead = 4) {
  const out = [];
  const cutoff = now.getTime() + CUTOFF_HOURS * 3600000;
  for (let i = 0; i <= weeksAhead * 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const isoDow = ((d.getDay() + 6) % 7) + 1;
    if (!washDays.includes(isoDow)) continue;
    // Measured against the START of the wash day, so a Monday wash closes at
    // 00:00 Sunday rather than at some point during Monday itself.
    if (d.getTime() < cutoff) continue;
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
  }
  return out;
}

export default WASH_TIERS;
