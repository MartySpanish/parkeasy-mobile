// POST /api/wash        — request a wash, returns a Stripe Checkout URL
// GET  /api/wash?week=  — founder only: the week's list, with plates, for the valeter
//
// MANUAL v1, DELIBERATELY. No valeter accounts, no scheduling engine, no
// payment split. A driver ticks a box, ParkEasy takes the money, Marty hands a
// list of registrations to a valeter. Everything else optimises a service
// nobody has bought yet.
//
// 100% TO PARKEASY, AND THAT IS NOT A PRICING CHOICE. This is not a booking:
// no host is providing anything, so there is no 85% and no destination charge.
// ParkEasy is a booking AGENT — the wash is carried out by an independent
// contractor and the contract for it is between them and the driver, which is
// exactly why the money does not route through Connect.
import Stripe from 'stripe';
import { WASH_TIERS, tierById, CUTOFF_HOURS, DISCLAIMER, availableWashDates } from '../src/data/carWash.js';

const DEFAULT_ADMINS = 'martinrooney3@hotmail.com,parkeasyuk@gmail.com';
const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
const stripeAllowed = (KEY) =>
  Boolean(KEY) && (KEY.startsWith('sk_test_') || process.env.STRIPE_LIVE_ENABLED === 'true');

const normaliseVrn = (v) => (String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null);
const maskVrn = (v) => { const s = normaliseVrn(v); return s ? `${s.slice(0,2)}***${s.slice(-2)}` : '(none)'; };

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !ANON || !SERVICE) return res.status(500).json({ error: 'Not configured' });
  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in to book a wash' });
  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  // ── The valeter's list ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const ADMINS = (process.env.ADMIN_EMAILS || DEFAULT_ADMINS).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (!ADMINS.includes((caller.email || '').toLowerCase())) return res.status(403).json({ error: 'Not an admin account' });

    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.from || '') ? req.query.from
      : new Date().toISOString().slice(0, 10);
    const to = (() => { const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); })();

    const r = await fetch(
      `${URL_}/rest/v1/wash_requests?wash_date=gte.${from}&wash_date=lte.${to}`
      + `&status=in.(requested,confirmed,completed)&select=id,wash_date,vrn,vehicle_tier,price_pence,status,notes,`
      + `rental_listings(title,address)&order=wash_date.asc`,
      { headers: svc },
    );
    if (!r.ok) return res.status(502).json({ error: 'Could not read the wash list' });
    const rows = await r.json();
    return res.status(200).json({
      from, to,
      total_pence: rows.reduce((a, w) => a + (w.price_pence || 0), 0),
      washes: rows.map(w => ({
        id: w.id, date: w.wash_date, vrn: w.vrn, tier: w.vehicle_tier,
        price_pence: w.price_pence, status: w.status, notes: w.notes || null,
        site: w.rental_listings?.title || null, address: w.rental_listings?.address || null,
      })),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.STRIPE_SECRET_KEY;
  if (!stripeAllowed(KEY)) return res.status(403).json({ error: 'Live Stripe key without STRIPE_LIVE_ENABLED — refusing.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const tier = tierById(body?.tier);
  if (!tier) return res.status(400).json({ error: 'Choose a vehicle size.' });
  const washDate = /^\d{4}-\d{2}-\d{2}$/.test(body?.washDate || '') ? body.washDate : null;
  if (!washDate) return res.status(400).json({ error: 'Choose a wash date.' });
  const vrn = normaliseVrn(body?.vrn);
  if (!vrn) return res.status(400).json({ error: 'We need the vehicle registration for the valeter.' });
  if (!body?.bookingId && !body?.permitClaimId) {
    return res.status(400).json({ error: 'A wash goes with a booking or a work permit.' });
  }

  try {
    // The origin, and the listing it implies. NEVER a listing id off the
    // request: that would let anybody book a wash at any site, including one
    // that does not offer them, and price it from a tier they chose.
    let listingId = null;
    if (body.bookingId) {
      const b = await fetch(`${URL_}/rest/v1/bookings?id=eq.${encodeURIComponent(body.bookingId)}&select=id,listing_id,driver_id`, { headers: svc })
        .then(r => r.json()).then(a => a?.[0]);
      if (!b) return res.status(404).json({ error: 'Booking not found.' });
      if (b.driver_id && b.driver_id !== caller.id) return res.status(403).json({ error: 'That booking is not yours.' });
      listingId = b.listing_id;
    } else {
      const c = await fetch(
        `${URL_}/rest/v1/permit_claims?id=eq.${encodeURIComponent(body.permitClaimId)}`
        + `&select=id,corporate_members(user_id),corporate_permit_blocks(listing_id)`,
        { headers: svc },
      ).then(r => r.json()).then(a => a?.[0]);
      if (!c) return res.status(404).json({ error: 'Permit not found.' });
      if (c.corporate_members?.user_id !== caller.id) return res.status(403).json({ error: 'That permit is not yours.' });
      listingId = c.corporate_permit_blocks?.listing_id;
    }
    if (!listingId) return res.status(400).json({ error: 'Could not work out which car park this wash is for.' });

    const listing = await fetch(
      `${URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(listingId)}&select=id,title,address,wash_enabled,wash_days`,
      { headers: svc },
    ).then(r => r.json()).then(a => a?.[0]);
    if (!listing?.wash_enabled) return res.status(409).json({ error: 'This site does not offer washes yet.' });

    // The cutoff, checked here so the message is useful. The database checks the
    // DAY independently (guard_wash_day), so a backfill or a future client
    // cannot book a valeter for a day nobody is working.
    const allowed = availableWashDates(listing.wash_days || [1], new Date());
    if (!allowed.includes(washDate)) {
      return res.status(409).json({
        error: `Requests close ${CUTOFF_HOURS} hours before the wash day. The next date we can still take is ${allowed[0] || 'not available'}.`,
        next_available: allowed[0] || null,
      });
    }

    const APP_URL = process.env.APP_URL || 'https://parkeasy.uk';
    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: caller.email || undefined,
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: {
            name: `Car wash while you're parked — ${tier.label}`,
            // The agent relationship, on the payment page itself. Somebody
            // reading a Stripe receipt should not have to guess who washed
            // their car or who to talk to if it went wrong.
            description: `${listing.title || 'Car park'} · ${washDate}. ${DISCLAIMER}`,
          },
          unit_amount: tier.pricePence,
        },
        quantity: 1,
      }],
      // No application_fee_amount and no transfer_data. This is not a
      // marketplace transaction; there is no host share to route.
      metadata: {
        kind: 'car_wash', listing_id: listingId, wash_date: washDate,
        tier: tier.id, vrn,
        ...(body.bookingId ? { booking_id: body.bookingId } : { permit_claim_id: body.permitClaimId }),
      },
      success_url: `${APP_URL}/?wash=success`,
      cancel_url: `${APP_URL}/?wash=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    const ins = await fetch(`${URL_}/rest/v1/wash_requests`, {
      method: 'POST', headers: { ...svc, Prefer: 'return=representation' },
      body: JSON.stringify({
        booking_id: body.bookingId || null,
        permit_claim_id: body.bookingId ? null : body.permitClaimId,
        user_id: caller.id,
        listing_id: listingId,
        wash_date: washDate,
        vehicle_tier: tier.id,
        price_pence: tier.pricePence,
        vrn,
        notes: (body.notes || '').trim().slice(0, 300) || null,
        stripe_session_id: session.id,
        status: 'requested',
      }),
    });
    if (!ins.ok) {
      // Never hand somebody a payment link for a request we failed to record.
      // The same rule as the booking flow, and for the same reason: they pay,
      // nothing exists, and support has nothing to find.
      const detail = await ins.text().catch(() => '');
      return res.status(502).json({ error: 'Could not record that wash request.', detail: detail.slice(0, 200) });
    }

    console.log(`wash requested site=${listingId} date=${washDate} tier=${tier.id} vrn=${maskVrn(vrn)}`);
    return res.status(200).json({ url: session.url, price_pence: tier.pricePence, wash_date: washDate });
  } catch (e) {
    return res.status(500).json({ error: 'Could not start that just now.', detail: String(e?.message || e).slice(0, 200) });
  }
}

export { WASH_TIERS };
