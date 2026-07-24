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
  if (!KEY.startsWith('sk_test_')) return res.status(403).json({ error: 'Blocked: live Stripe key detected. Test-mode only until insurance is in place.' });
  if (!URL_ || !SERVICE) return res.status(500).json({ error: 'Supabase not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const listingId = body?.listingId;
  const durationHours = Math.max(1, Math.min(24, parseInt(body?.durationHours || 1, 10)));
  const startsAt = body?.startsAt || null;
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

    const pricePerHour = Number(listing.price_per_hour);
    if (!pricePerHour || pricePerHour <= 0) return res.status(400).json({ error: 'This listing has no hourly price set' });

    // The host must have completed Connect onboarding (transfers active).
    const hr = await fetch(`${URL_}/rest/v1/host_accounts?host_id=eq.${listing.owner_id}&select=*`, { headers: svc });
    const host = (await hr.json())?.[0];
    if (!host?.stripe_account_id || !host.transfers_active) {
      return res.status(409).json({ error: 'This host hasn’t finished setting up payouts yet, so the space can’t be booked.' });
    }

    const bookingPricePence = Math.round(pricePerHour * durationHours * 100);
    const applicationFeePence = Math.round(bookingPricePence * HOST_COMMISSION) + SERVICE_FEE_PENCE;
    const totalPence = bookingPricePence + SERVICE_FEE_PENCE;

    const meta = { listing_id: listing.id, host_id: listing.owner_id, duration: String(durationHours) };

    const stripe = new Stripe(KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: driver?.email || undefined,
      line_items: [
        { price_data: { currency: 'gbp', product_data: { name: `Parking — ${listing.title || 'space'}`, description: listing.address || undefined }, unit_amount: bookingPricePence }, quantity: 1 },
        { price_data: { currency: 'gbp', product_data: { name: 'ParkEasy service fee' }, unit_amount: SERVICE_FEE_PENCE }, quantity: 1 },
      ],
      payment_intent_data: {
        application_fee_amount: applicationFeePence,
        transfer_data: { destination: host.stripe_account_id },
        metadata: meta,
      },
      metadata: meta,
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
        amount_total_pence: totalPence, booking_price_pence: bookingPricePence,
        application_fee_pence: applicationFeePence, service_fee_pence: SERVICE_FEE_PENCE,
        stripe_session_id: session.id, stripe_destination: host.stripe_account_id, status: 'pending',
      }),
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('checkout/create-session', e);
    return res.status(500).json({ error: e.message || 'Could not start checkout' });
  }
}
