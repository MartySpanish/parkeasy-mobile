# Push notifications

The channel every "come back" feature needs. Email is read tomorrow; a
notification about a car park two streets away is read now.

## What Marty has to do once

Three environment variables in Vercel, from one command:

```bash
npx web-push generate-vapid-keys
```

It prints a public and a private key. Set, in **Vercel → parkeasy → Settings →
Environment Variables**:

| Variable | Value | Why |
|---|---|---|
| `VAPID_PUBLIC_KEY` | the public key | signs the send, server side |
| `VAPID_PRIVATE_KEY` | the private key | **secret** — never in the repo, never in the bundle |
| `VITE_VAPID_PUBLIC_KEY` | the **same** public key | the browser subscribes with it |
| `VAPID_SUBJECT` | optional, e.g. `mailto:hello@parkeasy.uk` | how a push service contacts us about a misbehaving sender |

Then **redeploy**. `VITE_` variables are baked into the build, so setting one
without a redeploy changes nothing.

The admin dashboard's "Notifications & config" panel shows all three as
separate rows, including **Push keys match** — see the failure mode below.

### The failure mode that says nothing

If `VAPID_PUBLIC_KEY` and `VITE_VAPID_PUBLIC_KEY` are not the same key,
browsers subscribe with one and we sign with the other. Every push comes back
`403`, nothing is ever delivered, and the app still says alerts are on. Nothing
in a log makes this obvious, which is why the admin panel checks the two
against each other rather than just checking both are set.

### Rotating the keys

Changing the pair invalidates every existing subscription — each browser has to
subscribe again, and until it does it hears nothing. So rotate only if the
private key has leaked. After a rotation the old rows go stale and the send path
expires them on their first `410`.

## How it fits together

```
browser  ──tap "Turn on alerts"──▶  enablePush()              src/push.js
                                      │ Notification.requestPermission()
                                      │ pushManager.subscribe(VITE_VAPID_PUBLIC_KEY)
                                      ▼
                                    save_push_subscription()  20260915_push_subscriptions.sql
                                      │ validates shape, caps at 5/session,
                                      │ user_id from auth.uid()
                                      ▼
                                    push_subscriptions        RLS on, no policies

sender   ──▶ pushToUsers([id], {title, body, url})            api/_push.js
                │ reads the live list with the service key
                │ web-push, serial, TTL 1h
                │ 404/410 → expire the row; anything else → leave it alone
                ▼
             push service  ──▶  'push' event                  public/sw.js
                                  │ always showNotification (see below)
                                  ▼
                                'notificationclick' → focus the open tab
```

### Sending one

```js
import { pushToUsers, pushToSessions } from '../_push.js';

await pushToUsers([booking.driver_id], {
  title: 'Your parking starts in 20 minutes',
  body: 'Manor Close, BT9 — tap for directions',
  url: '/bookings/' + booking.id,   // a path, never an absolute url
  tag: 'booking-' + booking.id,     // replaces an earlier one instead of stacking
});
```

Both return `{ sent, failed, expired }` and never throw. A notification is not
worth failing a booking over.

## The rules this code keeps, and why

**The permission prompt is asked once, ever.** A browser gives a site one
chance; "Block" is permanent and cannot be undone from inside the page. So
`enablePush()` refuses to prompt without `userGesture: true`, and nothing calls
it on load. The only thing that runs at start-up is
`refreshPushSubscription()`, which re-saves a subscription the browser already
has and can never prompt.

**Every push shows a notification.** Chrome subscribes us with
`userVisibleOnly`, and a push handled silently is counted against the site —
enough of them and the permission is revoked. The service worker's `push`
handler therefore contains no early return at all, including when the payload
is not JSON.

**Only our own paths are opened.** A `url` in a payload is restricted to one
starting with `/`, on both the send and the receive side. An absolute one would
let a notification open any site at all.

**404 and 410 expire the row; nothing else does.** Those two mean the
subscription is gone for good. A 429 or a 500 is the push service having a bad
day, and expiring on one throws away a live subscriber.

**The table is not readable.** `push_subscriptions` has RLS on with no policies
and no grants: the two SECURITY DEFINER functions are the whole write surface
and the service key is the only reader. It is a send list, and a driver has no
reason to see anybody's — including their own.

## What uses it

Parking timers do, as of `api/cron/parking-timers.js` — see `docs/parking.md`.
That sweep is the worked example of a scheduled sender: it claims its rows
before it sends, so a retry cannot double-notify.

Still to come: "a space opened near where you looked" (the waitlist sweep in
`api/cron/notify-waitlist.js`, which still only emails) and matchday alerts
(F14). `pushToUsers` and `pushToSessions` are the only things they need.

## Tests

- `tests/unit/push.test.mjs` — 19 checks. The client's RPC arguments are
  compared against the migration's parameter names character by character (a
  renamed argument means PostgREST cannot find the function, and the
  subscription is silently never stored), and the send path is driven through
  every status code a push service returns.
- `tests/db/push_subscriptions.test.sql` — 49 checks, over
  `tests/db/push_subscriptions_seed.sql`, which reproduces Supabase's default
  privileges so that the migration's `revoke all` is actually load-bearing.
