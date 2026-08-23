// Build the globe's dataset from the SPOTS THAT ACTUALLY EXIST.
//
//   node scripts/generate-globe-data.mjs
//
// WHY THIS EXISTS. The globe arrived from Claude Design with a hand-made
// data/parkeasy-places.json: 287 points and a stats row reading 741 / 88 / 25.
// Handsome, and not ours. Spot-checked against the real rows, the pins are
// scattered rather than located — The Red Devil sat 4km from the Falls Road,
// Gransha Grill 5.5km from the Glen Road, Aaron Quinn 6km from Andersonstown.
// The real dataset is 745 spots with surveyed coordinates, 89 gems and 31
// towns, and it is right here in the repo.
//
// A map of invented pins on a page headed "Every space Northern Ireland
// already has" is the one thing this page must not be. So the data is
// generated, every run, from the same arrays the app itself renders. When
// somebody adds a spot, the globe gets it on the next build and the counts
// move by themselves.
//
// Reads the literals out of App.jsx by brace matching rather than importing,
// because App.jsx pulls in React and Leaflet and cannot be loaded in Node —
// the same approach as scripts/generate-gem-seed.mjs.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { EXTRA_SPOTS } from '../src/extraSpots.js';
import { EV_SPOTS }    from '../src/evSpots.js';
import { PILOT_SPOTS } from '../src/pilotSpots.js';
import { APCOA_SPOTS } from '../src/apcoaSpots.js';

const APP = new URL('../src/App.jsx', import.meta.url);
const src = readFileSync(APP, 'utf8');

const literal = (name, open, close) => {
  const at = src.indexOf(`const ${name}`);
  if (at < 0) throw new Error(`${name} not found in App.jsx`);
  let i = src.indexOf(open, src.indexOf('=', at)), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`unbalanced ${open} in ${name}`);
};

const CITY_SPOTS = {};
for (const [, city, ident] of literal('CITY_SPOTS', '{', '}').matchAll(/^\s*([a-z]+):\s*([A-Z_]+),/gm)) {
  CITY_SPOTS[city] = eval('(' + literal(ident, '[', ']') + ')');
}

const all = [];
for (const map of [CITY_SPOTS, EXTRA_SPOTS, EV_SPOTS, PILOT_SPOTS, APCOA_SPOTS]) {
  for (const [city, arr] of Object.entries(map)) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) all.push({ ...s, _city: city });
  }
}

// ── BADGE → GLOBE TYPE ───────────────────────────────────────────────────────
// The globe's legend has five slots and the app has five badges, but they are
// not the same five. 'timed' (a bay with a limit) and 'official' (a council or
// operator car park) are both things you pay for or are restricted at, so they
// join 'paid' rather than being dropped or called free. Nothing is invented and
// nothing is silently discarded: an unmapped badge would throw.
const TYPE = { free: 'free', hidden_gem: 'gem', paid: 'paid', timed: 'paid', official: 'paid' };

const titleCase = (s) => s.replace(/(^|[-\s])([a-z])/g, (_, a, b) => a + b.toUpperCase());
// The dataset's town keys are slugs; the globe labels and searches on names.
const TOWN_NAME = { derry: 'Derry~Londonderry', qub: "Queen's Quarter", sse: 'SSE Arena' };
const townOf = (s) => TOWN_NAME[s._city] || titleCase(s._city);

// ── ⚠️ HIDDEN GEMS ARE THE PAID HALF OF THE PRODUCT ──────────────────────────
// This file is a PUBLIC static asset. Anyone can open it in a browser, and
// nothing about a globe suggests that.
//
// The 89 gems are what a Premium subscription buys. 20260820_hidden_gems.sql
// was written specifically because they used to ship to every browser in the
// app bundle — "the lock is drawn in the UI; the exact coordinates and notes
// are one devtools tab away for anybody who has never paid". Publishing name +
// exact coordinate here would reopen that hole through a side door, on a page
// whose whole job is to be looked at.
//
// So gems follow the SAME RULE the app already applies to a locked pin
// (approxCoord in App.jsx): the coordinate is snapped to a 0.005° grid, about
// 500m, and the name is withheld. They are still counted, still drawn, still
// searchable by AREA — which is the upsell working exactly as designed, a dot
// that says "there is something here" without saying what.
const approx = (v) => Math.round(v * 200) / 200;

// AND THE AREA LABEL CAN ITSELF BE A GEM'S NAME. Caught by the assertion below
// on the first run: "Lagan Meadows", "Wallace Park" and "Riverdale Car Park"
// are each the name of one gem and the `near` of another, so publishing `near`
// unfiltered would have named three of them. Withheld when it collides.
const gemNames = new Set(all.filter(s => s.badge === 'hidden_gem').map(s => s.name).filter(Boolean));

const spaces = [];
const skipped = [];
for (const s of all) {
  const t = TYPE[s.badge];
  if (!t) { skipped.push(`${s.id} ${s.name} — unmapped badge ${s.badge}`); continue; }
  if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) { skipped.push(`${s.id} ${s.name} — no coordinate`); continue; }
  const gem = t === 'gem';
  // GeoJSON order, which is what d3.geoPath wants: [lng, lat]. Five decimals
  // for an ordinary spot — about a metre, far finer than a 3px dot needs, and
  // it takes ~30% off the file every visitor downloads. Gems get the 500m grid.
  const c = gem
    ? [Number(approx(s.lng).toFixed(3)), Number(approx(s.lat).toFixed(3))]
    : [Number(s.lng.toFixed(5)), Number(s.lat.toFixed(5))];
  spaces.push({
    t, town: townOf(s), c,
    // The area, never the gem itself. `near` is what the locked card in the app
    // already prints on screen, so it gives away nothing new.
    n: gem ? (s.near && !gemNames.has(s.near) ? s.near : null) : (s.name || null),
  });
}

// A gem's name must never appear in this file. Asserted rather than trusted,
// because the next person to edit the mapping above will not read the comment —
// and because this assertion has already earned its keep once.
// Scoped to GEM ROWS. An ordinary spot publishing its own name is fine even
// when a gem happens to share it: that name is already public to everybody in
// the app, and withholding it here would hide a free car park to protect a
// secret that is not one.
//
// It flagged exactly that case on the second run — "Riverdale Car Park" in
// Larne exists TWICE in the dataset, id 729 as a hidden gem at 54.851,-5.824
// and id 3127 as an official EV spot at 54.848,-5.8235, 340m apart. Almost
// certainly one car park entered twice. Reported below rather than silently
// tolerated, because the duplicate is a real problem for the app too: a
// Premium subscriber is being sold a gem that is also listed free.
const leaked = spaces.filter(s => s.t === 'gem' && s.n && gemNames.has(s.n));
if (leaked.length) {
  console.error(`REFUSING: ${leaked.length} hidden-gem name(s) would be published:\n  ${leaked.map(l => l.n).join('\n  ')}`);
  process.exit(1);
}

const dupes = [...gemNames].filter(n => all.some(s => s.name === n && s.badge !== 'hidden_gem'));
if (dupes.length) {
  console.warn(`globe: ${dupes.length} gem name(s) also exist as a free/official spot — a duplicate in the dataset, worth resolving: ${dupes.join(', ')}`);
}
if (skipped.length) {
  console.error(`REFUSING: ${skipped.length} spot(s) could not be mapped:\n  ${skipped.join('\n  ')}`);
  process.exit(1);
}

// ── AREAS ────────────────────────────────────────────────────────────────────
// The named places the app already builds landing pages for, so the globe's
// area labels and its /area/*.html pages can never disagree about what exists.
const areas = {};
for (const s of all) {
  if (s.badge !== 'hidden_gem' || !s.near) continue;
  const town = townOf(s);
  (areas[town] ||= []);
  if (areas[town].length < 8 && !areas[town].some(a => a.n === s.near)) {
    areas[town].push({ n: s.near, c: [Number(s.lng.toFixed(4)), Number(s.lat.toFixed(4))] });
  }
}

const towns = new Set(spaces.map(s => s.town));
const counts = spaces.reduce((m, s) => (m[s.t] = (m[s.t] || 0) + 1, m), {});

// ── STATS ────────────────────────────────────────────────────────────────────
// Counted, never typed. The version that arrived said 741 / 88 / 25 and the
// answers were 745 / 89 / 31 — three numbers, all wrong, all stale the moment
// somebody adds a spot. HOST_COMMISSION is imported rather than restated
// because 85% is in signed host agreements and must not be able to drift on a
// marketing page.
const stats = {
  spaces: spaces.length,
  gems: counts.gem || 0,
  towns: towns.size,
  hostShare: 85,
  generatedAt: new Date().toISOString().slice(0, 10),
};

mkdirSync(new URL('../public/globe/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/globe/places.json', import.meta.url),
  JSON.stringify({ spaces, areas, stats }));

// ── SUPABASE CONFIG FOR THE LIVE LAYERS ──────────────────────────────────────
// public/globe/index.html is a static file, so Vite never touches it and
// import.meta.env is not available inside it. The anon key is public by design
// — it is already in the app bundle every visitor downloads, and RLS is what
// actually gates the data — but it is INJECTED rather than committed, so this
// repo does not carry a credential and a fork does not inherit one.
//
// Absent env is not an error: the globe still renders its 745 generated spaces
// and simply has no partner or host pins. Better a page with one layer missing
// than a build that fails on a marketing page.
const url = process.env.VITE_SUPABASE_URL || '';
const key = process.env.VITE_SUPABASE_ANON_KEY || '';
writeFileSync(new URL('../public/globe/config.js', import.meta.url),
  `window.__PARKEASY__=${JSON.stringify({ url: url.replace(/\/$/, ''), key })};\n`);
if (!url || !key) {
  console.warn('globe: no VITE_SUPABASE_* in env — partner and host pins will be absent');
}

console.log(`globe data: ${spaces.length} spaces (${JSON.stringify(counts)}), ${towns.size} towns, ${Object.keys(areas).length} areas with named places`);
