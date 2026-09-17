// What each tier buys, and the two ways it could quietly be given away.
//
// The partner columns sat unused for months, so every partner has had the same
// card for nothing. Now that a card costs £25 a month, the interesting failures
// are the ones where somebody gets it without paying:
//
//   - an unknown or missing tier treated as "show the card";
//   - the query filter dropped, so every partner is fetched and rendered;
//   - sponsored losing its boost, so the £60 tier is the £25 tier.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIERS, CARD_TIERS, rendersCard, hasConfirmationSlot, sortWeight, priceLabel } from '../../src/partnerTiers.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const partners  = read('../../src/partners.js');
const migration = read('../../supabase/migrations/20260907_partner_tiers.sql');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npartnerTiers — a card is the thing being sold');

it('free gets a pin, not a card', () => {
  assert.equal(rendersCard('listed'), false, 'the free tier renders a card');
  assert.equal(TIERS.listed.pricePence, 0, 'the free tier is not free');
  assert.ok(!CARD_TIERS.includes('listed'), 'listed is in the card query');
});

it('the paid tiers get one', () => {
  for (const t of ['featured', 'sponsored']) {
    assert.equal(rendersCard(t), true, `${t} does not render a card`);
    assert.ok(CARD_TIERS.includes(t), `${t} is missing from the card query`);
    assert.ok(TIERS[t].pricePence > 0, `${t} costs nothing`);
  }
  assert.ok(TIERS.sponsored.pricePence > TIERS.featured.pricePence,
    'sponsored does not cost more than featured');
});

it('an unknown tier renders NOTHING', () => {
  // The strict direction on purpose. Treating unknown as featured means a typo,
  // or a tier added to the database before the app knows about it, hands out a
  // paid placement for free.
  for (const t of [undefined, null, '', 'platinum', 'FEATURED', 'local', 'founding']) {
    assert.equal(rendersCard(t), false, `"${t}" is being rendered as a paid card`);
  }
});

it('sponsored outranks featured, without flattening the hand-set order', () => {
  const featuredHigh  = { tier: 'featured',  priority: 20 };
  const sponsoredLow  = { tier: 'sponsored', priority: 1 };
  assert.ok(sortWeight(sponsoredLow) > sortWeight(featuredHigh),
    'a sponsored partner does not outrank a featured one — the £60 tier buys nothing');

  // Inside a tier, Marty's hand-tuned priority still decides.
  assert.ok(sortWeight({ tier: 'featured', priority: 20 }) > sortWeight({ tier: 'featured', priority: 6 }),
    'priority no longer orders partners within a tier');
  assert.ok(sortWeight({ tier: 'sponsored', priority: 20 }) > sortWeight({ tier: 'sponsored', priority: 6 }),
    'priority no longer orders sponsored partners between themselves');

  // The boost has to exceed any realistic priority, or a high-priority featured
  // partner beats a sponsored one and the tier means nothing.
  assert.ok(TIERS.sponsored.boost > 100,
    `the sponsored boost is ${TIERS.sponsored.boost}, small enough for priority to overtake it`);
});

it('only sponsored gets the booking-confirmation slot', () => {
  assert.equal(hasConfirmationSlot('sponsored'), true, 'sponsored lost its confirmation slot');
  assert.equal(hasConfirmationSlot('featured'), false, 'featured is getting the sponsored benefit');
  assert.equal(hasConfirmationSlot('listed'), false, 'the free tier is getting the sponsored benefit');
});

it('the query fetches only paying tiers, and the render still double-checks', () => {
  assert.match(partners, /\.in\('tier', CARD_TIERS\)/,
    'the partner query no longer filters by tier — a listed partner would render a card');
  assert.match(partners, /\.filter\(\(p\) => rendersCard\(p\.tier\)\)/,
    'the render-side guard is gone; dropping the query filter would then show every partner');
  assert.match(partners, /sortWeight\(b\) - sortWeight\(a\)/,
    'partners are no longer sorted by tier');
});

it('the migration cannot silently pull a live partner’s card', () => {
  // Eleven real businesses are active with tier null. A default of 'listed'
  // without this backfill removes every one of their cards on deploy.
  assert.match(migration, /update public\.partners\s*\n\s*set tier = 'featured'\s*\n\s*where tier is null\s*\n\s*and active = true;/,
    'the grandfathering backfill is gone — live partners would lose their cards');
  assert.match(migration, /% active partners were downgraded out of a card by this migration/,
    'the migration no longer asserts that nobody lost a card');
  assert.match(migration, /alter column tier set default 'listed'/,
    'a new partner no longer defaults to the free tier');
});

it('prices read the way they are sold', () => {
  assert.equal(priceLabel('listed'), 'Free');
  assert.equal(priceLabel('featured'), '£25/mo');
  assert.equal(priceLabel('sponsored'), '£60/mo');
  assert.equal(priceLabel('nonsense'), '—');
});

console.log(`\n  ${passed} checks passed\n`);
