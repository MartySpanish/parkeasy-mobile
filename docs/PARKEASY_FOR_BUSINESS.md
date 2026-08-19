# ParkEasy for Business — corporate pooled permits

## The one rule

A permit is a **right of entry against a quota**. It is not a numbered bay.

Commercial operators oversell deliberately and their own season-ticket terms say
a ticket "does not guarantee you a space". What ParkEasy sells an employer is
the right for up to N of their staff to enter on a given day, and what ParkEasy
guarantees is the part it controls: **it will never issue more permits for a date
than the block holds.**

Nothing in this feature — copy, error message, column name or email — says
"bay", "reserved bay" or "your bay". `src/components/corporate/copy.js` holds the
approved vocabulary and `assertNoBayLanguage()` throws in development if it
drifts back.

## Before this can be deployed

Two migrations, in this order, against the production project:

1. `supabase/migrations/20260820_corporate_permits.sql`
2. `supabase/migrations/20260820_operator_site_terminology.sql`

The `/api/corporate/*` endpoints 500 until the first one has run.

## How the quota is actually enforced

Not in application code. `claim_permit()` takes `SELECT ... FOR UPDATE` on the
block row before it counts, so every claim against one block is serialised. Two
Node processes counting independently both see N−1 and both insert; a row lock
cannot.

Proven, not asserted:

```
tests/db/run.sh supabase/migrations/20260820_corporate_permits.sql \
                tests/db/corporate_permits.test.sql
tests/db/concurrency.sh
```

`concurrency.sh` opens 20 real connections, holds them all on an advisory lock,
releases the lock and lets them charge at the same block at once:

```
   1 permits, 20 simultaneous claims -> 1 claimed, 19 refused as full ... PASS
   3 permits, 20 simultaneous claims -> 3 claimed, 17 refused as full ... PASS
  25 permits, 20 simultaneous claims -> 20 claimed, 0 refused as full ... PASS
```

The barrier matters. Without it the workers start milliseconds apart, the first
finishes before the second connects, and the test passes whether or not the lock
works.

## Endpoints

| | |
|---|---|
| `POST /api/corporate/:blockId/claims` | `{date, vrn?}`. Falls back to the member's primary vehicle. A refusal for a full date carries `next_available`. |
| `DELETE /api/corporate/claims/:id` | Frees the slot immediately — no cutoff, no charge. The block is paid monthly either way, so there is nothing to recover and every reason to want the day handed back. |
| `GET /api/corporate/:blockId/availability?from=&to=` | Per-date counts for the calendar. Counts only, no names. |
| `GET /api/corporate/:blockId/plate-list?date=[&format=csv]` | The operator handover. Admin or founder only. |
| `POST /api/corporate/subscription` | Founder only. Creates or re-syncs the Stripe Billing subscription for a block. |

**No endpoint ever takes a member id from the request.** Every claim is made for
whoever holds the session. `claim_permit()` is `SECURITY DEFINER`, so accepting
one would let any signed-in user burn a colleague's permit — execute on both
functions is revoked from `anon` and `authenticated` for the same reason.

## Billing

Stripe **Billing**, not Connect. The driver marketplace uses destination charges
and Stripe splits the money automatically; none of that applies here.

- One subscription per block, `quantity = permit_count`, `collection_method:
  'send_invoice'`, 14-day terms, invoiced to the company.
- **Stripe does not pay the operator.** The whole invoice lands in ParkEasy's
  balance and the operator's share leaves by an explicit Transfer or a bank
  payment against their invoice. `public.operator_settlements` is the list of
  what is owed to whom, per block per month. Marty reconciles it by hand for the
  first three months.
- Test mode until reconciled: a live key is refused unless `STRIPE_LIVE_ENABLED`
  is set, same guard as every other money path in the repo.

### The webhook trap

`invoice.paid` was already used to grant consumer Premium by email. Left alone,
invoicing a company £300 for parking permits would have handed their finance
department a Premium subscription, and cancelling it would have revoked one.
Every corporate case now checks `corporateBlockFor()` **first** and breaks.

A failed payment **pauses** a block rather than cancelling it: no new permits are
issued, but claims already made stand. Staff who planned their week are not
turned away at a barrier because an invoice is four days late.

## Guardrails, all enforced in the database

- `permit_count` can be reduced, but never below the claims already made on **any
  future date** — checked across the whole forward window, not just today.
- Removing a member cancels their future claims and frees those days at once.
- Members and claims cannot be hard-deleted. This is billing data; the triggers
  refuse a `DELETE` outright rather than trusting a code review.
- VRNs normalise on write (upper, no spaces or hyphens) and are **never logged in
  full** — `maskVrn()` in `api/corporate/_lib.js`.

## Row Level Security

Company A cannot see company B's blocks, staff, plates or invoices. Ordinary
members see their own membership row, their own plates and their own claims —
not the colleague list, and not the block's full claim list (which is why
availability is served as an aggregate). `anon` has no grant on these tables at
all, so a signed-out request dies at the permission layer before RLS is
consulted. Section 9 of the test suite proves each of those with a second and
third account.

## Still to do

- Invite/remove staff from the admin screen (rows are created server-side today).
- Emailing the plate list to the operator on a schedule, rather than Marty
  downloading the CSV.
- The `operator_settlements` numbers have not been reconciled against a real
  Stripe invoice yet — there has not been one.
