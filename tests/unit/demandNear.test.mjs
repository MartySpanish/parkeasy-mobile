// Counting people, not page views.
//
// The pitch this exists to make possible is the one sentence that turns a
// treasurer into a host: "fourteen people looked for parking near your club
// last month and found nothing." parking_requests' own migration says so out
// loud. The number has to be true, because it is said to a stranger about
// their own property — the same bar as a restriction on a bay.
//
// AN EARLIER DRAFT COUNTED ROWS IN app_events AND WOULD HAVE LIED. Checked
// against the live table before shipping: all 31 search_no_results events come
// from 10 browsing sessions across 16 locations, and EVERY apparent cluster is
// one session on one day. The biggest — five events near Ballymena — is one
// person refreshing five times. An events-counting version reports "5 people";
// the truth is one, and one is below the floor, so the truth is "nothing to
// say yet".
//
// So the unit is a distinct session (the closest thing to a person this schema
// has) and, for the waitlist, a distinct email. These checks hold that, the
// k-anonymity floor, the bounds that stop the radius being walked outwards into
// a national total, and the grant that keeps it away from anon until there is
// something real to tell a host.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mig = readFileSync(
  new URL('../../supabase/migrations/20261005_demand_near.sql', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../../api/admin.js', import.meta.url), 'utf8');

// The body of demand_near, so a check cannot be satisfied by a comment that
// happens to contain the right words.
const body = /create or replace function public\.demand_near[\s\S]*?\nend \$\$;/.exec(mig)?.[0]
  ?? assert.fail('demand_near not found in the migration');
const code = body.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\ndemandNear — distinct people, or nothing');

it('searches are counted per SESSION, never per event', () => {
  assert.match(code, /count\(distinct e\.session_id\)/,
    'searches are counted as events again — one person refreshing becomes five people');
  assert.doesNotMatch(code, /count\(\*\)[\s\S]*from public\.app_events/,
    'app_events is being counted with count(*)');
  // A row with no session cannot be a person.
  assert.match(code, /e\.session_id is not null/, 'events with no session are counted as people');
});

it('the waitlist is counted per PERSON, never per submission', () => {
  assert.match(code, /count\(distinct lower\(btrim\(r\.email\)\)\)/,
    'one person submitting three times counts as three people');
});

it('the day spread is reported, so an afternoon cannot pass as a month', () => {
  // The single most useful sanity field: 5 sessions over 5 days is demand,
  // 5 over one afternoon is a tester.
  assert.match(code, /count\(distinct e\.created_at::date\)/, 'the day spread is not computed');
  assert.match(code, /'days_seen'/, 'the day spread is computed and then not returned');
});

it('below the floor it reports zero, not a small number', () => {
  assert.match(code, /v_total < v_floor/, 'the k-anonymity floor is gone');
  assert.match(code, /'enough', false, 'total', 0/,
    'a suppressed result leaks the real total anyway');
  assert.match(mig, /create or replace function public\.demand_min_cluster\(\) returns integer[\s\S]*?select 5/,
    'the floor is no longer 5');
});

it('gem_locked_view is NOT counted as unmet demand', () => {
  // It carries no coordinates, so the count could only ever be zero — and a
  // locked gem is supply that EXISTS, just behind the paywall. Counting it
  // overstates the opportunity to a prospective host.
  assert.doesNotMatch(code, /gem_locked_view/,
    'a paywalled gem is being counted as nobody having anywhere to park');
  assert.match(code, /e\.event_name = 'search_no_results'/, 'the search signal is gone');
});

it('the radius and window cannot be walked out to a national total', () => {
  assert.match(code, /greatest\(0\.5, least\(coalesce\(p_radius_km, 1\.5\), 5\.0\)\)/,
    'the radius is unbounded — it can be widened into a Northern Ireland total or narrowed onto one street');
  assert.match(code, /greatest\(1, least\(coalesce\(p_days, 90\), 365\)\)/, 'the day window is unbounded');
});

it('a nonsense point is refused rather than measured', () => {
  assert.match(code, /p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180/,
    'an impossible coordinate is accepted');
  assert.match(code, /'ok', false, 'reason', 'bad_point'/, 'a bad point returns a number');
});

it('a non-numeric props value cannot error the whole function', () => {
  // props is jsonb TEXT. One bad row would otherwise take down every call.
  assert.match(code, /\(e\.props ->> 'lat'\) ~ /, 'the lat cast is unguarded');
  assert.match(code, /\(e\.props ->> 'lng'\) ~ /, 'the lng cast is unguarded');
});

it('it is service_role only — not anon, not yet', () => {
  // With 10 sessions in the whole database the honest answer nearly everywhere
  // is "not enough to say yet". anon gets this when that stops being true.
  assert.match(mig, /grant execute on function public\.demand_near\([^)]*\) to service_role;/,
    'nothing can call it');
  assert.doesNotMatch(mig, /grant execute on function public\.demand_near\([^)]*\) to [^;]*anon/,
    'demand_near is exposed to anon before the data can support a claim to a host');
  assert.match(mig, /security definer/, 'it cannot read past RLS');
  assert.match(mig, /set search_path = public, pg_temp/, 'a definer function with no pinned search_path');
});

it('it returns counts and never labels, rows or emails', () => {
  // demand_points() does labels and is service_role only; this must not become
  // a second way to read what somebody typed or who they are.
  assert.doesNotMatch(code, /'label'|'query'|'destination'|'email'/,
    'demand_near is returning labels or identities, which is what demand_points is for');
  assert.match(code, /returns jsonb/, 'it no longer returns a single aggregate object');
});

it('parking_requests stopped handing anon more than it needs', () => {
  // The table holds email addresses and anon had SELECT, UPDATE, DELETE and
  // TRUNCATE grants. RLS was the only thing stopping a leak, which makes the
  // table one accidental permissive policy away from giving away every lead.
  assert.match(mig, /revoke all on table public\.parking_requests from anon, authenticated;/,
    'anon keeps blanket grants on a table of email addresses');
  assert.match(mig, /grant insert on table public\.parking_requests to anon, authenticated;/,
    'the signed-out capture form can no longer insert — that breaks the funnel');
  assert.doesNotMatch(mig, /grant (select|update|delete|truncate|all)[^;]*on table public\.parking_requests[^;]*anon/i,
    'anon has been granted read or write access back');
});

it('the founder can ask the question for a specific address', () => {
  assert.match(admin, /p\?\.action === 'demand-near'/, 'there is no way to check an address');
  // Sliced to THIS action's block. `if (!SERVICE)` appears a dozen times in
  // admin.js, so matching it against the whole file proved nothing about this
  // handler — a survived mutation showed exactly that.
  const at = admin.indexOf("p?.action === 'demand-near'");
  assert.ok(at !== -1, 'the demand-near action is gone');
  const block = admin.slice(at, admin.indexOf("p?.action === 'sync-partners'", at));
  assert.ok(block.length > 100 && block.length < 4000, 'the action block could not be isolated');
  assert.match(block, /rpc\/demand_near/, 'the action does not call the function');
  assert.match(block, /!Number\.isFinite\(lat\) \|\| !Number\.isFinite\(lng\)/,
    'a missing or non-numeric coordinate is passed to the database instead of being refused');
  assert.match(block, /if \(!SERVICE\)/,
    'this action runs without the service key and fails obscurely instead of saying what is missing');
  assert.match(block, /p_radius_km/, 'the radius is never passed, so every check uses the default');
});

console.log(`\n  ${passed} checks passed\n`);
