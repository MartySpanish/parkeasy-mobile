# The booking path

Everything between tapping *Reserve* and being handed to Stripe. One component
(`BookingSheet` in `src/App.jsx`), one column list, and three mirrors of the
server's own refusals.

## The rule: the sheet refuses what the server would refuse

`api/checkout/create-session.js` is the authority on whether a slot can be
sold. If it is going to say no, **the sheet has to say so first** — otherwise a
driver picks a date, types a vehicle registration, taps Pay, and is bounced at
the card form. That reads as a broken payment, not a closed car park.

There are three mirrors, in this order:

| mirror | what it catches | source of truth |
|---|---|---|
| `closedReason` | the date is blocked, outside the term, or not an open weekday | `dateIsOpen()` |
| `spanReason` | a multi-day or weekly booking covers a closed day | `dateIsOpen()` |
| `leadReason` | the slot is over, the start has passed, or there is too little notice | **`src/data/bookingLeadTime.js`** |

`leadReason` calls `startTimeRefusal()` — **the same module the endpoint
imports**, not a second copy of the rules. `src/data/bookingLeadTime.js` is
dependency-free for exactly this reason. A divergence here is a refusal the
driver cannot predict from anything on the screen.

The date picker's floor is `max(today, available_from, noticeFloorDay(listing))`
and the sheet *opens* on `openingDate()`, which applies the same floor. Before
that, a site needing 24 hours' notice opened the sheet on today's date and
contradicted itself on the next line.

## The column list, and the bug that lived in it

`src/data/listingFields.js` holds `BOOKING_COLUMNS`. There are two paths to the
sheet and they used different queries:

- the **Rent tab** → `select('*')` — everything, mirrors worked;
- the **map/search** → a hand-typed column list that did **not** include
  `available_days`, `extra_dates` or `blocked_dates`.

So on the map — the primary way anybody finds a space — `dateIsOpen()` read
`undefined`, treated every day as open, and the driver was refused at the card
form by the exact refusal the mirror exists to prevent. Nothing threw. Nothing
looked wrong. `min_notice_hours` arrived the same way: the guard shipped
server-side and the column was never selected.

`tests/unit/bookingColumns.test.mjs` brace-matches `BookingSheet` out of
`App.jsx`, pulls every `listing.<field>` it reads, and requires each one to be
in the list. **Add a field to the sheet without adding it to the list and the
suite fails** rather than a driver finding out at the card form.

### It is still an explicit list, not `select('*')`

These rows carry `access_method`, `access_contact_name`, `access_contact_phone`
and `instructions` — how to get through a locked gate and whose mobile to ring.
`supabase/migrations/20260728_security_and_integrity.sql` exists to keep those
off a public read. The problem was never that the list was explicit, only that
it was incomplete, and the test asserts both halves: every field the sheet
reads is present, and none of the operational columns is.

`org_registration` is also excluded. Its own form placeholder invites
`"none — explain"`, so it can hold a sentence rather than a register number,
and it is read by a human in the admin approval queue.

## Operator credibility, instead of reviews

Every comparable in the growth audit leans on ratings. ParkEasy has taken **two
real bookings in its life**, so it has no ratings and cannot honestly
manufacture any — `TrustRow` renders nothing at all on every live listing,
which is honest and useless.

What ParkEasy has, and a driveway marketplace does not, is the *site*:

```
✓ Run by Michael Davitt GAC, a local club
✓ 40 spaces on site
✓ Gates open 08:00–17:00
✓ Book 1 day ahead
✓ Verified club
```

`operatorFacts()` builds that list. **Every line is a column, never an
inference.** The rules worth knowing:

- **Nothing says "marshalled", "staffed", "CCTV" or "secure".** There is no
  column for any of it, several of these sites are volunteer-run, and a driver
  who reads "marshalled" and arrives to an empty yard has been told something
  we invented. The test asserts the words do not appear in the output *or* the
  module.
- A **single space** is not listed. "1 space on site" is what a driveway is,
  and saying it reads as a warning.
- **Half a gate window is not a gate window** — both ends or neither.
- **Ratings need three or more**, and a score above zero. One five-star from a
  friend is the easiest number on this page to manufacture. That rule is
  `TrustRow`'s and was kept deliberately.
- Zero completed bookings is **omitted**, not printed as a zero.
- Order is operator → spaces → gates → notice → verified → rating →
  completed: who runs it is the fact a driver cannot get anywhere else, and a
  rating is the one we have least of.

Knowing nothing renders nothing, rather than an empty box.

## Getting found: the Recommended order

The front of the same funnel. The default sort is `popular`, labelled
**Recommended** in the UI, and it ranked by `spot.votes` — seed weights, as the
sort's own comment admits:

> *"`votes` is a weight in the seed data — a couple of thousand of them across
> 297 spots, none given by a driver — so calling this 'Most Popular' claimed a
> popularity nobody measured."*

The label was walked back from "Most Popular" for that reason. **What nobody
noticed is that every bookable listing is built with `votes: 0`**, so the one
kind of space ParkEasy can guarantee sorted below all ~740 seed spots — at the
bottom of a list telling the driver these were our recommendations.

`src/data/spotRanking.js` gives Recommended three tiers:

| tier | what |
|---|---|
| 0 | a **featured** bookable space (`rental_listings.featured`, a decision already in the data) |
| 1 | any other space a driver can reserve and pay for right now |
| 2 | everything else, in exactly the old `votes` order |

### This also favours ParkEasy, and the page says so

The honest argument is that a space you can reserve before leaving the house
answers the question this app exists to answer — *will I get a space* — and a
street with a hand-assigned weight does not. A listing with no weight is not
one that scored zero on a measured scale; it is one the scale was never about.

But it does put the revenue line on top, so:

- the free spots are **not** hidden, removed, or demoted below anything new —
  tier 2's internal order is byte-for-byte the old comparator, and the test
  asserts that;
- community finds already carried `votes: 0` and sit exactly where they sat;
- a `RankNote` on the page says *"Spaces you can reserve are shown first"* and
  points at **Free First**, one tap away. It renders on **both** results
  surfaces — the list and the map sheet share `sortBy`, so both are reordered,
  and a note on one but not the other would imply the other was not.
- The note is omitted when nothing in the results is bookable, which on most
  searches is the case.

### Bookability is an explicit flag, never the badge

A live listing outside its availability window is mapped to badge `paid` when
sellable and `free` when not. Ranking on the badge would put a space whose
Reserve button never appears at the top of the list — Belfast Royal Academy,
whose window closed in August, is exactly that row. `App.jsx` sets
`bookable: sellableNow(l)`, the same test checkout uses.

### There is no "Official" tier

Item 9 of the comparables audit asked for one, ready for the ICC Belfast
conversation. **It is not built, deliberately.**

`official` already means something factual and load-bearing — a real car park
with a named operator, as against a street somebody guessed at — and it is on
roughly sixty NCP, Q-Park, Belfast City Council and Translink car parks that
have **no relationship with ParkEasy whatsoever**. Reusing it as a commercial
tier would sell a venue a label those sixty already carry for free, and would
destroy the one piece of information the badge conveys. A separate "partner"
badge would have had zero members, since the APCOA listings are still blocked.

What a venue actually wants is to be the answer when somebody searches their
venue. That is `/venue/{slug}` — which exists, with their own fixture list on
it — plus being bookable, which this ordering now rewards.

## Tests

`tests/unit/bookingColumns.test.mjs` — 20 checks, 28 mutations, 0 survivors.
`tests/unit/spotRanking.test.mjs` — the Recommended order, including that the
free spots keep their old order and that `official` is not repurposed.
Also `tests/unit/bookingLeadTime.test.mjs` for the refusal rules themselves and
`tests/unit/bookingRefusals.test.mjs` for the endpoint's side.
