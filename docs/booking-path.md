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

## Tests

`tests/unit/bookingColumns.test.mjs` — 19 checks, 28 mutations, 0 survivors.
Also `tests/unit/bookingLeadTime.test.mjs` for the refusal rules themselves and
`tests/unit/bookingRefusals.test.mjs` for the endpoint's side.
