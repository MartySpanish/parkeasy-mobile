# Thanks points

744 spots, 89 gems, the photos and the restriction notes all came from drivers.
Nothing in the app had ever thanked them for it — the one existing gesture was a
promo code called `SPOT-THANKS` that the founder typed in by hand.

## Why the reward is Premium days and nothing else

A balance that buys nothing is a number, and a number a company invents to thank
you with is worth what it costs to print. Premium already exists, already has a
price in pounds, and is already granted by writing a `promo_redemptions` row —
which is exactly what `has_premium()` reads. So a point is a claim on something
real, and **the tariff cannot be inflated without giving away something that
would otherwise have been sold**. That property is what keeps the numbers below
honest; it is the whole reason for this design.

Cash is deliberately not on the table. Paying per contribution turns 744 curated
spots into a piecework queue, and the accuracy of those spots *is* the product.

## The one rule that matters: paid on approval, never on submission

Points for submitting a spot pay for junk, and a queue of junk is how the
moderation that keeps the map accurate stops being possible.

| Kind | Points | Paid when |
| --- | --- | --- |
| `spot_approved` | 25 | a human approves the submission |
| `report_accurate` | 15 | a report is resolved **as accurate** |
| `photo_approved` | 10 | a human approves the photo |
| `signal` | 1 | Still here / Changed — **max 5 a day** |

**100 points = 30 days of Premium.**

Every kind is either decided by a person looking at the thing, or capped low
enough that farming it is not worth the thumb movement. An accepted spot is
worth twenty-five taps, because writing a restriction down correctly is
twenty-five times the work and rather more than twenty-five times the value — a
wrong restriction is a £90 ticket.

Without the cap, confirming all 744 spots would be 744 points: seven months of
Premium for seven minutes of tapping.

## Nobody can award themselves

`award_points()` is granted to `service_role` **only**. There is no path from the
app to it — the client does not even reference the name — and `/api/admin` calls
it at the three places a human decides something was good. A self-award function
is a mint.

The ledger itself has RLS on with one policy: a driver reading their own rows.
No inserts, no updates, no leaderboard. A thank-you turned into a competition is
how a map about accuracy fills up with volume.

## The ledger is append-only

A balance column is one number that can disagree with its own history, and the
first time it does there is no way to tell which is right. Here the balance is a
sum, a spend is a negative row, and the history is the audit.

`unique (user_id, kind, ref)` means the same act is paid once, however many
times an admin taps approve or a webhook retries. `ref` is the submission id,
the photo id, the spot key, or — for a spend — the moment it happened, so
redeeming again next month is a second row rather than a constraint violation.

## Two traps in redeeming

**The race.** `redeem_points()` reads a balance, then writes a spend. Between
those two statements a second transaction reads the same balance and both grant
thirty days. A hundred points becomes sixty days, and a driver who works out
that it repeats never pays for Premium again. `pg_advisory_xact_lock` on the
driver serialises it. This is tested for real, not asserted:
`tests/db/points_concurrency.sh` fires eight simultaneous redeems at one
reward's worth of points, and with the lock removed that run grants **three**
rewards, ninety days, and a balance of minus two hundred.

**The unique constraint.** `promo_redemptions` is `unique (user_id, code)`, so a
second redemption under the same code is a constraint violation unless it
extends. Extending is the right behaviour anyway: redeeming twice should be sixty
days, not thirty overwritten with thirty. The extension is from the **later** of
`now()` and the current expiry, so a driver who redeems mid-subscription has
their days added on the end rather than swallowed.

## What the screen is allowed to say

A rewards screen is the easiest place in an app to make a promise. So every
sentence is derived from two real numbers, the balance and the price:

- **Never "almost there".** How far off somebody is, is a fact; whether that is
  close is an opinion, and dressing 80 of 100 as almost-there is how a rewards
  screen starts lying in small ways.
- **The bar is capped at full.** 300 points is not 300% of the way to a 30-day
  reward; it is three of them waiting.
- **The card renders nothing until it has a real balance.** A card that flashes
  "0 points" while it loads has told the driver they have nothing, and for most
  of them that is the only thing they will read.
- **"Not enough yet" is not "something went wrong".** The two are not the same
  and only one of them is the driver's business, so the shortfall is reported as
  the number it is.
- **The offer only appears when the server says it can be honoured**
  (`can_redeem` from `my_points()`), not greyed out. An offer you cannot take is
  worse than no offer.

The card sits **above** the upgrade button in the account menu: somebody who has
given this map four spots should be offered their thanks before they are offered
a price.

## Tests

```
node tests/unit/points.test.mjs                  # 13 checks, 39 mutations
tests/db/run.sh tests/db/contribution_points_seed.sql \
  supabase/migrations/20260707_promo_codes.sql \
  supabase/migrations/20260720_spot_submissions.sql \
  supabase/migrations/20260820_hidden_gems.sql \
  supabase/migrations/20260918_contribution_points.sql \
  tests/db/contribution_points.test.sql          # 69 checks, 38 mutations
tests/db/points_concurrency.sh                   # the race, for real
```

Three mutations initially passed on nothing, and all three were real gaps: the
per-driver cap check was satisfied because an earlier check had backdated the
other driver's taps, and the quoted cost and reward days were only ever read
from the signed-out branch of `my_points()` — so a signed-in driver could have
been quoted any number at all. The fix reads them from the branch a real driver
gets, and checks the days granted against the days quoted rather than against a
literal.

## Deploying it

Apply `supabase/migrations/20260918_contribution_points.sql`. Nothing else is
needed: the card renders nothing without a database behind it, and awards are
fired from the admin API, which already holds the service key.
