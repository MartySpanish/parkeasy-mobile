// Geography audit for the seeded spot and business data.  `npm run audit`
//
// Written after Gransha Grill was found pinned 953 metres from its own front
// door, having inherited coordinates from a directory entry that recorded the
// address as "Gransha Road, BT17" when the shop is at 83 Glen Road, BT11 8BD.
// Three community parking spots were anchored to the same wrong point,
// including one titled "Directly outside — Gransha Grill" with 61 votes.
//
// A wrong pin is the most expensive kind of error this app can make: the driver
// has already left, and they find out at the far end. None of this needs a
// network — it only checks the data against itself, which is exactly the class
// of mistake that slipped through.
//
// Exits 1 when something OVERSTATES closeness (says nearer than it is).
// Understatements are reported but tolerated: promising a longer walk than the
// driver actually gets is the safe direction to be wrong in.
import fs from 'fs';

const src = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

/** Pull a top-level array literal out of the JSX and evaluate it on its own. */
function grab(name) {
  const i = src.indexOf(`const ${name} = [`);
  if (i < 0) throw new Error(`${name} not found in src/App.jsx`);
  let j = src.indexOf('[', i), depth = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '[') depth++;
    else if (src[k] === ']') { depth--; if (!depth) break; }
  }
  // eslint-disable-next-line no-eval
  return eval(src.slice(j, k + 1));
}

const SPOTS = grab('SPOTS');
const BUSINESSES = grab('BUSINESSES');
const metres = (a, b) => Math.round(Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 65000));
const MILE = 1609.34;
const PACE = 80;            // metres per minute, the usual planning figure
const TOLERANCE = 120;      // metres of slack before a claim is called wrong

let overstated = 0, understated = 0;
const say = (...a) => console.log(...a);

say('── spots whose "near" names a business ─────────────────────────────');
const byName = new Map(BUSINESSES.map(b => [b.name.toLowerCase(), b]));
for (const s of SPOTS) {
  const b = byName.get(String(s.near || '').toLowerCase());
  if (!b) continue;
  const actual = metres([b.lat, b.lng], [s.lat, s.lng]);
  const claimed = Math.round((s.dist || 0) * MILE);
  const gap = actual - claimed;
  if (gap > TOLERANCE) {
    overstated++;
    say(`  OVERSTATED  ${actual}m real vs ${claimed}m claimed ("${s.walk}")  ${s.name} → ${b.name}`);
  } else if (gap < -TOLERANCE) {
    understated++;
  }
}

say('\n── stated walk time vs stated distance ────────────────────────────');
for (const s of SPOTS) {
  const mins = /(\d+)\s*min/.exec(s.walk || '');
  if (!mins) continue;
  const claimedMin = Number(mins[1]);
  const impliedMin = Math.max(1, Math.round(((s.dist || 0) * MILE) / PACE));
  if (impliedMin - claimedMin >= 3) {
    overstated++;
    say(`  OVERSTATED  ${Math.round((s.dist || 0) * MILE)}m is ~${impliedMin} min, says "${s.walk}"  ${s.name}`);
  } else if (claimedMin - impliedMin >= 3) {
    understated++;
  }
}

say('\n── spots pinned exactly on a business (pin on the building, not the kerb) ──');
let collisions = 0;
for (const s of SPOTS) {
  const hit = BUSINESSES.find(b => Math.abs(b.lat - s.lat) < 1e-6 && Math.abs(b.lng - s.lng) < 1e-6);
  if (hit) { collisions++; say(`  ${s.name}  ==  ${hit.name}`); }
}
if (!collisions) say('  none');

say('\n── duplicate coordinates ──────────────────────────────────────────');
const seen = new Map();
for (const s of SPOTS) {
  const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
  seen.set(k, [...(seen.get(k) || []), s.name]);
}
let dupes = 0;
for (const [k, v] of seen) if (v.length > 1) { dupes++; say(`  ${k}  ${v.join('  |  ')}`); }
if (!dupes) say('  none');

say(`\n${SPOTS.length} spots, ${BUSINESSES.length} businesses`);
say(`${overstated} overstating closeness, ${understated} understating (tolerated)`);
if (overstated) {
  say('\nFAIL — something claims to be nearer than it is. A driver finds that out after they have parked.');
  process.exit(1);
}
say('Nothing claims to be nearer than it is.');
