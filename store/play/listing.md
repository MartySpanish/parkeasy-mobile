# Google Play listing — ParkEasy (paste-ready)

*29 September 2026. Figures and claims follow `claude/parkeasy-verified-figures-2026-09-17.md`: no "secure parking", no operator named, no counts that go stale.*

## Store listing

**App name** (30 max): `ParkEasy`

**Short description** (80 max):
`Find where locals actually park in Belfast & NI. Hidden gems, prices, bookings.`

**Full description** (4000 max):

```
Know where you're parking before you leave the house.

ParkEasy is the community parking finder for Belfast and Northern Ireland. It maps the street spots, hidden gems and official car parks that locals actually use — with prices, hours and restrictions — so you stop circling and start parking.

FIND A SPOT
• Search any destination: a stadium, a theatre, a café, a hospital
• See what's free, what's paid, and what's a permit zone before you arrive
• Hidden gems: the lesser-known spaces locals know about, submitted and checked by the community
• EV chargers mapped alongside parking
• Live "in use" hints and a "Changed" button so wrong spots get fixed fast

BOOK A SPACE
• Reserve a guaranteed space in advance at clubs and private driveways
• Pay by card before you arrive — no cash, no ticket machine
• Your booking, address and gate instructions in one place

MATCHDAY AND EVENT MODE
• Parking options for concerts, matches and festivals, with the honest alternatives too (park-and-ride, public transport)

FOR HOSTS
Got a car park that sits empty at weekends, or a driveway near a venue? List it free and keep 85% of every booking, paid automatically. A Belfast GAA club is already earning from a car park that used to sit empty on weekdays.

COMMUNITY-POWERED
Every spot can be improved by the people who use it: tap "Parked here", "It's full" or "Something's wrong" and the map gets better for the next driver. Add a photo of a spot and earn free Premium.

PREMIUM (optional)
Unlock every hidden gem and skip the booking service fee. Cancel any time.

Built in Belfast by a one-person company. Questions, corrections or a spot to add: parkeasyuk@gmail.com
```

**App category:** Maps & Navigation
**Tags:** parking, Belfast, Northern Ireland, car park, hidden gems
**Contact email:** parkeasyuk@gmail.com
**Website:** https://parkeasy.uk
**Privacy policy:** https://parkeasy.uk/privacy

## Graphics

| Asset | Spec | File |
|---|---|---|
| App icon | 512×512 PNG, no alpha | `store/play/icon-512.png` |
| Feature graphic | 1024×500 PNG | `store/play/feature-graphic-1024x500.png` |
| Phone screenshots | 2–8, 16:9 or 9:16, min 320px, max 3840px — take at **1080×2400** | *to capture — see below* |

**Screenshots to take** (on a phone with the test APK, or Chrome DevTools → device toolbar → Pixel 7 → capture screenshot; dark theme):
1. Home map, Belfast, with spots and a hidden-gem pin visible
2. A spot card open showing price / hours / restrictions
3. Search results for "SSE Arena" or "Windsor Park"
4. Davitt Park listing with the Book button and price
5. Events / matchday strip
6. Hosts page ("keep 85%")

Add a one-line caption in Play's editor over each (e.g. "Prices and rules before you arrive"). Don't put device frames on them; Play adds its own.

## App content (the left-hand checklist)

**Privacy policy:** https://parkeasy.uk/privacy

**App access:** *All or some functionality is restricted* → add instructions:
> Browsing and search work without an account. Booking a space, adding a spot and Premium need a free account. Test login: [create a throwaway account on parkeasy.uk and paste the email/password here].

**Ads:** No, the app does not contain ads. (The partner directory is free listings, not third-party ad SDKs.)

**Content rating questionnaire:** Category *Utility, Productivity, Communication, or Other*. Answer No to everything (no violence, sexual content, profanity, gambling, drugs, user-to-user chat, unrestricted web browsing). Expect **PEGI 3 / Everyone**.

**Target audience:** 18 and over. Not designed for children.

**News app:** No. **COVID-19 contact tracing:** No. **Government app:** No.

**Financial features:** the app takes payments for parking and subscriptions through Stripe Checkout. Answer: *My app doesn't provide any financial features* is **wrong** — choose the option covering "other financial features / payments for goods and services" only if Play's form lists it; it is not a loan, banking or crypto app.

**Data safety form** — answer exactly this:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all user data encrypted in transit? | **Yes** (HTTPS everywhere) |
| Do you provide a way for users to request that their data is deleted? | **Yes** → https://parkeasy.uk/delete-account |

Data types collected (all *Collected*, none *Shared* with third parties for their own purposes — Stripe/Supabase/Vercel are processors):

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Location → Approximate & Precise | Yes (only when the user taps "use my location"; not stored server-side) | No | Optional | App functionality |
| Personal info → Name | Yes | No | Optional | App functionality, Account management |
| Personal info → Email address | Yes | No | Required for account | App functionality, Account management |
| Personal info → Other (vehicle registration) | Yes | No | Required to book | App functionality (given to the host of a booked space) |
| Financial info → Purchase history | Yes | No | Required to book | App functionality |
| Financial info → Payment info | **No** — card details are entered on Stripe's page, never seen by the app | — | — | — |
| Photos → Photos | Yes (only if the user adds a spot photo) | No | Optional | App functionality |
| App activity → App interactions | Yes (cookieless page-view counts) | No | Optional | Analytics |
| Device or other IDs | No | — | — | — |

Sharing note: vehicle registration and booking time are shown to the host of the booked space. Play's form treats that as "app functionality", not as sharing with a third party for their purposes — but say it in the privacy policy (already there, section 7).

## Release notes (v1.0.0)

```
First release of the ParkEasy app for Android.
• Find street spots, hidden gems and car parks across Belfast and Northern Ireland
• Book a guaranteed space in advance and pay by card
• Matchday and event parking
• List your own car park or driveway and keep 85%
```
