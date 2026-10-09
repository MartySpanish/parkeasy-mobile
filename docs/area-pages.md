# The /area pages

Thirty static pages under `public/area/`, pre-rendered and then upgraded by two
build steps. Twenty-four are towns; six are Belfast destinations with their own
injector.

## The defect: we were recommending the competition

`scripts/inject-area-cta.mjs` already named this, for Belfast:

> *"/area/belfast.html — the page every social post pointed at — named Victoria
> Square, CastleCourt, Q-Park, NCP, Titanic and the SSE, and did not mention a
> single space ParkEasy can sell."*

That fix added a block for **bookable** inventory. There is bookable inventory
in **exactly one town**. So the other twenty-three town pages were still ~475
words of hand-written prose naming the Tower Centre, Fairhill, The Quays and
Buttercrane — competitors, every one — followed by *"We don't have a bookable
space in Ballymena yet"*, and nothing else.

Meanwhile ParkEasy holds **8 to 71 publishable spots in each of those towns**,
with prices, free windows and capacities. Not one appeared on the page. We were
paying for traffic to a page that recommends somebody else's car park.

`scripts/inject-area-spots.mjs` fixes that: the same treatment
`inject-destination-pages.mjs` gives the six destinations, applied to the towns.
Ballymena went from 475 words to 830, with real prices and capacities.

## `_city` is the slug

A spot's `_city` is the key it was filed under, and `generate-globe-data.mjs`
notes those keys **are** slugs — so the match is on the slug, not the town name.

Matching by name made Derry look empty: the dataset calls that town
**`Derry~Londonderry`**. It has 33 spaces. That near-miss is why the test
asserts every town page has spots under its own slug.

## Item 10 of the audit, as a guard

> *"Stop adding towns"* — a policy, not a change.

A policy nobody enforces is a comment, so it's a floor instead: **a town page
needs at least 8 publishable spots.**

The number comes from the gap in the data, not from taste:

| | spots |
|---|---|
| thinnest page that exists (Newtownabbey) | 8 |
| Bangor, Ballycastle, Lisburn | 11–12 |
| the towns someone would add next — Armagh, Newtownards, Holywood, Comber, Kilkeel, Limavady, Warrenpoint | **1–2 each** |

A floor of 8 sits at the bottom of everything shipped and far above every
candidate, so it blocks the sprawl without invalidating a single existing page.

## What these pages must never claim

**No hidden gem, ever.** Gems are the paid half of the product and an `/area`
page is static HTML built to be crawled — naming one gives it away permanently
and to everyone, and publishing is the one direction that cannot be undone.
`isPublishable()` excludes them and the build throws if a gem's name appears
anywhere in a finished page, prose included.

> The rules live in `src/data/areaSpots.js` rather than in the build script, and
> the mutation pass is why. With them inline, **deleting `isPublishable` from the
> filter survived the entire test file** — the only check that could see it read
> the *built* pages, and a test run does not rebuild. A guard that only fires
> after a deploy is not a guard.

**No distance and no walking time.** A destination page can say "4 min walk ·
310 m" because it knows the postcode it measures from. A town page has no such
point, so it says nothing rather than measuring from a centre nobody defined.

**No price twice.** The row's right-hand chip carries it; `detail()` must not.
Including it in both printed every paid spot as
`£1/hr (1st hr) … · £1/hr (1st hr) · 1100 spaces`.

**No silent truncation.** Belfast has 71 publishable spots and its page already
carries the booking block and the prose, so the list is capped at 14 — and the
copy says *"14 of the 71"*. Sixteen of the twenty-four towns are capped.

## The CTA

`?town=<slug>` **is not a route.** `src/App.jsx` parses `near` and `place` and
nothing else, so a town parameter lands the visitor on the generic home screen
— the dead end `inject-area-cta.mjs` says no page may be.

So the button uses the deep link that works, centred on the **median** of the
spots the page just listed. Median per axis, not mean: add one spot mis-filed
under the wrong town at `(0,0)` and the mean of Ballymena's spots lands at
**51.6366** — in the sea off Cornwall — with the CTA sending every visitor
there. The median doesn't move past the fourth decimal.

`median()` rejects `null` and `''` before `Number()`, because `Number(null)` is
`0` and a spot with a missing latitude would otherwise have voted for the
equator. That is the second time this exact trap has turned up in this codebase;
`distanceLabel()` in `api/_eventsView.js` has the same guard for the same
reason.

## Ordering

Real car parks first (`official`, then `paid`, then `timed`), then everything
else; alphabetical within a tier. A named multi-storey with published hours is
more use to somebody reading "parking in Ballymena" than an unnamed stretch of
kerb, and there is no popularity signal worth ranking on — `votes` is seed
weight, as `src/data/spotRanking.js` sets out at length.

Alphabetical within a tier keeps the built output **stable**, so a diff in
`dist/area` means the data changed. De-duplicated by name, because the same
lay-by is sometimes filed under two towns.

## Tests

`tests/unit/areaSpots.test.mjs` — 16 checks, 25 mutations, 0 survivors. Two
survivors on earlier passes were real holes, both fixed rather than accepted:
the gem leak above, and a stale-data warning that could be deleted from the
capped copy branch (16 of 24 pages) while a single-match assertion still passed.
