# Parking timers, find my car, and share

Three things a driver needs *after* they have walked away from the car. None of
them worked before this, and all three failed for the same underlying reason:
the parked session lived only in a React state and one `localStorage` key, so
it was accurate exactly while the tab was alive — and a phone discards that tab
within minutes of the driver leaving.

## What a driver sees

1. **A countdown** on the park bar, and a reminder that arrives even with the
   app closed.
2. **Find my car** — distance, walking time and a maps route back.
3. **Share** — a link plus a plain sentence, for the person meeting them there.

The record is still kept in `localStorage`, on purpose: parking is not an
account feature. A guest parks, gets reminded, and finds the car again without
ever signing in. The tie between "this browser" and "this reminder" is the
analytics session id — the same id `push_subscriptions` is keyed on.

## The pieces

| File | Does |
| --- | --- |
| `supabase/migrations/20260917_parking_timers.sql` | `parking_timers` table, `set_parking_timer()`, `cancel_parking_timer()` |
| `src/parkedCore.js` | pure arithmetic: distance, labels, the route url, the countdown, the bounds |
| `src/parked.js` | the `localStorage` record and the two RPC calls |
| `api/cron/parking-timers.js` | the sweep that sends the reminder, every 5 minutes |
| `src/App.jsx` | `ParkedTimer`, `FindMyCar`, the park bar countdown |

`parkedCore.js` is split out for one reason: `parked.js` imports `./supabase`,
which only Vite can resolve, so nothing in it can be imported by a plain Node
test. Same split as `src/pushCore.js`.

## The bounds, and why they are what they are

`set_parking_timer()` refuses anything due in **under 10 minutes** or **over 24
hours**, and `timerBoundReason()` in `parkedCore.js` refuses the same two so the
UI can say which it was without a round trip. The client check is not instead of
the database one — a client-side bound is a suggestion.

Ten minutes is not arbitrary: the sweep runs every five, so a reminder due in
less than two sweep intervals cannot be promised. If the cron schedule in
`vercel.json` ever slows down, `tests/unit/parkingTimer.test.mjs` fails rather
than the app quietly offering a timer it cannot keep.

The warning lead time is **clamped, not rejected**. Asking to be warned 30
minutes before a 15-minute session is a reasonable thing for a person to want
and an impossible thing to deliver, so the database reduces it to fit
(`remind_at` never lands in the past) instead of refusing the whole timer.

## Sent once, or not at all

The sweep **stamps `sent_at` before it pushes**, and the stamp is conditional on
`sent_at is null` with `return=representation`. If nothing comes back, another
overlapping sweep claimed the row and this one skips it.

The other order is worse. Push-then-stamp means a crash between the two sends
the same reminder again five minutes later, and "your parking runs out in 15
minutes" arriving twice is how a person turns notifications off for good.
Stamp-then-push loses a reminder instead of duplicating one — and a lost
reminder is recoverable, because the app still shows the countdown.

## What the notification does not say

It never mentions a fine, a ticket, a penalty, towing or clamping. We do not
know the enforcement regime on that street, and claiming one would be the same
class of error as telling a driver a space is full when all we can see is
ParkEasy bookings. The test asserts this on every branch of the sentence, not
just the one with a label.

The deep link is a **path** (`/?parked=1`), never an absolute url, so a
notification opened from a preview deployment does not throw the driver at
production.

## Coordinates come from the spot, not the phone

`startParked()` records the *spot's* latitude and longitude, not the device's.
By the time the button is tapped the phone may be a hundred metres away, and the
spot's position is the only one here that is surveyed rather than sensed.

Sessions recorded before this shipped have a name and no position.
`directionsToCar()` returns `null` for those and `FindMyCar` renders nothing — a
"find my car" button that cannot find the car is worse than no button.

Distance is rounded to the nearest 10 m under a kilometre, with a 10 m floor. A
phone knows its own position to maybe 10 m on a street with buildings either
side, so "137 m" claims a precision the number does not have, and "0 m" reads as
"you are standing on it" when the driver plainly is not.

## Tests

```
node tests/unit/parkingTimer.test.mjs            # 11 checks, 47 mutations
tests/db/run.sh tests/db/parking_timers_seed.sql \
  supabase/migrations/20260917_parking_timers.sql \
  tests/db/parking_timers.test.sql               # 41 checks
```

Both are in `tests/run-all.sh`.

## Deploying it

The migration has to be applied, and `CRON_SECRET` has to be set (the sweep
401s without it — an open endpoint that sends notifications is an open endpoint
that sends spam). Reminders also need the VAPID keys from `docs/push.md`; with
no keys the sweep returns `{ ok: true, skipped: 'push not configured' }` rather
than erroring every five minutes, and the UI says "on this device only".
