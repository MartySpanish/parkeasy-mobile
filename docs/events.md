# The events pages

Two public pages that turn the events calendar into parking demand:

| route | what it is |
|---|---|
| `/events` | everything on in the next 90 days, grouped by date |
| `/events/{slug}` | one event, a map of the venue, and what is bookable near it |

Both are rendered by `api/events.js` and cached at the edge for **10 minutes**.

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

`vercel.json` rewrites `/events` and `/events/:slug` to the one function; the
slug arrives as a query parameter. Both rules sit **before** the SPA catch-all,
or the React app would answer instead.

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

## The sitemap

`public/sitemap.xml` was hand-written and is now `api/sitemap.js`, for the same
reason the pages are functions: it has to include every event slug in the next
90 days. It serves the full static list (all 24 area pages, `/`, `/hosts`,
`/partners`, `/globe`, `/events`) plus one URL per event.

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
- **The map** is a static image from `staticmap.openstreetmap.de`, already in
  the site's `img-src` CSP. The 500m ring is a CSS circle sized from the
  projection (`156543.03 × cos(lat) / 2^zoom` metres per pixel), not baked into
  the image, so it stays honest if the zoom changes.
