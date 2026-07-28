// POST /api/checkout/create-session — create a hosted Stripe Checkout Session
// for a booking (destination charge). ParkEasy is merchant of record; on
// success Stripe transfers 85% of the booking price to the host's connected
// account and keeps 15% + the driver service fee as the application fee.
//
// Money rules live in api/_pricing.js — that module is the single source of
// truth and this endpoint must not re-derive any of it. In short:
//   booking_price   = price_per_hour * duration
//   service_fee     = 15% of booking_price, floored at 99p, capped at £3.50
//   driver pays     = booking_price + service_fee
//   application_fee = round(booking_price * 0.15) + service_fee   (ParkEasy)
//   host receives   = booking_price - round(booking_price * 0.15) = 85%
//
// The price is ALWAYS read from the DB, never from the client. TEST MODE ONLY.
import Stripe from 'stripe';
import { MIN_BOOKING_PENCE, priceBreakdown } from '../_pricing.js';

const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.STRIPE_SECRET_KEY;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const APP_URL = process.env.APP_URL || 'https://parkeasy.uk';

  if (!KEY) return res.status(500).json({ error: 'Stripe not configured (STRIPE_SECRET_KEY)' });
  if (!KEY.startsWith('sk_test_') && process.env.STRIPE_LIVE_ENABLED !== 'true') {
    return res.status(403).json({ error: 'Live Stripe key detected but STRIPE_LIVE_ENABLED is not set. Refusing to run.' });
  }
  if (!URL_ || !SERVICE) return res.status(500).json({ error: 'Supabase not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const listingId = body?.listingId;
  const durationHours = Math.max(1, Math.min(24, parseInt(body?.durationHours || 1, 10)));
  const startsAt = body?.startsAt || null;
  const marketingOptIn = body?.marketingOptIn === true;
  // Recurring bookings: same slot, weekly, paid once up front. Each week is
  // still an ordinary booking row (same cancellation rules per occurrence).
  const repeatWeeks = Math.max(1, Math.min(12, parseInt(body?.repeatWeeks || 1, 10)));
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' });

  // Vehicle registration — the host uses this to match a car to a paid booking.
  // Normalised uppercase without separators so 'ab12 cde' and 'AB12CDE' compare
  // equal when a marshal is checking a plate against their list. Kept permissive
  // (UK current, older UK and Irish plates all differ) — a driver blocked from
  // paying by an over-strict pattern is a lost booking, and a wrong plate is a
  // conversation on the day, not a payment failure.
  // Required for new bookings, and enforced HERE rather than trusting the
  // client — the button being disabled is a courtesy, not a control.
  const vehicleReg = String(body?.vehicleReg || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (!vehicleReg) {
    return res.status(400).json({ error: 'Please enter your vehicle registration so the host knows it’s you when you arrive.' });
  }
  if (vehicleReg.length < 2) {
    return res.status(400).json({ error: 'That vehicle registration looks too short — please check it.' });
  }

  // Optional driver identity (guest checkout is allowed per Terms §3.1).
  let driver = null;
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (jwt && ANON) {
    try {
      const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
      if (u.ok) driver = await u.json();
    } catch { /* treat as guest */ }
  }

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  try {
    const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(listingId)}&select=*`, { headers: svc });
    const listing = (await lr.json())?.[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.status !== 'active') return res.status(400).json({ error: 'This listing is not currently bookable' });

    let pricePerHour = Number(listing.price_per_hour);
    if (!pricePerHour || pricePerHour <= 0) return res.status(400).json({ error: 'This listing has no hourly price set' });

    // Event pricing: a per-date override replaces the base hourly price.
    if (startsAt) {
      try {
        const dateStr = String(startsAt).slice(0, 10);
        const ovr = await fetch(`${URL_}/rest/v1/listing_price_overrides?listing_id=eq.${listing.id}&override_date=eq.${dateStr}&select=price_pence`, { headers: svc });
        const o = ovr.ok ? (await ovr.json())?.[0] : null;
        if (o?.price_pence > 0) pricePerHour = o.price_pence / 100;
      } catch { /* fall back to base price */ }
    }

    // The host must have completed Connect onboarding (transfers active).
    const hr = await fetch(`${URL_}/rest/v1/host_accounts?host_id=eq.${listing.owner_id}&select=*`, { headers: svc });
    const host = (await hr.json())?.[0];
    if (!host?.stripe_account_id || !host.transfers_active) {
      return res.status(409).json({ error: 'This host hasn’t finished setting up payouts yet, so the space can’t be booked.' });
    }

    // Double-booking prevention. A start time is required so we can check the
    // requested window against existing bookings for this listing.
    if (!startsAt) return res.status(400).json({ error: 'Please choose a start date and time' });
    const startMs = Date.parse(startsAt);
    if (Number.isNaN(startMs)) return res.status(400).json({ error: 'Invalid start time' });
    const spaces = Math.max(1, listing.spaces || 1);
    const PENDING_TTL_MS = 30 * 60000;
    const now = Date.now();
    const WEEK_MS = 7 * 86400000;
    // Every occurrence must be free, or we'd take money for a slot we can't honour.
    const occurrences = [];
    for (let i = 0; i < repeatWeeks; i++) {
      const s0 = new Date(startMs + i * WEEK_MS).toISOString();
      const e0 = new Date(startMs + i * WEEK_MS + durationHours * 3600000).toISOString();
      const or = await fetch(`${URL_}/rest/v1/bookings?listing_id=eq.${listing.id}&status=in.(pending,paid)&starts_at=lt.${encodeURIComponent(e0)}&ends_at=gt.${encodeURIComponent(s0)}&select=status,created_at`, { headers: svc });
      const overlaps = or.ok ? await or.json() : [];
      const held = overlaps.filter(b => b.status === 'paid' || (now - Date.parse(b.created_at) < PENDING_TTL_MS)).length;
      if (held >= spaces) {
        return res.status(409).json({
          error: repeatWeeks > 1
            ? `Week ${i + 1} of that repeat is already booked. Try a different time, or fewer weeks.`
            : 'That time is already booked. Try a different time or duration.',
        });
      }
      occurrences.push({ starts_at: s0, ends_at: e0 });
    }
    const endsAtISO = occurrences[0].ends_at;

    const perWeekPence = Math.round(pricePerHour * durationHours * 100);
    const bookingPricePence = perWeekPence * repeatWeeks;

    // Below the minimum the fixed part of the card fee makes the booking not
    // worth running. Checked against the FIRST week, not the series total, so
    // a repeat booking can't sneak a sub-minimum slot through by multiplying up.
    if (perWeekPence < MIN_BOOKING_PENCE) {
      const needHours = Math.ceil(MIN_BOOKING_PENCE / Math.max(1, Math.round(pricePerHour * 100)));
      return res.status(400).json({
        error: `Minimum booking is £${(MIN_BOOKING_PENCE / 100).toFixed(2)}. At £${pricePerHour.toFixed(2)}/hr that's ${needHours} hour${needHours !== 1 ? 's' : ''} — please book a bit longer.`,
      });
    }

    // One driver service fee per booking series, not per week.
    const money = priceBreakdown(bookingPricePence, process.env);
    const SERVICE_FEE_PENCE = money.serviceFeePence;
    const applicationFeePence = money.applicationFeePence;
    const totalPence = money.totalPence;

    const meta = { listing_id: listing.id, host_id: listing.owner_id, duration: String(durationHours), weeks: String(repeatWeeks) };

    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: driver?.email || undefined,
      line_items: [
        { price_data: { currency: 'gbp', product_data: { name: repeatWeeks > 1 ? `Parking — ${listing.title || 'space'} (${repeatWeeks} weekly bookings)` : `Parking — ${listing.title || 'space'}`, description: listing.address || undefined }, unit_amount: bookingPricePence }, quantity: 1 },
        { price_data: { currency: 'gbp', product_data: { name: 'Driver service fee' }, unit_amount: SERVICE_FEE_PENCE }, quantity: 1 },
      ],
      payment_intent_data: {
        application_fee_amount: applicationFeePence,
        transfer_data: { destination: host.stripe_account_id },
        metadata: meta,
      },
      metadata: meta,
      expires_at: Math.floor(now / 1000) + 30 * 60,   // hold the slot for 30 min max
      success_url: `${APP_URL}/?booking=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/?booking=cancelled`,
    });

    // Record the pending booking(s); the webhook flips them to paid/failed.
    const recurrenceGroup = repeatWeeks > 1 ? crypto.randomUUID() : null;
    const rows = occurrences.map((occ, i) => ({
      listing_id: listing.id, host_id: listing.owner_id,
      driver_id: driver?.id || null, driver_email: driver?.email || null,
      starts_at: occ.starts_at, ends_at: occ.ends_at, duration_hours: durationHours, currency: 'gbp',
      // On EVERY occurrence, not just the first: a marshal checking week 7 of a
      // repeat booking needs the plate as much as week 1 does. (Money stays on
      // the first row only — that's a different concern.)
      vehicle_reg: vehicleReg,
      cancellation_deadline: new Date(Date.parse(occ.starts_at) - (parseInt(process.env.CANCEL_CUTOFF_HOURS || '24', 10)) * 3600000).toISOString(),
      // Money is recorded on the FIRST occurrence only, so totals and refunds
      // never double-count a series that was paid for once.
      amount_total_pence: i === 0 ? totalPence : 0,
      booking_price_pence: i === 0 ? bookingPricePence : 0,
      application_fee_pence: i === 0 ? applicationFeePence : 0,
      service_fee_pence: i === 0 ? SERVICE_FEE_PENCE : 0,
      stripe_session_id: i === 0 ? session.id : `${session.id}#${i}`,
      stripe_destination: host.stripe_account_id, status: 'pending',
      marketing_opt_in: marketingOptIn,
      recurrence_group: recurrenceGroup, recurrence_index: i,
    }));
    // The response here was previously ignored. If the insert failed we still
    // handed back the Stripe URL, so the driver paid and no booking row
    // existed — no confirmation, no host email, nothing for support to find.
    // Never send someone to pay for a booking we failed to record.
    let ins = await fetch(`${URL_}/rest/v1/bookings`, { method: 'POST', headers: svc, body: JSON.stringify(rows) });

    if (!ins.ok) {
      const detail = await ins.text().catch(() => '');
      // 23P01 = exclusion constraint violation, i.e. bookings_no_overlap fired:
      // someone paid for this slot between our availability check above and
      // this insert. That's a race we can only lose at write time, so report it
      // as "just taken" rather than a server error.
      if (/23P01|bookings_no_overlap/.test(detail)) {
        return res.status(409).json({ error: 'That slot was just taken by another driver. Pick a different time — you haven’t been charged.' });
      }
      // Degrade rather than block if the vehicle_reg migration hasn't been
      // applied yet: retry once without the column. A booking that records
      // everything except the plate beats a checkout that refuses to run.
      if (/vehicle_reg/.test(detail)) {
        console.error('bookings insert: vehicle_reg column missing — apply 20260728_booking_vehicle_reg.sql. Retrying without it.');
        const fallback = rows.map(({ vehicle_reg, ...rest }) => rest);
        ins = await fetch(`${URL_}/rest/v1/bookings`, { method: 'POST', headers: svc, body: JSON.stringify(fallback) });
      }
      if (!ins.ok) {
        console.error('bookings insert failed', ins.status, detail.slice(0, 400));
        return res.status(502).json({ error: 'We couldn’t hold that booking just now — nothing has been charged. Please try again in a moment.' });
      }
    }

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('checkout/create-session', e);
    return res.status(500).json({ error: e.message || 'Could not start checkout' });
  }
}
