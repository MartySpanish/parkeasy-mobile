# Matchday alerts

## Why a banner is not enough

The home screen already carries *"Tonight: Anastacia · Waterfront Hall · 19:00 —
park before you set off"*, and the events screen is a full calendar with the
closest bookable spaces and the gems within walking distance. Both reach exactly
one person: somebody who opens the app.

Forty thousand people went to Boucher Road on 20 August and ParkEasy said
nothing to a single one of them. Push exists now (`docs/push.md`); this is the
half that decides who gets told, and when.

## Followed venues, not location

The obvious design pushes to everybody near the ground, and it means storing
where drivers are. This stores **what they asked to hear about**: a venue key,
chosen by tapping Follow on that venue's page. It is explicit, exactly
targetable, and holds nothing about anybody's movements. Somebody who follows
Solitude gets Cliftonville home games and nothing else.

Keyed on the analytics session — the same anonymous id `push_subscriptions` is
keyed on — because a driver who wants to know about Windsor Park does not need
an account to want it.

**Permission is asked on the way in, before the follow is recorded.** Recording
it and then being refused the notification permission leaves somebody certain
they will be told about a fixture they will hear nothing about. A denied
permission says where to undo it; a dismissed prompt gets "No bother — tap again
any time".

## The time zone is the whole problem

`src/data/events.js` stores **civil** times: `"19:45"` means a quarter to eight
in Belfast. The 2026 events in that file span BST and GMT, so
`new Date('2026-08-07T19:45:00Z')` is an hour out for most of them and correct
for the rest — the worst kind of bug, because it looks right in November and
tells forty thousand people the wrong hour in August.

`londonOffsetMinutes()` reads the offset from the platform's own tz database, at
the actual instant, rather than implementing the last-Sunday-in-March rule. That
rule is right today and is not ours to maintain; the EU has voted to abolish the
clock change twice.

| Input | Instant |
| --- | --- |
| 7 Aug 2026, 19:45 | `2026-08-07T18:45:00Z` (BST) |
| 20 Nov 2026, 19:45 | `2026-11-20T19:45:00Z` (GMT) |

**`"24:00"` is rejected**, and it is the only malformed time that needs a check.
It is valid ISO 8601 meaning midnight at the *start of the next day*, so
`Date.parse` accepts it happily and the alert would land on the wrong date.
Everything else malformed — `'7pm'`, `'19:75'`, `'2026-8-7'` — fails
`Date.parse` on its own.

**An event with no published time gets no invented one.** `events.js` leaves
`time` null wherever sources disagreed, on the stated grounds that a wrong time
is worse than none. Those get a 09:00 civil-morning alert that says "today"
rather than a fabricated hour — which is the useful version for a festival
closing roads all day.

## The window

Two to four hours before the start. Three hours is the decision point: long
enough to choose a park-and-ride instead of circling Donegall Avenue, close
enough that the message is about tonight rather than the weekend.

The sweep runs **hourly**, and the window is deliberately **wider than the sweep
interval** — otherwise an event whose lead time falls between two runs is never
alerted on at all. A unit check reads the cron expression out of `vercel.json`
and fails if the schedule ever slows past the window.

Nothing is sent at or after the start. An alert that lands as the whistle goes
reaches somebody already parked or already circling, and costs the channel for
the one that would have mattered.

A multi-day festival alerts **once**, on its first day. Road closures for a
week-long Fleadh are one piece of news, and seven pushes about it is how somebody
turns notifications off.

## Told once

`claim_event_alerts()` inserts the send rows **before** anything is pushed and
returns only the sessions it actually claimed, so two overlapping runs cannot
both send. The sweep runs hourly against a two-hour window, so without this
every follower is told twice about every fixture.

A crash between claim and push loses an alert rather than duplicating one, which
is recoverable — the banner in the app still says what is on. Same discipline as
`api/cron/parking-timers.js`.

**Already-told followers are excluded before the limit, not after.** This was a
real bug the database test caught: with the filter after the limit, each run
picked the same first N rows, the insert conflicted on all of them, and a venue
with more followers than the limit never got past the first N — the backlog the
limit exists to spread out was the one thing it prevented.

Somebody who follows part-way through the window **still gets told**, and that is
the point rather than an oversight: a driver who follows Windsor Park at 17:30
for a 19:45 kick-off wants to hear about it, and the three told at 16:45 must not
hear it again.

## What the notification says

> **Cliftonville v Crusaders at 19:45**
> Solitude, Cliftonville. Where to park →

Never "spaces are filling up" or "arrive early to get a space". We do not know
the occupancy of a single street near any of these grounds, and claiming we do
is the same error as the booking copy that told a driver to try a different card
when the host had no payout account.

The area is named because "Affidea Stadium" means nothing to somebody who knows
it as Ravenhill. A road closure is mentioned because it changes the route and not
just the parking. The url is a path, and `requireInteraction` is **false** — a
buzz for "there's a concert in three hours" is a reason to switch alerts off,
unlike a parking timer, which has a deadline and a cost attached.

## A defect found on the way: `notify()` is not a toast

While wiring the Follow button's confirmation, the app's `notify()` turned out to
be `src/notify.js`'s **email-the-founder** function. It reads exactly like a
toast and is not: it POSTs to `/api/notify`, which emails
`parkeasyuk@gmail.com`, falls through to the contact template, and shows the
driver nothing.

Four features had called it that way — the push toggle, the parking timer, the
points card and the referral claim — because the first one to do it looked
correct and the rest copied it. Every one of those sentences went to the
founder's inbox and none reached the driver.

The App already had the right renderer: a `flash` banner pinned to the top. It
was local component state, so nothing outside the App function could reach it.
`src/toast.js` is the missing half — a one-listener bus the App subscribes to and
anything can publish on — and every misdirected call now goes through it,
auto-dismissing after 4.2 seconds. A unit check walks every bare
`notify('…')` in App.jsx and fails unless it names a template type and passes
data.

## Tests

```
node tests/unit/eventAlerts.test.mjs             # 17 checks, 41 mutations
tests/db/run.sh tests/db/event_alerts_seed.sql \
  supabase/migrations/20260919_event_alerts.sql \
  tests/db/event_alerts.test.sql                 # 60 checks
```

Seven mutations initially passed on nothing. Four were real gaps:

- The offset check used 24 and 26 October and never the **change day itself** —
  the only date where reading the offset at midnight rather than midday gives a
  different answer.
- The closure warning was only ever exercised on the sentence branch for a venue
  **without** an area, so it could have been dropped from every venue that has
  one, which is nearly all of them.
- A bare search for `p_session_id: sessionId()` was satisfied by
  `fetchEventAlerts`' call while `setEventAlert` sent none.
- `"24:00"` was not tested, and it is the one malformed time `Date.parse`
  accepts.

Two showed untestable code: a `Number.isFinite` guard in `isDue()` and two shape
regexes in `eventStartUtc()` changed no outcome, and went. The seventh — the
`if (!dayISO || !time)` guard — is an equivalent mutant that was **kept**, and
the test says why: it states the contract rather than claiming to validate a
format, and not every equivalent mutant is a finding.

## Deploying it

Apply `supabase/migrations/20260919_event_alerts.sql`. The sweep needs
`CRON_SECRET` and the VAPID keys from `docs/push.md`; with no keys it returns
`{ ok: true, skipped: 'push not configured' }` rather than erroring hourly.
