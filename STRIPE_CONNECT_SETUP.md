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
as the application fee. Host payouts are **weekly**.

The driver service fee is **15% of the booking price, floored at £0.99 and
capped at £3.50**, and the **minimum booking is £4.00**. All of that lives in
`api/_pricing.js` — the single source of truth, imported by both
`/api/checkout/create-session` and `/api/passes`, and mirrored in `src/App.jsx`
(search `PRICING MIRROR`). Setting `DRIVER_SERVICE_FEE_PENCE` still forces a
flat fee, so the old behaviour is one env var away without a redeploy.

**The 15% host commission does not change.** It is in signed host agreements
and in the press; host supply is the binding constraint on this marketplace, so
extra take comes from the driver side or not at all.

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
3. **Booking + payment:** open that listing and tap **Reserve & pay** → pick a date/time/duration → **Pay with card**. Use test card `4242 4242 4242 4242`, any future expiry/CVC. (The button appears on any listing with an hourly price; it calls `POST /api/checkout/create-session`.)
   - Confirm: the `bookings` row flips to `status='paid'`; in Stripe → Payments you see the charge, the **application fee**, and the **transfer** to the connected account.

## Now built (the full functional system)

- **Double-booking prevention** — checkout rejects a slot already held (paid, or a pending checkout < 30 min old) up to the listing's `spaces` capacity; sessions expire in 30 min.
- **Refunds/cancellations** (`POST /api/bookings/cancel`, Terms §5): host-cancel or driver ≥24h → full refund; driver <24h → 50% of the parking price; after start → none. Uses `reverse_transfer` + `refund_application_fee`.
- **Confirmation emails** to driver + host + founder on payment (Resend).
- **"Your bookings"** panel in the Spaces tab (driver + host view, with cancel).
- **Bookings & payouts** section in the admin dashboard (paid count, gross, our fees, hosts paid-ready).

## Going LIVE (real money) — do this only when insured

The code no longer hard-blocks live keys; instead it refuses a live key **unless `STRIPE_LIVE_ENABLED=true` is set**, so going live is a deliberate switch. To flip it:

1. **Activate your Stripe account for LIVE mode** (business details + bank) and **enable Connect in LIVE mode** — same as you did in test, but on the live side.
2. **Create a LIVE webhook** at `https://parkeasy-gray.vercel.app/api/webhooks/stripe`, copy its `whsec_…`.
3. On the Vercel project, set (Production): `STRIPE_SECRET_KEY=sk_live_…`, `STRIPE_WEBHOOK_SECRET=whsec_…` (the live one), and **`STRIPE_LIVE_ENABLED=true`**.
4. Redeploy.

Until step 3, everything stays exactly as it is (test mode). Setting `STRIPE_LIVE_ENABLED=true` with a live key is the single, intentional go-live action.

## Still to consider
- **Restricted/interrupted onboarding** shows a generic "continue setup" — no per-requirement prompting yet.
- Refund fee-retention is generous by design (full refund ≥24h incl. the driver service fee) — tighten later if you want to keep the fee on driver cancels, once verified in test mode.

## Safety notes

- Every write endpoint refuses a non-`sk_test_` key (belt-and-braces against accidental live mode).
- Prices are always read from `rental_listings` server-side — the client cannot set its own price.
- `bookings` / `host_accounts` are RLS-protected: users can read only their own rows; all writes are service-role (server) only.
