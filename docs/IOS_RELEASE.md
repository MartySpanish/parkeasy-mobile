# ParkEasy on the App Store — how the iOS app is built and shipped (no Mac needed)

*Written 6 October 2026. Companion to `.github/workflows/build-ios.yml`,
`scripts/ios-prepare.mjs`, `ios/` and `store/appstore/listing.md`.*

## The shape of it

Same idea as Android (`docs/ANDROID_RELEASE.md`): a **Capacitor 8 native
shell that loads https://parkeasy.uk**. Bookings, Stripe Checkout, email login
and the cookie banner all work unchanged because the WebView's origin is the
site; a Vercel deploy reaches app users instantly; a new store build is only
needed when the shell changes.

Everything builds on **GitHub's macOS runners** — you never need a Mac. The
certificate is created from the Apple Developer website with a key pair
generated for you (below), and the upload to App Store Connect happens inside
the workflow.

What the shell adds: launcher icon, navy launch screen, permission strings for
location / camera / photos (App Review rejects an app that asks without
them), a privacy manifest (`PrivacyInfo.xcprivacy`, mandatory), Universal
Links for parkeasy.uk, portrait-only on iPhone.

## The honest risk: App Review Guideline 4.2 (Minimum Functionality)

Apple rejects apps that are "just a website in a frame" more often than
Google does. ParkEasy is a real two-sided marketplace with payments, so it is
not a brochure site, but on the first submission expect a reviewer to ask.
Put the paragraph under *App Review notes* in `store/appstore/listing.md` into
the review notes field, give them a test login, and if they still push back
the reply is: native push for booking/timer alerts is the next shell release
(it is also the next thing worth building). Do **not** promise a date.

## One-time setup (about 45 minutes of clicking, then waiting on Apple)

### 1. Apple Developer Program — enrol as an organisation ($99/year)
https://developer.apple.com/programs/enroll/ → **Organization** → ParkEasy
Apps Ltd. Needs a **D-U-N-S number** (free; the same one the Play Console
organisation account needs, so request it once: https://developer.apple.com/enroll/duns-lookup/ ),
your legal authority to sign for the company (you are the sole director — say
so), and a phone call from Apple in some cases. Typically 2–5 working days.
Afterwards note the **Team ID** (10 characters, Membership details page).

### 2. Create the distribution certificate — from the website, no Mac
A key pair has been generated for you:
`parkeasy-apple-dist.key` (private — keep with the Android keystore in your
password manager) and `parkeasy-apple-dist.csr` (the request).

1. https://developer.apple.com/account/resources/certificates/add → **Apple
   Distribution** → upload `parkeasy-apple-dist.csr` → download `distribution.cer`.
2. Turn it into the .p12 the workflow needs (any machine with OpenSSL — this
   Claude session can do it if you attach the .cer):
   ```
   openssl x509 -in distribution.cer -inform DER -out distribution.pem
   openssl pkcs12 -export -inkey parkeasy-apple-dist.key -in distribution.pem \
     -name "Apple Distribution: ParkEasy Apps Ltd" -out parkeasy-dist.p12
   base64 -w0 parkeasy-dist.p12 > parkeasy-dist.p12.base64
   ```
   Pick a password when asked; that is `APPLE_CERT_PASSWORD`.

### 3. App Store Connect API key
https://appstoreconnect.apple.com/access/integrations/api → **Team keys** →
Generate → name `GitHub Actions`, access **App Manager** → download the `.p8`
(one chance only). Note the **Key ID** and the **Issuer ID** at the top of the
page. `base64 -w0 AuthKey_XXXX.p8` gives `APPLE_API_KEY_P8_BASE64`.

### 4. Register the app
- Identifiers → `+` → App IDs → App → Bundle ID **explicit** `com.parkeasy.belfast`,
  description ParkEasy → capabilities: tick **Associated Domains** → Register.
- App Store Connect → My Apps → `+` New App → iOS, name **ParkEasy**, primary
  language English (U.K.), bundle ID `com.parkeasy.belfast`, SKU `parkeasy-ios`.

### 5. Six GitHub secrets
Repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `APPLE_TEAM_ID` | from step 1 |
| `APPLE_CERT_P12_BASE64` | from step 2 |
| `APPLE_CERT_PASSWORD` | from step 2 |
| `APPLE_API_KEY_ID` | from step 3 |
| `APPLE_API_ISSUER_ID` | from step 3 |
| `APPLE_API_KEY_P8_BASE64` | from step 3 |

### 6. Universal Links — one edit on the site
`public/.well-known/apple-app-site-association` carries `TEAMID.com.parkeasy.belfast`.
Replace `TEAMID` with the real Team ID, merge, and parkeasy.uk links open in
the app. (Vercel already serves the file as JSON — `vercel.json`.)

### 7. Build and upload
GitHub → Actions → **iOS release (App Store)** → Run workflow → `1.0.0`.
About 15 minutes. With the secrets in place it archives, signs, exports and
**uploads the build to App Store Connect**; without them it only compiles for
the simulator as a check.

Then in App Store Connect → TestFlight: the build appears after processing
(10–30 min). Add yourself as an internal tester, install TestFlight on your
iPhone, and try the real thing: search, a spot, a booking through Stripe and
back, the location prompt, the camera prompt from "Add a spot".

### 8. Submit
App Store Connect → App Store tab → fill the listing from
`store/appstore/listing.md` (screenshots: 6.7" iPhone at 1290×2796, 3–10 of
them; 6.5" is optional now), App Privacy answers, Age rating 4+, pick the
TestFlight build, Review notes with the test login → **Add for Review**.
First review 1–3 days; budget for one rejection-and-reply round (see 4.2 above).

## Day-to-day
- Web change → Vercel → app users have it. No store build.
- Shell change → Run workflow with a new version (`1.0.1`…). The build number
  is automatic (run number + 100), so every upload is accepted as newer.
- Regenerate `ios/` (rarely): `rm -rf ios && npx cap add ios --packagemanager SPM
  && npx cap sync ios && node scripts/ios-prepare.mjs`, then `npx
  capacitor-assets generate --ios --splashBackgroundColor '#0A0F1A'
  --splashBackgroundColorDark '#0A0F1A'`.

## Not in v1
Native push (needs an APNs key — a second line in this same workflow when the
time comes — plus `@capacitor/push-notifications` and a token endpoint), Apple
Pay inside Checkout (card entry works), Live Activities, offline tiles.
