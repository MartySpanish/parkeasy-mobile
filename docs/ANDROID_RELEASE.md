# ParkEasy on Google Play — how the Android app is built and shipped

*Written 29 September 2026. Companion to `.github/workflows/build-android.yml`,
`scripts/android-prepare.mjs`, `capacitor.config.json` and `android/`.*

## The shape of it

The Android app is a **Capacitor 8 native shell that loads https://parkeasy.uk**.
It is not a bundled copy of the site. That is deliberate:

- Every `/api/…` call, the Stripe Checkout round trip (`success_url` on
  parkeasy.uk), Supabase email/password auth and the cookie banner all work
  exactly as on the web, because the WebView's origin *is* parkeasy.uk.
- A web deploy on Vercel reaches app users instantly. A new store build is only
  needed when the **shell** changes (icon, permissions, Capacitor upgrade).
- Google Play requires `targetSdk 36` for new apps from 31 Aug 2026; Capacitor
  8.5 targets 36 out of the box (`android/variables.gradle`).

What the shell adds over the browser: a launcher icon, a navy splash, location
and camera permissions declared so the WebView can ask for them, App Links so
`parkeasy.uk` URLs open in the app, and the hardware back button closing sheets
(that already worked — `src/useBackButton.js`).

What the app knows about itself: `window.Capacitor` is set inside the shell.
The site uses that to skip the service worker (no web push in a WebView), to
treat itself as already installed (no "add to home screen" prompts), and to
show the right copy where push would otherwise be offered. Analytics and funnel
events are **on** in the app — the hostname is parkeasy.uk, so they count.

## One-time setup (about 20 minutes)

### 1. The upload keystore → four GitHub secrets
An upload keystore has been generated (`parkeasy-upload.jks`, alias
`parkeasy-upload`, valid to 2054). **Keep the .jks file and its password
somewhere safe outside this repo** (password manager). Then, in GitHub →
this repo → Settings → Secrets and variables → Actions → *New repository secret*:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | contents of `parkeasy-upload.jks.base64` (one long line) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `parkeasy-upload` |
| `ANDROID_KEY_PASSWORD` | the same password |

If the keystore is ever lost, Play App Signing lets you request an upload-key
reset from the Play Console — it is not the end of the app.

### 2. Google Play Console account — register as an **organisation**
https://play.google.com/console → $25 one-off. Register as **Organisation**
(ParkEasy Apps Ltd, NI742027, 17 Gransha Park, Belfast). A personal account
created after Nov 2023 must run 12 testers for 14 days before it may publish;
an organisation account skips that gate. You will need a D-U-N-S number (free,
takes a few days; Play walks you through requesting one) and to verify the
company email/website (add the meta tag or DNS record Play gives you to
parkeasy.uk — Vercel → project → Domains).

### 3. Build the bundle
GitHub → Actions → **Android release (Play Store)** → *Run workflow* → version
`1.0.0`. About 8 minutes. Download two artifacts:

- `ParkEasy-play-store-bundle` → the `.aab` — upload this to Play.
- `ParkEasy-test-apk` → the `.apk` — AirDrop/email it to an Android phone,
  open it, allow "install from this source", and test the real build first.

### 4. Create the app in Play Console
Create app → name **ParkEasy**, app (not game), free. Then work down the
left-hand *Set up your app* checklist. Every answer is in
`store/play/listing.md`, including the Data safety form line by line.

- Privacy policy URL: `https://parkeasy.uk/privacy`
- Account deletion URL: `https://parkeasy.uk/delete-account`
- App access: "All functionality is available without special access" is
  **wrong** — bookings need an account. Choose *All or some functionality is
  restricted* and give the reviewer a test login (make a throwaway account on
  parkeasy.uk for this).

### 5. Internal testing first, then production
Testing → Internal testing → Create release → upload the `.aab` → add your own
Gmail as a tester → Save → Review release → Start rollout. Install from the
link Play gives you. When it looks right, Production → Create release → the
same `.aab` → roll out to 100%. First review usually takes 1–7 days.

### 6. After the first upload: App Links
Play App Signing re-signs the app with **Google's** key. App Links verify
against the certificate the phone sees, so the Play-signed fingerprint must be
in `public/.well-known/assetlinks.json` too:

Play Console → Test and release → Setup → App signing → copy the
**App signing key certificate** SHA-256 → add it as a second entry in the
`sha256_cert_fingerprints` array (keep the upload-key one) → deploy. Nothing
else changes; the intent-filter in `AndroidManifest.xml` is already there.

## Day-to-day

- **Web change** → push to main → Vercel deploys → app users have it. No
  store build.
- **Shell change** (new permission, icon, Capacitor bump) → bump the version
  in the *Run workflow* box (`1.0.1`, `1.1.0` …) → upload the new `.aab` to
  Production. `versionCode` is automatic (the GitHub run number + 100), so
  every upload is accepted as newer.
- **Regenerate `android/`** (rarely needed): `rm -rf android && npx cap add
  android && npx cap sync android && node scripts/android-prepare.mjs`, then
  `npx capacitor-assets generate --android --iconBackgroundColor '#45E0C6'
  --splashBackgroundColor '#0A0F1A'` from the files in `assets/`. The
  prepare script is idempotent.

## What is deliberately not in v1

- **Native push notifications.** Needs `@capacitor/push-notifications`, a
  Firebase project and `google-services.json`, plus an API route to store FCM
  tokens next to the web `push_subscriptions`. The email fallback covers timers
  and event alerts meanwhile. This is the first shell change worth a 1.1.
- **Google Pay inside Stripe Checkout** — the WebView falls back to card entry.
  Card works; Apple/Google Pay is a native-SDK job later.
- **Offline map tiles** — the service worker is skipped in the shell.
- **iOS.** Same Capacitor project can add `ios/`, but it needs a Mac with
  Xcode to build and the Apple Developer Program ($99/yr) under ParkEasy Apps
  Ltd. Do Android first; it is where the demand and the cheaper account are.
