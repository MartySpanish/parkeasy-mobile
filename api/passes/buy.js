// POST /api/passes/buy — buy a season/bundle pass for a listing via hosted
// Stripe Checkout (destination charge to the host). ParkEasy's cut = 15% of
// the pass price + the driver service fee, charged ONCE here; redemptions are
// then free. The webhook credits the pass on checkout.session.completed.
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
  const SERVICE_FEE_PENCE = parseInt(process.env.DRIVER_SERVICE_FEE_PENCE || '100', 10);

  if (!KEY) return res.status(500).json({ error: 'Stripe not configured' });
  if (!KEY.startsWith('sk_test_') && process.env.STRIPE_LIVE_ENABLED !== 'true') {
    return res.status(403).json({ error: 'Live Stripe key detected but STRIPE_LIVE_ENABLED is not set.' });
  }
  if (!URL_ || !ANON || !SERVICE) return res.status(500).json({ error: 'Supabase not configured' });

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in to buy a pass' });
  let driver;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    driver = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const passId = body?.passId;
  if (!passId) return res.status(400).json({ error: 'Missing passId' });

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  try {
    const pr = await fetch(`${URL_}/rest/v1/listing_passes?id=eq.${encodeURIComponent(passId)}&select=*`, { headers: svc });
    const pass = (await pr.json())?.[0];
    if (!pass || !pass.active) return res.status(404).json({ error: 'Pass not found or inactive' });
    if (pass.valid_to && pass.valid_to < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: 'This pass has expired' });
    }

    const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${pass.listing_id}&select=id,title,owner_id,status`, { headers: svc });
    const listing = (await lr.json())?.[0];
    if (!listing || listing.status !== 'active') return res.status(400).json({ error: 'Listing not bookable' });

    const hr = await fetch(`${URL_}/rest/v1/host_accounts?host_id=eq.${listing.owner_id}&select=stripe_account_id,transfers_active`, { headers: svc });
    const host = (await hr.json())?.[0];
    if (!host?.stripe_account_id || !host.transfers_active) {
      return res.status(409).json({ error: 'This host hasn’t finished payout setup yet.' });
    }

    const feePence = Math.round(pass.price_pence * HOST_COMMISSION) + SERVICE_FEE_PENCE;
    const totalPence = pass.price_pence + SERVICE_FEE_PENCE;
    const meta = { pass_id: pass.id, driver_id: driver.id, num_credits: String(pass.num_credits) };

    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: driver.email || undefined,
      line_items: [
        { price_data: { currency: 'gbp', product_data: { name: `${pass.name} — ${listing.title}`, description: `${pass.num_credits} bookings. Unused credits are not refunded after ${pass.valid_to || 'the season ends'}.` }, unit_amount: pass.price_pence }, quantity: 1 },
        { price_data: { currency: 'gbp', product_data: { name: 'ParkEasy service fee (one-off)' }, unit_amount: SERVICE_FEE_PENCE }, quantity: 1 },
      ],
      payment_intent_data: { application_fee_amount: feePence, transfer_data: { destination: host.stripe_account_id }, metadata: meta },
      metadata: meta,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      success_url: `${APP_URL}/?pass=success`,
      cancel_url: `${APP_URL}/?pass=cancelled`,
    });

    return res.status(200).json({ url: session.url, totalPence });
  } catch (e) {
    console.error('passes/buy', e);
    return res.status(500).json({ error: e.message || 'Could not start pass purchase' });
  }
}
