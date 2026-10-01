// Which partners are allowed in front of the first parking space.
//
// THE COMPLAINT, verbatim: "I searched for waterfront and got a lot of partners
// to scroll through before I could see a space."
//
// The cause was a proximity test and nothing else. Any partner with a trusted
// pin within 1.5km of the searched place led the results, and in Belfast city
// centre that is nearly every partner in the table — so a search for the
// Waterfront returned a screen of adverts to somebody who had just typed a
// destination and wanted somewhere to park. Proximity turned out to carry no
// information at all in a city centre, where everything is near everything.
//
// A category TAP still leads, and should: that is a driver saying what they
// want. A PLACE is not the same statement — it says where they are going, not
// what they are going for. So leading a place now needs the partner to be the
// kind where parking is part of the errand (a hotel), and at most one of them.
//
// Nobody is removed from the app: a partner that stops leading keeps its
// interleaved slot further down the list. This moves adverts, it does not
// delete anybody's placement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  splitPartnersByCategory, PARTNER_CATEGORIES, LEADS_ON_PLACE, MAX_PLACE_LEADS,
} = await import('../../src/data/partnerCategories.js');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');

// The Waterfront, and a set of partners all sitting on top of it — which is
// what the real table looks like from a city-centre search.
const WATERFRONT = { lat: 54.5967, lng: -5.9227, label: 'Waterfront Hall, Belfast' };
const at = (slug, over = {}) => ({
  slug, id: slug, geo_verified: true, lat: 54.5967, lng: -5.9227, ...over,
});
const CITY_CENTRE = [
  at('tara-lodge'),               // hotel
  at('the-red-devil'),            // bar
  at('bfast'),                    // gym + fightwear
  at('gransha-grill'),            // café
  at('sandy-mcdermott-sc'),       // gym
  at('jack-daniels-fitness'),     // gym
  at('sbg-maeda-belfast'),        // gym
  at('marcus-donnelly-fitness'),  // gym
  at('unlisted-partner'),         // in no category at all
];

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npartnerLeads — a place search is not a request for adverts');

it('searching a place no longer stacks adverts above the first space', () => {
  const [lead] = splitPartnersByCategory(CITY_CENTRE, null, WATERFRONT);
  // The actual bug: nine partners on top of the Waterfront, nine leading cards.
  assert.ok(lead.length <= MAX_PLACE_LEADS,
    `a place search leads with ${lead.length} partners — this is the Waterfront complaint again`);
  assert.ok(MAX_PLACE_LEADS <= 2, 'the cap has been raised past what anybody would scroll');
});

it('the one that does lead is the hotel, not whatever was closest', () => {
  const [lead] = splitPartnersByCategory(CITY_CENTRE, null, WATERFRONT);
  assert.deepEqual(lead.map(p => p.slug), ['tara-lodge'],
    'a place search leads with something other than the hotel');
  // Sitting at the exact same coordinates, so distance cannot be what picked it.
  const bar = CITY_CENTRE.find(p => p.slug === 'the-red-devil');
  const hotel = CITY_CENTRE.find(p => p.slug === 'tara-lodge');
  assert.equal(bar.lat, hotel.lat, 'the fixture no longer puts them in the same place, so this proves nothing');
});

it('a gym, a bar and a café cannot lead a place, however close they are', () => {
  for (const slug of ['the-red-devil', 'gransha-grill', 'sandy-mcdermott-sc', 'bfast']) {
    const [lead] = splitPartnersByCategory([at(slug)], null, WATERFRONT);
    assert.deepEqual(lead, [], `${slug} leads a place search on proximity alone`);
  }
  // And an untagged partner leads nothing, rather than defaulting to leading.
  assert.deepEqual(splitPartnersByCategory([at('unlisted-partner')], null, WATERFRONT)[0], [],
    'a partner in no category at all leads a place search');
});

it('nobody is dropped — a partner that stops leading moves down, not out', () => {
  // The thing that must NOT happen while fixing an advert problem: a business
  // paying for a placement quietly vanishing from every search.
  const [lead, rest] = splitPartnersByCategory(CITY_CENTRE, null, WATERFRONT);
  assert.equal(lead.length + rest.length, CITY_CENTRE.length,
    'partners are being lost between the two groups');
  const seen = [...lead, ...rest].map(p => p.slug);
  assert.equal(new Set(seen).size, seen.length, 'a partner appears in both groups');
  for (const p of CITY_CENTRE) assert.ok(seen.includes(p.slug), `${p.slug} is gone from the results entirely`);
  // And there are enough interleaved slots to actually render the ones that
  // moved — a slice shorter than `rest` is how partners have silently gone
  // missing six times before. See partnerSlots.test.mjs.
  const slots = JSON.parse(/const PARTNER_SLOTS = (\[[^\]]*\]);/.exec(app)?.[1]
    ?? assert.fail('PARTNER_SLOTS not found in App.jsx'));
  assert.ok(slots.length >= rest.length,
    `${rest.length} partners moved to the interleaved slots but there are only ${slots.length}`);
});

it('a second hotel waits its turn rather than doubling the stack', () => {
  // TODAY'S ROSTER HAS ONE HOTEL, so the cap never bites with real data and
  // neither does the path that moves the overflow into `rest`. Both are
  // untested the moment a second hotel signs — which is exactly when they
  // first run in production. Two hotel-tagged rows, built with the same slug
  // and distinct ids because the category lookup is by slug and what is under
  // test is the cap, not the roster.
  const hotels = [
    { slug: 'tara-lodge', id: 'hotel-a', geo_verified: true, lat: 54.5967, lng: -5.9227 },
    { slug: 'tara-lodge', id: 'hotel-b', geo_verified: true, lat: 54.5968, lng: -5.9228 },
  ];
  const [lead, rest] = splitPartnersByCategory(hotels, null, WATERFRONT);
  assert.equal(lead.length, MAX_PLACE_LEADS, 'the cap is not being applied');
  assert.deepEqual(lead.map(p => p.id), ['hotel-a'],
    'the cap keeps the wrong one — priority order underneath must decide');
  // The second one MOVED, it did not disappear. A business paying for a
  // placement must never be silently dropped by an advert-reduction change.
  assert.deepEqual(rest.map(p => p.id), ['hotel-b'],
    'the hotel over the cap is gone from the results instead of moved down the list');
  assert.equal(lead.length + rest.length, hotels.length, 'a partner was lost');
  // And never in both groups at once — that renders the same advert twice.
  assert.equal(new Set([...lead, ...rest].map(p => p.id)).size, hotels.length,
    'a partner appears both above the results and in an interleaved slot');
});

it('tapping a category still leads with that category — that part was not broken', () => {
  // A tap is the clearest statement of intent a driver gives, and the gyms we
  // feature ARE the answer to "Gyms & Wellbeing". Unchanged on purpose.
  const [lead] = splitPartnersByCategory(CITY_CENTRE, 'fitness', WATERFRONT);
  const gyms = lead.filter(p => (PARTNER_CATEGORIES[p.slug] || []).includes('fitness'));
  assert.ok(gyms.length >= 4, 'tapping a category no longer leads with that category');
  // Category matches come first, before any proximity lead.
  assert.ok((PARTNER_CATEGORIES[lead[0].slug] || []).includes('fitness'),
    'something that merely happens to be nearby is above the gyms the tile is about');

  // AND NEVER TWICE. Tara Lodge is tagged both 'hotels' and 'nightout', so
  // tapping "Pubs & Nights Out" near the Waterfront makes it qualify on BOTH
  // counts at once — the one shape of input that can put a partner in two
  // groups and render the same advert twice on one screen. The function's own
  // header calls this the bug that would otherwise reach production unnoticed,
  // and no other fixture here produces it.
  const [nl, nr] = splitPartnersByCategory(CITY_CENTRE, 'nightout', WATERFRONT);
  const taras = [...nl, ...nr].filter(p => p.slug === 'tara-lodge');
  assert.equal(taras.length, 1,
    'a partner matching the tapped category AND eligible to lead on place is rendered twice');
  assert.ok(nl.some(p => p.slug === 'tara-lodge'), 'the hotel the tile is about stopped leading it');
  assert.equal(nl.length + nr.length, CITY_CENTRE.length, 'a partner was lost on a category tap');
});

it('with neither a category nor a place, nothing leads', () => {
  const [lead, rest] = splitPartnersByCategory(CITY_CENTRE, null, null);
  assert.deepEqual(lead, [], 'the landing screen leads with partners again');
  assert.equal(rest.length, CITY_CENTRE.length);
  // And the empty cases do not throw.
  assert.deepEqual(splitPartnersByCategory(null, null, WATERFRONT), [[], []]);
  assert.deepEqual(splitPartnersByCategory([], 'fitness', null), [[], []]);
});

it('the allowed list stays about parking, not about who is nearby', () => {
  // If this grows to include cafés or gyms, the Waterfront screen comes back.
  assert.ok(LEADS_ON_PLACE.length > 0, 'no partner can lead a place at all now');
  assert.ok(LEADS_ON_PLACE.includes('hotels'), 'the hotel case — the one that was asked for — is gone');
  for (const c of ['fitness', 'brunch', 'nightout', 'shopping'])
    assert.ok(!LEADS_ON_PLACE.includes(c),
      `'${c}' can lead a place search again — this is what put nine adverts above the Waterfront`);
  assert.ok(LEADS_ON_PLACE.length <= 3, 'the allowed list has grown into "everyone"');
});

it('distance still has to be satisfied, so the rule cannot be read as "always show the hotel"', () => {
  const far = at('tara-lodge', { lat: 54.9, lng: -6.5 });   // up near Ballymena
  assert.deepEqual(splitPartnersByCategory([far], null, WATERFRONT)[0], [],
    'a hotel 40km away leads a Belfast search');
  // Pinned just outside the radius as well, not only absurdly far away. A
  // hotel across town is still the wrong answer to "parking at the Waterfront",
  // and a radius quietly widened to cover the whole city would pass a 40km
  // check while putting it back on the screen.
  const acrossTown = at('tara-lodge', { lat: 54.5967, lng: -5.86 });   // ~4km east
  assert.deepEqual(splitPartnersByCategory([acrossTown], null, WATERFRONT)[0], [],
    'a hotel several km away leads the search — the radius has been widened');
  // And the radius still has to let a genuinely adjacent one through, or the
  // check above would pass with the feature switched off entirely.
  const nextDoor = at('tara-lodge', { lat: 54.5975, lng: -5.9240 });
  assert.deepEqual(splitPartnersByCategory([nextDoor], null, WATERFRONT)[0].map(p => p.slug),
    ['tara-lodge'], 'a hotel two streets away no longer leads');
  // An untrusted pin is still untrusted: those coordinates are the city-centre
  // placeholder the NOT NULL columns demand and measure nothing.
  const unverified = at('tara-lodge', { geo_verified: false });
  assert.deepEqual(splitPartnersByCategory([unverified], null, WATERFRONT)[0], [],
    'a partner with no confirmed coordinate leads on a distance that means nothing');
});

console.log(`\n  ${passed} checks passed\n`);
