# Referrals

## Why they pay late

Pay on signup and you are buying signups, which cost nothing to manufacture: an
address, a code, a tap. The accounts arrive, the points go out, and the map
gains nothing. Every referral scheme that has ever been gamed was gamed at
exactly this point.

So a referral here is **recorded** on signup and **paid** when the invited
driver does something the map keeps — an approved spot, an approved photo, a
report that turned out right. The same rule as `docs/points.md`: paid on
approval, never on submission. The referrer is paid for bringing somebody who
turned out to be useful, which is the only thing worth paying for.

| | Points |
| --- | --- |
| Referrer, when their invited driver's contribution is accepted | 50 |
| The invited driver, as a welcome | 25 |

75 points against a 100-point reward, at a £29/year list price, is about **£1.79
of list price for one activated contributor**. It is cheap because the currency
is something we already own.

## The ordering problem

An invited driver lands on `parkeasy.uk/?ref=PQ4R7T` with **no account**. The
referral cannot be recorded until there is one, and they may not sign in for a
week. So:

1. The code is normalised and held on the device (`pe_ref_code`).
2. The URL is rewritten immediately — a referral code left in the address bar
   gets pasted into a tweet, and then it is everybody's.
3. `claimPendingCode()` runs when `user?.id` appears, which is sign-in, not page
   load. That is the case that matters: followed the link, browsed, signed up
   twenty minutes later.

The stored code is **never overwritten**. The first friend whose link they
followed is the one who gets the credit, and a later link cannot take it off
them.

The code is forgotten on every outcome **except** an unreachable server.
`unknown_code` and `own_code` will never succeed however many times they are
retried, and retrying them on every page load is a request per load for the life
of the install.

## The code

Six characters from **29**: `ABCDEFGHJKMNPQRTUVWXYZ2346789`. I, L, O, S, 0, 1
and 5 are all left out — one of each pair people read as the other. This code
gets read out in a car park and typed on a phone keyboard, and a mistyped code
is a referral that silently goes to nobody, with no way for the driver who
mistyped it to find out.

The alphabet is **spelled out rather than written as a range**. The first version
of this file used a range that quietly included L and S while looking careful;
the database test caught it. There is a check on both sides — the migration's
`referral_codes_shape` constraint and `CODE_RE` in `referralsCore.js` — and a
unit check that they are the same string, because a mismatch means the app
refuses a code the database would accept, or accepts one it will reject.

`normaliseCode()` maps the confusions a person actually makes (`l` → `1`, `O` →
`0`) and then, because those digits are not in the alphabet either, turns them
into an invalid code. That is deliberate: a genuinely wrong character becomes a
dead end that is **reported as invalid**, never a silently different code that
credits a stranger.

29⁶ is about 594 million codes. Collisions are retried rather than ignored,
because silently handing two drivers the same code would send one of their
referrals to the other.

## The rules, and where they live

- **One referral per invited driver, ever.** `unique (invitee_id)` — not per
  (referrer, invitee), or one account gets walked round a circle of friends
  collecting a bounty each time.
- **Never yourself.** `check (referrer_id <> invitee_id)` on the **table**, not
  only inside `claim_referral()`: a rule that exists only in a function is a
  rule the next function forgets.
- **Not an existing contributor.** An account that has already earned points is
  not somebody's referral; it is an existing driver typing a friend's code.
  Refused, and said plainly.
- **Paid once.** `qualify_referral()` only matches rows with
  `qualified_at is null`, and pays through `award_points()`, whose
  `unique (user_id, kind, ref)` is the real guarantee.

`qualify_referral()` is **service_role only**. A driver who could call it could
qualify their own referrals, which is the whole thing the file is built to
prevent. It is fired from `thankYou()` in `/api/admin` — the one place in the
codebase that knows "somebody's work was accepted". A second place is a place
that forgets.

## What the card says

Both numbers, always: **"4 joined, 2 counted"**. Showing only the first implies
points that are not coming, and the gap is exactly what the referrer needs to
understand.

Unearned points are **never** called pending. They are not pending — they arrive
if and when that person contributes something we keep, and they may never
arrive. A referrer with nobody yet is told the price rather than shown a score
of zero.

The shared message carries the **code as well as the link**, because some
messaging apps strip query strings and people paste URLs without them. The code
read out loud is the fallback, so it has to be in the words.

Whose code somebody used is not shown to them: the read policy is
`referrer_id = auth.uid()`, so a driver sees the referrals they made and not the
one pointing at them. `referral_codes` is not readable at all — the full list of
codes is the one thing that would let somebody attribute their own signups to a
stranger at random.

## Tests

```
node tests/unit/referrals.test.mjs               # 15 checks, 41 mutations
tests/db/run.sh tests/db/referrals_seed.sql \
  supabase/migrations/20260707_promo_codes.sql \
  supabase/migrations/20260720_spot_submissions.sql \
  supabase/migrations/20260820_hidden_gems.sql \
  supabase/migrations/20260918_contribution_points.sql \
  supabase/migrations/20260918_referrals.sql \
  tests/db/referrals.test.sql                    # 68 checks, 39 mutations
```

Four mutations initially passed on nothing, and three were real:

- **The read policy was never exercised as a driver.** Every check above it runs
  as the table owner, which bypasses RLS completely — so the policy could have
  been `using (true)`. It now `set role authenticated` and reads.
- **`select assert(...) from t where ...` over an empty result runs the assert
  zero times** and reports nothing, so deleting an award entirely passed. Those
  are now scalar subqueries, which yield NULL and raise.
- **"Two drivers get different codes" was true by a 594-million-to-one
  coincidence.** The unique constraint is what guarantees it, so that is what is
  asserted.

The fourth was an equivalent mutant: removing the early return in
`my_referral_code()` changes nothing, because the primary key raises and the
handler returns the existing row.

## Deploying it

Apply `supabase/migrations/20260918_referrals.sql` **after**
`20260918_contribution_points.sql` — it extends `point_value()` with the two
referral kinds and calls `award_points()`.
