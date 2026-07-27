// POST /api/checkout/create-session — create a hosted Stripe Checkout Session
// for a booking (destination charge). ParkEasy is merchant of record; on
// success Stripe transfers 85% of the booking price to the host's connected
// account and keeps 15% + the driver service fee as the application fee.
//
// Money rules (all integer pence, GBP):
//   booking_price   = price_per_hour * duration
//   service_fee     = DRIVER_SERVICE_FEE_PENCE (flat, configurable)
//   driver pays     = booking_price + service_fee
//   application_fee = round(booking_price * 0.15) + service_fee   (ParkEasy)
//   host receives   = booking_price - round(booking_price * 0.15) = 85%
//
// The price is ALWAYS read from the DB, never from the client. TEST MODE ONLY.
import Stripe from 'stripe';

const HOST_COMMISSION = 0.15;

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
  const SERVICE_FEE_PENCE = parseInt(process.env.DRIVER_SERVICE_FEE_PENCE || '100', 10); // £1.00 default (Terms §4.2)

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
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' });

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
    const endsAtISO = new Date(startMs + durationHours * 3600000).toISOString();
    const spaces = Math.max(1, listing.spaces || 1);
    // Bookings that overlap [start, end): existing.starts_at < newEnd AND existing.ends_at > newStart.
    const or = await fetch(`${URL_}/rest/v1/bookings?listing_id=eq.${listing.id}&status=in.(pending,paid)&starts_at=lt.${encodeURIComponent(endsAtISO)}&ends_at=gt.${encodeURIComponent(startsAt)}&select=status,created_at`, { headers: svc });
    const overlaps = or.ok ? await or.json() : [];
    // Ignore stale pending checkouts (abandoned) — the Checkout Session expires in 30 min.
    const PENDING_TTL_MS = 30 * 60000;
    const now = Date.now();
    const held = overlaps.filter(b => b.status === 'paid' || (now - Date.parse(b.created_at) < PENDING_TTL_MS)).length;
    if (held >= spaces) {
      return res.status(409).json({ error: 'That time is already booked. Try a different time or duration.' });
    }

    const bookingPricePence = Math.round(pricePerHour * durationHours * 100);
    const applicationFeePence = Math.round(bookingPricePence * HOST_COMMISSION) + SERVICE_FEE_PENCE;
    const totalPence = bookingPricePence + SERVICE_FEE_PENCE;

    const meta = { listing_id: listing.id, host_id: listing.owner_id, duration: String(durationHours) };

    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: driver?.email || undefined,
      line_items: [
        { price_data: { currency: 'gbp', product_data: { name: `Parking — ${listing.title || 'space'}`, description: listing.address || undefined }, unit_amount: bookingPricePence }, quantity: 1 },
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

    // Record the pending booking; the webhook flips it to paid/failed.
    await fetch(`${URL_}/rest/v1/bookings`, {
      method: 'POST', headers: svc,
      body: JSON.stringify({
        listing_id: listing.id, host_id: listing.owner_id,
        driver_id: driver?.id || null, driver_email: driver?.email || null,
        starts_at: startsAt, duration_hours: durationHours, currency: 'gbp',
        ends_at: endsAtISO,
        cancellation_deadline: new Date(startMs - (parseInt(process.env.CANCEL_CUTOFF_HOURS || '24', 10)) * 3600000).toISOString(),
        amount_total_pence: totalPence, booking_price_pence: bookingPricePence,
        application_fee_pence: applicationFeePence, service_fee_pence: SERVICE_FEE_PENCE,
        stripe_session_id: session.id, stripe_destination: host.stripe_account_id, status: 'pending',
        marketing_opt_in: marketingOptIn,
      }),
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('checkout/create-session', e);
    return res.status(500).json({ error: e.message || 'Could not start checkout' });
  }
}
