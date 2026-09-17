# What drivers tell us, and what we tell them back

Three signals come from drivers standing at a spot: **Still here**, **Changed**,
and **Report**. This is how each one travels, and what the app is allowed to
claim on the strength of it.

## The state it was in before 17 Sep 2026

Worth writing down, because it explains most of the decisions below.

Every spot detail sheet carried a green tick and the line **"Confirmed by 0
drivers"**. `votes` is a field in the seed data; 240 spots had it at 0 and 297
carried an editorial ranking weight — a couple of thousand "confirmations" in
total, none of which any driver had given. Under the line were two buttons:

- **Still here** wrote `pe_votes` in localStorage, and the count then read
  "Confirmed by 1 driver" — on that phone, for ever, for nobody else. The next
  driver still saw 0. The button then disabled itself, so a mis-tap counted for
  good.
- **Changed** wrote `pe_ratings` in localStorage, which nothing ever read. A
  driver tapped the thumbs-down to warn people and *nothing whatsoever
  happened* — worse than the Report button beside it, which worked.

And the report flag said "N drivers reported a problem here recently" where N
was a count of **rows**, so one person tapping Report five times was five
drivers. Reports also had no way to be resolved: a spot checked and found fine
stayed flagged for good.

## Where the answers go now

| Signal | Written by | Stored in | Read back through |
| --- | --- | --- | --- |
| Still here / Changed | `set_spot_signal()` | `spot_signals` | `spot_signal_counts` |
| Report | `report_spot()` | `spot_reports` | `spot_report_counts` |
| Resolution | `resolve_spot_reports()` (service role) | `spot_reports.resolved_at` | — |

`src/data/spotSignals.js` and `src/data/spotReports.js` are the clients;
`src/data/spotSignalsCore.js` holds the pure part so a Node test can drive it.

## One row per source per spot

The signals table keys on `(spot_key, source_id)`. `source_id` is the analytics
session id — the same anonymous id `push_subscriptions` is keyed on, not the
account, because the driver standing at the spot usually has no account and
demanding one to answer "is this still there?" is how you get no answers.

That key is the whole design:

- Tapping fifty times is **one** confirmation.
- Changing your mind **moves** the vote rather than counting on both sides.
- Tapping the answer you already gave **takes it back**.

Reports have the same shape through a partial unique index on
`(spot_key, source_id) where resolved_at is null`: a second tap corrects the
first. A spot that was resolved and has gone wrong *again* is a new row, because
that history is what makes a spot worth pulling.

## The count comes from the server

`set_spot_signal()` returns the fresh counts as JSON and the UI renders those.
It does **not** increment a local number — guessing is exactly what made
"Confirmed by 1 driver" true on one phone and false everywhere else. If the
call fails, the app re-reads rather than guessing, because a stale count is a
wrong count and this one is shown to everybody.

The device still keeps its own record (`pe_signals`) of what it said, so the
button is right offline and right immediately. The old `pe_votes` and
`pe_ratings` keys are merged in on first load so months of taps still show —
but they are **not** replayed to the server. The sheet leads with "confirmed in
the last month", so replaying would stamp a year of stale taps with today's
date and present them as fresh evidence.

## What the app is allowed to say

**Nothing said is said as nothing.** With no answers there is no tick and no
number, and the line asks instead of reporting: *"Nobody has confirmed this one
recently. Been here?"*. "Confirmed by 0 drivers" beside a tick reads as a
verdict, and it was the verdict on all 744 spots.

**Both sides are always shown, and neither becomes a ruling.** Two drivers
saying a car park is gone and nine saying it is fine is a spot worth a second
look — the two may have arrived during resurfacing, and a spot deletable on two
taps is a spot anybody can vandalise off the map. The tone flips to disputed at
a tie, and the sentence still reports both numbers.

**The sort is ours and is labelled as ours.** The list's default order still
uses the `votes` weight, and the option is now called **Recommended** rather
than "Most Popular": ordering by our own ranking is fine, attributing it to
drivers is not. Real confirmations are shown on the spot's own sheet, where they
can be read as the small number they honestly are; sorting 744 spots by them on
the day this shipped would have put every one of them in id order.

## Nothing is a write primitive

Both tables have RLS on with **no policies** and `revoke all` from `anon` and
`authenticated`. The functions are the entire write surface; the two count views
are the entire read surface. The raw signal rows say which anonymous source said
what about which spot, which assembled across spots is a movement history and
nobody's business — the counts are public, the rows are not.

The count views `revoke all` before they `grant select`, and that is not
tidiness: Supabase's default privileges grant ALL on every new relation in
`public` — views included — to `anon` and `authenticated`, so a bare
`grant select` is a no-op there and the view would also carry anon
INSERT/UPDATE/DELETE. Harmless today, because an aggregating view is not
auto-updatable, and exactly the sort of thing that stops being harmless when
somebody simplifies a view.

Both functions cap what one source can do (200 spots for signals, 100 open
reports) and exclude the row being corrected from that count — a driver at the
cap who finds a spot has changed must not be silently refused, or a wrong answer
freezes in place.

`resolve_spot_reports()` is granted to `service_role` only and reached through
`/api/admin` (`action: 'spot-reports'` to list, `'resolve-spot-reports'` to
close). A driver who could resolve reports could silence every warning on the
map.

## Tests

```
node tests/unit/spotSignals.test.mjs           # 13 checks, 41 mutations
tests/db/run.sh tests/db/spot_signals_seed.sql \
  supabase/migrations/20260720_spot_submissions.sql \
  supabase/migrations/20260728_public_approved_spots.sql \
  supabase/migrations/20260820_hotspot_moderation.sql \
  supabase/migrations/20260917_spot_signals.sql \
  tests/db/spot_signals.test.sql               # 74 checks, 33 mutations
```

The seed reproduces Supabase's default privileges, or the revokes have nothing
to do and the checks that assert them pass on nothing.

One finding worth keeping: the first version of `spot_report_counts` used
`count(distinct source_id)`, which reads as careful and is in fact
**unobservable** — with the partial unique index in place it can never differ
from `count(*)`, so it was a guarantee no test could hold. It was replaced with
`count(*)` and the index is what is tested.

## Deploying it

Apply `supabase/migrations/20260917_spot_signals.sql`. Nothing else is needed;
the client degrades to device-only answers with no database behind it, and says
so.
