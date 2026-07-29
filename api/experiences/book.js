// POST /api/experiences/book — buy a partner experience (tour) through
// ParkEasy on a Stripe Connect destination charge.
//
// Same money plumbing as parking: the driver pays ParkEasy, Stripe routes the
// operator's share to their connected account, and ParkEasy's commission is the
// application fee. Nobody invoices anybody and nobody has to be trusted to
// report their own numbers.
//
// The price is ALWAYS read from the tier row, never from the client — a posted
// price is a suggestion, not a fact.
import Stripe from 'stripe';
import { experienceBreakdown } from '../_pricing.js';

const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
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
  if (!KEY) return res.status(500).json({ error: 'Stripe not configured' });
  if (!KEY.startsWith('sk_test_') && process.env.STRIPE_LIVE_ENABLED !== 'true') {
    return res.status(403).json({ error: 'Live Stripe key detected but STRIPE_LIVE_ENABLED is not set. Refusing to run.' });
  }
  if (!URL_ || !SERVICE) return res.status(500).json({ error: 'Supabase not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const experienceId   = String(body?.experienceId || '').trim();
  const tierId         = String(body?.tierId || '').trim();
  const startsAt       = body?.startsAt || null;
  const pickupLocation = String(body?.pickupLocation || '').slice(0, 200).trim();
  const notes          = String(body?.notes || '').slice(0, 500).trim();
  if (!experienceId || !tierId) return res.status(400).json({ error: 'Missing experience or group size' });
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return res.status(400).json({ error: 'Please choose a date and time' });
  if (Date.parse(startsAt) < Date.now()) return res.status(400).json({ error: 'That time is in the past' });
  if (!pickupLocation) return res.status(400).json({ error: 'Please say where you want to be picked up' });

  // Guest checkout allowed, same as parking.
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
    const er = await fetch(`${URL_}/rest/v1/experiences?id=eq.${encodeURIComponent(experienceId)}&select=*`, { headers: svc });
    const exp = (await er.json())?.[0];
    if (!exp) return res.status(404).json({ error: 'Experience not found' });
    if (exp.status !== 'active') return res.status(400).json({ error: 'This experience is not currently bookable' });
    if (!exp.stripe_account_id) {
      return res.status(409).json({ error: 'This operator hasn’t finished payout setup yet.' });
    }

    const tr = await fetch(`${URL_}/rest/v1/experience_tiers?id=eq.${encodeURIComponent(tierId)}&experience_id=eq.${encodeURIComponent(experienceId)}&select=*`, { headers: svc });
    const tier = (await tr.json())?.[0];
    if (!tier) return res.status(400).json({ error: 'That group size isn’t available' });

    const money = experienceBreakdown(tier.price_pence, exp.commission_rate);

    const meta = { experience_id: exp.id, tier_id: tier.id, kind: 'experience' };
    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: driver?.email || undefined,
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: {
            name: `${exp.title} — ${tier.label}`,
            description: exp.duration_minutes ? `${exp.duration_minutes} minutes` : undefined,
          },
          unit_amount: money.totalPence,
        },
        quantity: 1,
      }],
      payment_intent_data: {
        application_fee_amount: money.commissionPence,
        transfer_data: { destination: exp.stripe_account_id },
        metadata: meta,
      },
      metadata: meta,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      success_url: `${APP_URL}/?experience=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/?experience=cancelled`,
    });

    // Record BEFORE handing back the Stripe URL, and refuse to send anyone to
    // pay if we could not. Same rule as parking: never take money for something
    // we failed to write down.
    const ins = await fetch(`${URL_}/rest/v1/experience_bookings`, {
      method: 'POST', headers: svc,
      body: JSON.stringify({
        experience_id: exp.id, tier_id: tier.id,
        driver_id: driver?.id || null, driver_email: driver?.email || null,
        adults: tier.max_adults, starts_at: new Date(startsAt).toISOString(),
        pickup_location: pickupLocation, notes: notes || null,
        amount_total_pence: money.totalPence,
        commission_pence: money.commissionPence,
        operator_receives_pence: money.operatorReceivesPence,
        stripe_session_id: session.id,
        stripe_destination: exp.stripe_account_id,
        status: 'pending',
      }),
    });
    if (!ins.ok) {
      console.error('experience booking insert failed', ins.status, await ins.text().catch(() => ''));
      return res.status(502).json({ error: 'We couldn’t hold that booking just now — nothing has been charged. Please try again in a moment.' });
    }

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('experiences/book', e);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
}
