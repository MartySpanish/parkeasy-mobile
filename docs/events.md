# The events pages

Three public pages that turn the events calendar into parking demand:

| route | what it is |
|---|---|
| `/events` | everything on in the next 90 days, grouped by date |
| `/events/{slug}` | one event, a map of the venue, and what is bookable near it |
| `/venue/{slug}` | one venue: how parking works there, and every fixture on the books |

All three are rendered by `api/events.js` and cached at the edge for
**10 minutes**.

## Why they are functions and not files

The rest of ParkEasy's SEO pages (`/hosts`, `/partners`, `/area/*.html`) are
written into `public/` and shipped by the build. That works because they change
when somebody edits them.

Events do not. The weekly sweep (a Routine, see `list_triggers`) writes new rows
straight into `public.events` without a deploy, so a built page would list last
week's fixture and miss next Saturday's. These two pages are therefore rendered
per request and cached:

```
Cache-Control: public, s-maxage=600, stale-while-revalidate=3600
```

Ten minutes is the freshness; `stale-while-revalidate` means a visitor is never
the one waiting for Postgres — they get the slightly old copy instantly while
the next one is built behind them.

`vercel.json` rewrites `/events`, `/events/:slug` and `/venue/:slug` to the one
function; the slug arrives as a query parameter (`slug` or `venue`). All three
rules sit **before** the SPA catch-all, or the React app would answer instead.

## Demand tiers

`demand_tier` is a column on `public.events`, written by the weekly sweep from
expected attendance. The colours are the app's own semantic accents — the same
scale the parking badges use, where red means "act now".

| tier | attendance | chip |
|---|---|---|
| `major` | 15,000+ | red |
| `high` | 5,000–15,000 | orange |
| `medium` | 1,500–5,000 | yellow |
| `low` | under 1,500 | grey |

**The column is the truth, not the band.** The bands are what the sweep uses to
assign a tier, but a human can override one — a fixture that draws badly for its
size, or a small event in a street with nowhere to park. The pages read the
column and never re-derive it. An unrecognised value renders as `low` rather
than throwing, because the sweep writes free text.

## Where the data comes from

Only two things are read, both already public:

- `public.upcoming_events` — the view joining events to venues, which already
  carries `bookable_spaces_within_2km`.
- `public.rental_listings` — the same table and the same `status = 'active'`
  filter the app uses for bookable spaces.

`api/_supabase.js` reads them with the **anon key**, not the service key that
the rest of `api/` uses. These pages render what is already public, so RLS
should be the thing enforcing that — with the service key a mistyped filter
would quietly publish a draft listing and nothing would say so. The policies
already say the right thing (`events: status <> 'cancelled'`, `venues: active`,
`rental_listings: status = 'active'`), which is why a cancelled event returns a
404 here rather than a page.

Distance to nearby listings is computed in JavaScript, not SQL — the columns are
plain `lat`/`lng` with no PostGIS index, and at this row count that is nothing.

## The CTAs

The brief this was built from asked for `/park/{venue_slug}`. **There is no such
route** — in this codebase the app *is* the parking finder. So the CTAs deep-link
into it, already searched at the venue:

```
/?near=54.5934,-5.9317&place=Ulster%20Hall&event=mac-demarco-ulster-hall-2026-08-31
```

`src/App.jsx` parses `near` into `SearchTab`'s initial `geo`, so the visitor
lands on results rather than an empty search box. A malformed pair is ignored.

When nothing is bookable within 2km, the page swaps the listings panel for a
host-recruitment panel pointing at `/hosts?venue={venue_slug}` — those venues
are exactly where a host is worth signing.

## `/venue/{slug}`

`/events/{slug}` answers *"where do I park for this gig"*. Nothing answered
*"where do I park at the Ulster Hall"* — which is what somebody types when they
have tickets for something we never listed, and what a venue's own box office
searches for. There are **16 active venues** (Casement Park is a building site
and is `active = false`) and **313 upcoming fixtures** between them, so this is
the hub those event pages link up into rather than each being an orphan.

**The parking notes lead, not the bookable spaces.** `nearbyListings()` returns
only listings we can actually sell, and 13 of the 15 venues with fixtures have
none within 2km — a bookable-first page would be empty on nearly every venue.
`parking_notes` is populated on all 17 rows and is what the page's own title
promises to answer, so it goes first.

### A venue with no fixtures is not indexed

Its page is about ninety words of parking notes, which is the same thin-content
problem the six destination pages had before PR #264 gave them real spots. So:

- the page renders for anyone with the link,
- it carries `<meta name="robots" content="noindex,follow">` until the venue has
  an upcoming event,
- and it earns the index on the next render once the sweep adds one — no deploy.

`api/sitemap.js` uses the **identical** condition, derived from the rows it has
already fetched, so a URL the sitemap advertises is never one the page tells
Googlebot to ignore. That contradiction cost the destination pages a release.

### The one read that is not through a view

`fetchVenue()` reads `public.venues` **directly**. Everything else on these
pages goes through `upcoming_events`, which is a view — so a view-owner grant
is enough for it, and nothing in this codebase has ever proved that `anon` can
`SELECT` the venues *table*. If it cannot, PostgREST answers 401 and all
sixteen venue pages would quietly 404 while looking entirely healthy: no error,
no empty state, just sixteen URLs that are not there.

So the indexable content comes from a source we know `anon` can read:

- the table read **fails** → the venue is rebuilt from one of its own events
  (`venueFromEvents()`), and the sitemap takes its slugs from the same place;
- the table read comes back **empty** → that is a correct 404. The venue does
  not exist, or it is `active = false` (Casement Park, a building site). Falling
  back here would publish a page for a venue we deliberately switched off.

The fallback carries no `town`, street address, `venue_type` or `website_url` —
the view does not have them — and `renderVenue()` omits each rather than
printing a blank. The table is still preferred whenever it is readable, because
it is the authoritative answer to *"is this venue still active"*.

### No precise distances, and no walking times

`venues.geo_verified` is **false on 16 of the 17 rows**. The event page used to
print `${Math.round(d)}m away` — one-metre precision derived from two pins,
neither of them surveyed, on the line where somebody decides whether they can
walk it. `distanceLabel()` now bands it on both pages:

| distance | rendered |
|---|---|
| missing or nonsense | `nearby` |
| under 100m | `under 100m away` |
| under 1km | `about 350m away` (nearest 50m) |
| 1km or more | `about 1.6km away` |

There is no walking time at all. Minutes would need a route; what we have is a
straight line.

### Schema

`Place` for the venue, plus an `ItemList` of its events built from **the same
array the page renders**, so the schema can never advertise a fixture the
visitor cannot see. Each event points at the `Place` by `@id` rather than
repeating the address.

`ParkingFacility` is deliberately **not** used: it would say the Ulster Hall is
a car park, which it is not. The private driveways nearby are not published as
facilities either — their addresses are not ours to put in a search index.

## The sitemap

`public/sitemap.xml` was hand-written and is now `api/sitemap.js`, for the same
reason the pages are functions: it has to include every event slug in the next
90 days. It serves the full static list (all 24 area pages, `/`, `/hosts`,
`/partners`, `/globe`, `/events`) plus one URL per event, plus one URL per
venue **that has a fixture** — see the noindex rule above. Venues are read from
the database rather than listed here, because the sweep can add one without a
deploy.

If Supabase is unreachable it drops the events and still returns the static
pages with a 200, cached for one minute rather than ten. A sitemap missing its
events is a bad day; a sitemap returning 503 to Googlebot is a worse one.

`tests/unit/eventsPages.test.mjs` pins the old hand-written list verbatim, so
the generated sitemap can never quietly come back smaller than the file it
replaced.

## Gotchas

- **Times are `timestamptz`.** Everything is formatted with
  `timeZone: 'Europe/London'`. Format with the server's clock and every summer
  gig reads an hour early — nothing throws, the page just lies.
- **Event names are user-written**, via a scraped listings page. They are HTML
  escaped, and the JSON-LD is escaped separately so it cannot close its own
  `<script>` tag.
- **The map is drawn, not fetched** — `api/_venueMap.js`. It used to be a static
  image from `staticmap.openstreetmap.de`; the OpenStreetMap wiki marks that
  hosted service discontinued, so both page types were serving a broken image
  under a credit line for a map that was not there. What replaced it is an
  inline SVG showing each bookable space at its true bearing and distance from
  the venue, numbered to match the panel beneath it. No request, no key, no
  quota, no external origin — and it cannot disagree with the list, because
  both are built from the same rows.
  - Directions are only printed above `DIRECTION_MIN_M` (150m). A compass
    sector is 45° wide and these pins are unsurveyed, so closer than that a
    small pin error flips the sector and the page would state the wrong
    direction confidently.
  - A real street map belongs on top of this the day the **Maps Static API** is
    enabled with billing on the Google project. The URL to use is in the note at
    the foot of `api/_venueMap.js`; `maps.googleapis.com` is already in
    `img-src`. It needs a verified-once check rather than a key check — a key
    being present says nothing about whether the API behind it is switched on,
    and an `<img>` pointed at a disabled API is a 403, which is the bug that was
    just removed.
