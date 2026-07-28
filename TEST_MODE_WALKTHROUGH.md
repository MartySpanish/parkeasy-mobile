# 5-minute test-mode verification (do this before going live)

Everything below runs on **Stripe test mode** — no real money moves. It proves
the booking → payment → payout → cancel → refund loop before you flip to live.

## Starting state (already done)
- ✅ Host payouts onboarded: `martinrooney3@hotmail.com` → `acct_1TwsA4K…`, `transfers_active = true`.
- ✅ A test listing exists: **🧪 TEST — ParkEasy demo driveway** (£2.00/hr, Belfast).

## The pass

1. **Open the app → Spaces tab.** You should see the 🧪 TEST driveway with a
   **"Reserve & pay · £2.00/hr"** button.
2. **Tap Reserve & pay.** Pick any date/time, set duration to e.g. 2 hours.
   The breakdown should read: Parking £4.00 + service fee £0.99 = **£4.99**.
   (The fee is 15% of the booking, floored at £0.99 and capped at £3.50 —
   £4.00 × 15% = 60p, so the floor applies here. See `api/_pricing.js`.)
   Try 1 hour too: £2.00 is under the **£4.00 minimum booking**, so the button
   should read "Add 1 more hour to book" and be disabled.
3. **Tap "Pay £4.99 with card."** You land on Stripe's hosted checkout.
   Pay with test card **4242 4242 4242 4242**, any future expiry, any CVC/postcode.
4. **You return to the app** with a green **"Booking confirmed"** banner.
   - Check **Spaces → Your bookings**: the booking shows **PAID**.
   - Check email: you should get a driver confirmation + a host "your space was
     booked" email.
5. **Cancel it.** In "Your bookings", tap **Cancel booking** → confirm.
   Because the start time is >24h away, you should see **"£4.99 refunded."**
   The booking flips to **CANCELLED**.
6. **Admin check.** Header → **Analytics → Bookings & payouts** shows the paid
   count, gross, and your fees.

## What proves it worked
- In the **Stripe test dashboard → Payments**: one payment of £4.99, with an
  **application fee** (£1.59 = 60p commission + 99p service fee) and a
  **transfer** to the connected account (£3.40), then a **refund** +
  **transfer reversal** after you cancel.
- In Supabase, the `bookings` row goes `pending → paid → cancelled` with
  `refund_pence = 500`.

(If you want, tell me when you've done step 4 and step 5 and I'll query the
database to confirm the row transitions and the refund landed.)

## Clean up
Delete the test listing when you're done (or ask me to): it's
`rental_listings.id = ed12ebcf-c265-4fae-bda3-ddae5a604dad`.

## Then go live
Follow **STRIPE_CONNECT_SETUP.md → "Going LIVE"**: activate live Connect, add
`sk_live_…` + the live `whsec_…` + `STRIPE_LIVE_ENABLED=true` on Vercel, redeploy.
