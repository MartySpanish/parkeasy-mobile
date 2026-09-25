# The funnel: where people drop off, and the win-back list

Written for Marty. Jargon gets one line the first time it appears.

## The short version

You already had all three funnel events, an `app_events` table behind a locked
door, and an admin screen with conversion rates. Two things were missing, and
one of them was quietly making your problem look worse than it is.

| Asked for | State before | Now |
| --- | --- | --- |
| `listing_viewed` event | ✅ exists as **`listing_view`** | unchanged |
| `booking_started` event | ✅ exists as **`booking_start`** | unchanged |
| `booking_completed` event | ⚠️ exists as **`booking_paid`**, but **browser-only** | also logged by the Stripe webhook |
| Admin funnel + conversion % | ✅ exists, with a day range | booking count corrected |
| Export of never-booked emails | ❌ did not exist | `users_never_booked` + a script |

## The thing that was wrong

`booking_paid` was recorded in **one** place: your app, at the moment the
driver's browser comes back from Stripe to parkeasy.uk.

That means a driver who paid and then closed the tab, or lost signal in a
basement car park, or answered a phone call, **paid you and was never counted**.
Their money is in Stripe and their booking is in the `bookings` table — but the
funnel never heard about it.

So the one number that tells you whether anything is working was being measured
on the least reliable part of the whole journey. "Almost no completed bookings"
may be partly a measurement problem, not only a product one. You will find out
within a day of this going live.

### How it is fixed

A **webhook** is Stripe's servers calling your server directly to say what
happened, instead of relying on the customer's browser to carry the news. It
retries for days if your site is down. You already had one; it marked the
booking paid and sent the emails — it just never told the funnel.

The chain now works like this:

1. The app puts its **browsing session id** (a random id for "this browser",
   not a person) into the checkout as **metadata** — a small note you attach to
   a Stripe payment that comes back to you later.
2. Stripe hands that note back on the webhook when the payment succeeds.
3. The server logs `booking_paid` under **that same session id**.

Because both sides use the same id, the browser's own event and the server's
event are one booking, not two. And if the browser never comes back, the server
has already counted it.

### Two ways this could have gone wrong, and what stops them

**Counting the same payment twice.** Stripe promises to deliver a webhook *at
least* once — the same payment can arrive three times. A **unique index** (a
database rule that refuses a duplicate row) keyed on the Stripe checkout id
means one payment can only ever produce one event, however many times Stripe
tells us.

**Silently losing bookings again.** The funnel counts *distinct sessions*, which
is right — one person opening three listings is one person. But that count
ignores rows with no session id, and a webhook-logged booking has none whenever
the app did not send one (an older version, a browser with storage blocked). So
paid bookings would have sat in the table, invisible on the dashboard: the same
undercount in a new place. `booking_paid` is now counted as *one per browsing
session, plus one per paid booking that has no session but does have a Stripe
checkout id*. Every real booking counts once; none counts twice.

## Where to look

**Admin dashboard → Metrics.** It was already there: the **Listing → booking**
funnel shows the three counts with the conversion percentage between each step,
and the number box at the top sets how many days to include (it defaults to
366). The Premium funnel and the "searched and found nothing" list sit beside
it.

Nothing about that screen changed except that the bottom number is now true.

## The win-back list

**"Never booked" means never PAID.** Somebody whose card was declined, or who
reached checkout and gave up, still has a row in `bookings` — and they have
still never parked with you. They are the most winnable people on the list, and
the obvious query ("has no booking row") drops every one of them.

It also matches on **email as well as account**, because a guest checkout has no
account attached; somebody who booked as a guest and signed up later is not
somebody to win back.

### The quick way — paste this into Supabase

Supabase dashboard → **SQL Editor** → paste → Run. Then use the *Download CSV*
button above the results.

```sql
select email, registered_at, days_since_signup
  from users_never_booked
 order by registered_at desc;
```

That view is created by the migration below. (A **migration** is a file of
database changes kept in the repo, so the database can be rebuilt exactly and
nobody has to remember what was clicked.)

Only registered a while ago? Add a filter:

```sql
select email, registered_at, days_since_signup
  from users_never_booked
 where days_since_signup >= 30
 order by registered_at desc;
```

### The repeatable way — a script

```bash
SUPABASE_URL=https://bbgqregyogtjzaustbng.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<your service role key> \
  node scripts/export-never-booked.mjs > winback.csv
```

- `--days 30` — only accounts older than 30 days
- `--count` — just the number, nothing else

Both values are in Supabase under **Project Settings → API**. The
**service-role key is the master key to your whole database**: it belongs on
your own machine and in Vercel's environment settings, never in the app, never
in a commit, never pasted into a chat. The script reads it from the command
line for exactly that reason, and a check in the test suite fails if anybody
ever pastes a key into the file.

### Before you send that email

Two things worth a minute, neither of them code:

- These people registered with you, so contacting them about the service they
  registered for is ordinarily fine — but every message needs a working
  unsubscribe, and anybody who has already opted out should come off the list
  before you send.
- 477 addresses from a new domain in one go is how a domain gets marked as
  spam. Send in batches over a few days.

## Tests

```
node tests/unit/bookingPaid.test.mjs          # 10 checks, 32 mutations
tests/db/run.sh tests/db/booking_paid_seed.sql \
  supabase/migrations/20260625_rental_listings.sql \
  supabase/migrations/20260724_stripe_connect.sql \
  supabase/migrations/20260902_app_events_ingest.sql \
  supabase/migrations/20260925_booking_paid_authoritative.sql \
  tests/db/booking_paid.test.sql              # 40 checks, 27 mutations
```

Both are in `npm test`. Every check was verified by deliberately breaking it
first — including the one that found the sessionless-booking undercount above,
which was a bug in my own fix rather than in the old code.

`tests/db/harness.sql` gained a `created_at` column on its stand-in
`auth.users`, which real Supabase has and the test copy did not.

## Deploying it

Apply `supabase/migrations/20260925_booking_paid_authoritative.sql` in the
Supabase SQL editor. Nothing else is needed — the app and the webhook ship with
the next deploy, and the new event starts appearing on the dashboard as soon as
somebody pays.

Until it is applied the webhook will log an error for each payment and carry on;
the booking, the emails and the money are all unaffected.
