// Generate the hidden_gems seed migration from the gem list still living in app
// code.
//
//   node scripts/generate-gem-seed.mjs > supabase/migrations/20260820_hidden_gems_seed.sql
//
// COMMITTED, AND RERUNNABLE, ON PURPOSE. The seed is 89 rows of real curated
// data and hand-writing it once would mean the file and the source drift the
// first time somebody edits a gem in App.jsx. Regenerating is one command, and
// the migration is an upsert on legacy_id so a rerun corrects rather than
// duplicates.
//
// It reads the literals out of App.jsx by brace matching rather than importing,
// because App.jsx imports React and Leaflet and cannot be loaded in Node.
import { readFileSync } from 'fs';
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

// CITY_SPOTS maps town -> a top-level array declared elsewhere in App.jsx.
const cityMap = literal('CITY_SPOTS', '{', '}');
const CITY_SPOTS = {};
for (const [, city, ident] of cityMap.matchAll(/^\s*([a-z]+):\s*([A-Z_]+),/gm)) {
  CITY_SPOTS[city] = eval('(' + literal(ident, '[', ']') + ')');
}

const all = [];
for (const map of [CITY_SPOTS, EXTRA_SPOTS, EV_SPOTS, PILOT_SPOTS, APCOA_SPOTS]) {
  for (const [city, arr] of Object.entries(map)) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) all.push({ ...s, _city: city });
  }
}

const gems = all.filter(s => s.badge === 'hidden_gem')
                .sort((a, b) => Number(a.id) - Number(b.id));

// ── PRIVATE LAND ─────────────────────────────────────────────────────────────
// Every gem is tested against the words that indicate somebody else's car park,
// so the five that read that way are identified rather than stamped 'public'
// and forgotten:
//
//     568  Tesco Extra, Castle Way (Antrim)      "Free, customers only"
//     870  Strabane Retail Park Overflow         "Free all day"
//    1018  Tesco, Castlewellan Road (Banbridge)  "customers only during store hours"
//    2137  Bann Boulevard (Portadown)            "Free all day"
//    2158  Eurospar Scarva Street (Banbridge)    "customers only during store hours"
//
// MARTY'S CALL, 19 AUGUST: publish all five. They have been on the app for
// months, they are spots locals genuinely use, and he knows these car parks.
// The concern was put to him — three of the five say "customers only" and two
// coach a token purchase in the notes, and NI retail car parks are ANPR-enforced
// by third parties — and the decision is his.
//
// So they are seeded land_type='private', status='published'. The flag stays
// because it is TRUE and because it is what any future moderation rule keys
// off; the publish decision is recorded here rather than the flag being quietly
// falsified to make a constraint pass. If one of these ever produces a charge
// notice, this is the list to look at.
const PRIVATE_SIGNALS = /retail park|shopping centre|supermarket|tesco|asda|sainsbury|lidl|aldi|eurospar|spar\b|customers? only|private land|patrons? only/i;
const looksPrivate = (g) =>
  PRIVATE_SIGNALS.test([g.name, g.near, g.notes, g.restriction].filter(Boolean).join(' '));

const q = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : 'null');
const arr = (v) => (Array.isArray(v) && v.length
  ? `array[${v.map(x => q(x)).join(',')}]::text[]` : `'{}'::text[]`);
const b = (v) => (v === true ? 'true' : v === false ? 'false' : 'null');

const priv = gems.filter(looksPrivate);

// ── TASTERS ──────────────────────────────────────────────────────────────────
// Five gems are given away free, app-wide, as proof the locked ones are worth
// paying for. App.jsx picked them by votes then id, so the set is stable between
// renders; the same rule is applied here once, and after this it is a column
// somebody can change without a deploy. Drafts are excluded — a taster has to
// be a spot we are actually publishing.
const TASTERS = new Set(
  gems.filter(g => !looksPrivate(g))
      .slice()
      .sort((a, b) => (b.votes || 0) - (a.votes || 0) || String(a.id).localeCompare(String(b.id)))
      .slice(0, 5)
      .map(g => String(g.id)),
);

const rows = gems.map(g => `  (${[
  q(String(g.id)), q(g.name), q(g.near), q(g.street), q(g.type),
  q(g.restriction), q(g.notes), n(g.lat), n(g.lng), q(g.photo),
  n(g.spaces),
  q(looksPrivate(g) ? 'private' : 'public'),
  q('published'),
  q(looksPrivate(g) ? 'Marty Rooney, 19 Aug 2026 — knows these car parks, live for months' : null),
  arr(g.tags), q(g.walk), n(g.dist), q(g.by), n(g.votes ?? 0), b(g.premium),
  q(g._city), TASTERS.has(String(g.id)) ? 'true' : 'false',
].join(', ')})`).join(',\n');

process.stdout.write(`-- hidden_gems: the ${gems.length} curated free spots, out of app code and into the database.
--
-- GENERATED by scripts/generate-gem-seed.mjs — do not hand-edit. Regenerate with:
--   node scripts/generate-gem-seed.mjs > supabase/migrations/20260820_hidden_gems_seed.sql
--
-- Upsert on legacy_id, so a rerun corrects rows rather than duplicating them.
--
-- legacy_id IS THE LOAD-BEARING COLUMN. spot_occupancy.spot_id and
-- spot_capacity_reports.spot_id hold a bare integer for a gem and
-- 'rental-<uuid>' for a listing. That dual shape is deliberate and stays;
-- legacy_id is what keeps the integer half joinable.
--
-- ${priv.length} of the ${gems.length} sit on private retail land by their own description:
${priv.map(g => `--   ${String(g.id).padStart(5)}  ${g.name} — "${g.restriction}"`).join('\n')}
-- All ${gems.length} are PUBLISHED, at Marty's instruction on 19 August. He knows these car
-- parks and they have been live for months. The concern was put to him — three
-- say "customers only" and two coach a token purchase in the notes, and NI
-- retail car parks are ANPR-enforced by third parties — and he made the call.
--
-- land_type stays 'private' on those five because it is true, and because it is
-- what any future moderation rule keys off. Retire one with:
--   update public.hidden_gems set status='retired' where legacy_id='568';

insert into public.hidden_gems (
  legacy_id, name, near, street, type, restriction, notes, lat, lng, photo_url,
  spaces_estimate, land_type, status, private_land_approved_by, tags, walk,
  dist_miles, submitted_by, votes, premium, town, is_taster
) values
${rows}
-- NEITHER status NOR land_type IS UPDATED ON CONFLICT, and that is deliberate.
-- Both are moderation decisions a person makes after the seed runs: publishing a
-- draft, or confirming that Bann Boulevard is a council car park rather than the
-- shopping centre's. A regenerate that reset them would either undo that
-- decision or — worse — reset land_type to 'private' while leaving status
-- 'published', which trips the check constraint and fails the whole run.
-- Descriptive fields are refreshed; judgements are left alone.
on conflict (legacy_id) do update set
  name = excluded.name, near = excluded.near, street = excluded.street,
  type = excluded.type, restriction = excluded.restriction, notes = excluded.notes,
  lat = excluded.lat, lng = excluded.lng, photo_url = excluded.photo_url,
  spaces_estimate = excluded.spaces_estimate,
  tags = excluded.tags, walk = excluded.walk, dist_miles = excluded.dist_miles,
  submitted_by = excluded.submitted_by, votes = excluded.votes,
  premium = excluded.premium, town = excluded.town,
  is_taster = excluded.is_taster,
  updated_at = now();
`);

console.error(`generated ${gems.length} gems (${priv.length} drafted as private land)`);
