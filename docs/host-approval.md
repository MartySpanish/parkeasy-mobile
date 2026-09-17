# Host approval — booking somebody's driveway

A club car park with forty spaces is instant. Somebody's driveway is a
**request**: the host may have a car in it, be away, or simply not want that
person that day. A host who cannot say no has not agreed to anything.

## The states

```
pending ──(card authorised)──> awaiting_host
                                 ├─ host accepts  ──> paid      money captured
                                 ├─ host declines ──> declined  hold released
                                 └─ deadline passes ─> expired  hold released
```

## The money

The card is **authorised** at checkout (`capture_method: 'manual'`) and captured
only when the host accepts. Nothing is taken for a request that is refused — no
charge, no refund, no five-day wait for it to come back. On a destination
charge, the application fee and the transfer to the host both happen at capture,
so a declined request moves no money at all.

**Why authorisation expiry is not a problem.** Card authorisations lapse after
about a week, which sounds like it rules this out for a booking three weeks
ahead. It doesn't: the hold only has to survive until the *host answers*, which
is capped at 24 hours. Capture happens on acceptance, and the booking then
behaves like any other regardless of how far off the parking date is.

## Which listings

`rental_listings.requires_host_approval`, defaulting to **false**. The migration
turned it on for `space_type = 'driveway'` — the ones that are someone's home.
The default matters: a new car park must never become request-only by accident,
because that turns a working instant booking into one nobody answers.

The flag is **snapshotted onto the booking** at checkout, like `payout_mode`. A
host turning approval off next month must not retroactively change the rules of
a booking already taken.

## The guard that isn't code

```sql
check (not (requires_host_approval and status = 'paid' and host_responded_at is null))
```

Every other guard — the endpoint, the webhook, the UI — is code the next person
can edit around. This one is enforced by Postgres on every write, including a
hand-run `UPDATE` in the dashboard at midnight. It is the feature expressed as a
constraint.

## How a host answers

Two buttons in the email, authenticated by the booking's own `access_token` —
the same mechanism the cancellation page already uses. That is deliberate: a
host who has to find the app, log in and hunt for a queue is a host who answers
tomorrow, by which time the hold has lapsed and the driver has parked elsewhere.

The token is a per-booking uuid, never shown to the driver, and grants exactly
one power: answering that one request. `POST`/`GET /api/bookings/respond`.

Tapping twice is safe — only a booking still in `awaiting_host` is actionable,
and the answer is recorded in the same write that moves it out of that state.

## When nobody answers

`/api/cron/expire-approvals`, **hourly**. `approval_deadline` is the sooner of
24 hours and the start time, so a request for a slot in three hours can lapse
three hours from now; a daily sweep would leave that driver waiting most of a
day for an answer that was never coming.

It cancels the authorisation **first** and marks the row `expired` second. The
other order leaves a driver who was never given a space holding a pending charge
— which is the version of this feature that produces a chargeback.
