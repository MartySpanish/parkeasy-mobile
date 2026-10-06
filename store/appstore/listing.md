# App Store listing — ParkEasy (paste-ready)

*6 October 2026. Same claim discipline as `store/play/listing.md`: nothing from the never-say list in `claude/parkeasy-verified-figures-2026-09-17.md`, no operator named, no "secure parking".*

## App information

| Field | Value |
|---|---|
| Name (30) | `ParkEasy` |
| Subtitle (30) | `Belfast & NI parking, sorted` |
| Primary category | Navigation |
| Secondary category | Travel |
| Bundle ID | `com.parkeasy.belfast` |
| SKU | `parkeasy-ios` |
| Age rating | 4+ (answer No to everything in the questionnaire; "Unrestricted web access" = No — the app shows only parkeasy.uk) |
| Copyright | `2026 ParkEasy Apps Ltd` |
| Support URL | `https://parkeasy.uk/contact` (or `https://parkeasy.uk`) |
| Marketing URL | `https://parkeasy.uk` |
| Privacy Policy URL | `https://parkeasy.uk/privacy` |
| Price | Free (Premium is bought on the website via Stripe — see IAP note below) |

**Promotional text** (170, editable without a new build):
`Find where locals actually park — street spots, hidden gems and bookable spaces across Belfast and Northern Ireland.`

**Keywords** (100 chars, comma-separated, no spaces):
`parking,belfast,car park,northern ireland,park,spaces,hidden gems,derry,lisburn,newry,bangor`

**Description** (4000):

```
Know where you're parking before you leave the house.

ParkEasy is the community parking finder for Belfast and Northern Ireland. It maps the street spots, hidden gems and official car parks that locals actually use — with prices, hours and restrictions — so you stop circling and start parking.

FIND A SPOT
• Search any destination: a stadium, a theatre, a café, a hospital
• See what's free, what's paid and what's a permit zone before you arrive
• Hidden gems: lesser-known spaces submitted and checked by the community
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

Built in Belfast by a one-person company. Questions, corrections or a spot to add: parkeasyuk@gmail.com
```

**What's New (v1.0.0):**
```
First release of ParkEasy for iPhone.
• Find street spots, hidden gems and car parks across Belfast and Northern Ireland
• Book a guaranteed space in advance and pay by card
• Matchday and event parking
• List your own car park or driveway and keep 85%
```

## Screenshots
Required: **6.7" iPhone** (1290×2796 portrait), 3–10 images. Take them on a real iPhone running the TestFlight build (Settings → Display → dark is the app's default anyway), or in Chrome DevTools at 1290×2796 as a fallback. Same six as Play: home map · a spot card · search "SSE Arena" · Davitt Park with the Book button · events strip · hosts page. No device frames; captions optional.

## App Privacy (the nutrition label) — answer exactly this
Data collection: **Yes**. Then per type:

| Data type | Linked to user | Used for tracking | Purpose |
|---|---|---|---|
| Contact Info → Email Address | Yes | No | App Functionality |
| Contact Info → Name | Yes | No | App Functionality |
| User Content → Other User Content (vehicle registration, spot photos) | Yes | No | App Functionality |
| Purchases → Purchase History | Yes | No | App Functionality |
| Location → Coarse/Precise | **No** — not collected: used on-device only, never sent to our servers tied to the account | — | — |
| Usage Data → Product Interaction | No | No | Analytics (cookieless page-view counts) |
| Identifiers | Not collected | | |
| Financial Info → Payment Info | Not collected (entered on Stripe's page) | | |

"Do you or your third-party partners use data for tracking?" → **No**.

This matches `ios/App/App/PrivacyInfo.xcprivacy` and `https://parkeasy.uk/privacy`. Keep all three in step.

## App Review Information
- Sign-in required: **Yes** → give the reviewer the same throwaway test account as Play (create it on parkeasy.uk).
- Contact: Marty Rooney, parkeasyuk@gmail.com, your mobile number.
- **Notes** (paste):

> ParkEasy is a two-sided parking marketplace operating in Belfast and Northern Ireland: drivers find and pre-book parking spaces; hosts (sports clubs, schools, homeowners) list spaces and are paid automatically through Stripe Connect. The app provides the full service — search, map, booking, card payment, host dashboard — not a marketing site. Searching and browsing need no account; booking a space or adding a spot does (test login above). Location is requested only when the user taps "use my location"; the camera only when they add a spot photo. Payments go through Stripe Checkout for physical-world services (parking), which is outside In-App Purchase under guideline 3.1.3(e). Premium (which unlocks hidden-gem map pins) is sold on the website only and is not purchasable inside the app; the app does not link to an external purchase flow. Push notifications are planned for a later version.

## In-App Purchase note (read before submitting)
Parking bookings are **physical goods/services** → Stripe is fine (3.1.3(e)). **Premium** is a digital feature; Apple treats a subscription to in-app digital content as IAP (3.1.1). The safe v1 position, and what the review note says: Premium is not sold inside the app and the app shows no "buy Premium" button or link. **Before submitting**, confirm the site's Premium upsell is hidden when `window.Capacitor` is present on iOS (one guard in the paywall component — see the TODO in `claude/google-play-submission-2026-09-29.md` follow-ups), or expect a 3.1.1 rejection. Existing Premium subscribers who log in should still see their entitlement — "reader app" behaviour is allowed; selling it is not.

## Export compliance
`ITSAppUsesNonExemptEncryption` is already `false` in Info.plist → no question on upload.
