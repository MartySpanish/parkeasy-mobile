# Stripe Connect — setup & test runbook (TEST MODE ONLY)

> ⚠️ **This code is unverified by a human. It is test-mode only.** The endpoints
> refuse to run unless `STRIPE_SECRET_KEY` starts with `sk_test_`. Do **not** put
> a live key in until public-liability insurance is in place and a full manual
> test pass has been done. No real bookings until then.

## What was built

**Model:** Marketplace / destination charges. Drivers pay ParkEasy's platform
account via **hosted Stripe Checkout**; Stripe auto-transfers **85%** of the
booking price to the host's **Express** connected account (transfers capability
only). ParkEasy keeps **15% of the booking + 100% of the driver service fee**
(a flat £1.00 by default) as the application fee. Host payouts are **weekly**.

- **DB** (`supabase/migrations/20260724_stripe_connect.sql`, already applied to project `bbgqregyogtjzaustbng`):
  - `host_accounts` — one Stripe account per host (`stripe_account_id`, `onboarding_status`, `transfers_active`). A cache of Stripe state; the webhook keeps it current.
  - `bookings` — driver reservations, all money in integer pence.
- **Endpoints** (Vercel functions, served from `parkeasy-gray.vercel.app`):
  - `POST /api/connect/onboard` — create/resume the host's Express account, return a hosted onboarding link.
  - `GET  /api/connect/return`, `GET /api/connect/refresh` — Account Link targets.
  - `POST /api/checkout/create-session` — Checkout Session with the 85/15 split (price read from the DB, never the client).
  - `POST /api/webhooks/stripe` — signature-verified state sync (booking paid/failed, host account status).
- **Client** — a "Get set up to receive payments" card in the **Spaces** tab that starts onboarding; `?payouts=…` / `?booking=…` return banners.

## What you need to do (all in test mode)

### 1. Env vars — on the Vercel project that serves `parkeasy-gray.vercel.app`
Settings → Environment Variables (Production + Preview):

| Name | Value | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` | Sandbox → Developers → API keys. **Must be a test key** or the endpoints refuse to run. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | From the webhook you create in step 3. |
| `APP_URL` | `https://parkeasy.uk` | Where users land back in the app. |
| `API_BASE` | `https://parkeasy-gray.vercel.app` | Where Stripe sends onboarding return/refresh (defaults to this if unset). |
| `DRIVER_SERVICE_FEE_PENCE` | `100` | Optional — flat driver fee in pence (£1.00). Tune later. |

`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` are already set (used by the other functions). No publishable key is needed — hosted Checkout/Account Links only.

### 2. Deploy
Merge this PR (or deploy the branch to a Vercel preview). The functions pick up the env vars on the next deploy.

### 3. Create the test webhook
Stripe Dashboard (sandbox) → Developers → Webhooks → Add endpoint:
- URL: `https://parkeasy-gray.vercel.app/api/webhooks/stripe`
- Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `account.updated`, `capability.updated` (optionally `payout.paid`, `payout.failed`).
- Copy the signing secret → set `STRIPE_WEBHOOK_SECRET` (step 1), redeploy.

## How to test end to end

1. **Host onboarding:** sign in, go to **Spaces → Set up payouts**. You should be redirected to Stripe's hosted onboarding. Use Stripe's test values (test SSN/DOB/address, sort code `10-88-00`, account `00012345`). Finish → you land back with "Payouts are set up".
   - Confirm `host_accounts` for your user shows `transfers_active = true`, `onboarding_status = active`.
2. **A bookable listing:** create a listing (Spaces → List Your Space) under the **same** host account, publish it so `status='active'`.
3. **Booking + payment:** trigger `POST /api/checkout/create-session` with `{ listingId, durationHours }` (a "Reserve & pay" button isn't wired into the UI yet — this is the next piece). Pay with test card `4242 4242 4242 4242`, any future expiry/CVC.
   - Confirm: the `bookings` row flips to `status='paid'`; in Stripe → Payments you see the charge, the **application fee**, and the **transfer** to the connected account.

## Known gaps / next pieces (deliberately not built yet)

1. **No driver-facing "Reserve & pay" button** in the UI — the `create-session` endpoint exists and is correct, but the booking screen (date/time/duration → pay) is the next build. Listings currently still show "Contact Owner".
2. **Refunds/cancellations** (Terms §5) aren't wired — ParkEasy is merchant of record, so refunds hit the platform balance; build this deliberately before real money.
3. **Restricted/interrupted onboarding** states show a generic "continue setup" but there's no per-requirement prompting yet.
4. **Insurance is a hard production blocker** — keep this in test mode until it's sorted.

## Safety notes

- Every write endpoint refuses a non-`sk_test_` key (belt-and-braces against accidental live mode).
- Prices are always read from `rental_listings` server-side — the client cannot set its own price.
- `bookings` / `host_accounts` are RLS-protected: users can read only their own rows; all writes are service-role (server) only.
