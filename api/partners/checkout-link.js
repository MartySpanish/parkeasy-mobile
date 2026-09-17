// POST /api/partners/checkout-link — a Stripe subscription link for one partner.
//
// Marty sells a card over the phone or in person, then sends the business a
// link. This creates it. The partner never logs into ParkEasy; they click, pay,
// and the webhook does the rest (tier, sold_at, renewal_due_at).
//
// THE PRICE IDS COME FROM THE ENVIRONMENT, not from this code and not from the
// caller:
//
//   STRIPE_PRICE_PARTNER_FEATURED    £25/mo recurring price id
//   STRIPE_PRICE_PARTNER_SPONSORED   £60/mo recurring price id
//
// Set them in the Vercel project. A price id in source would be wrong in test
// mode, wrong after any price change, and impossible to differ between
// environments; taking one from the client would let anybody buy a £60 card for
// whatever a request body said.
//
// THE TIER TRAVELS IN METADATA, mirrored onto the subscription. The webhook
// reads it from there rather than mapping a price id back to a tier — a price
// can be duplicated or swapped in the Stripe dashboard, and a partner silently
// dropping from sponsored to featured because somebody made a new price is a
// bug nobody finds until the partner does.
import Stripe from 'stripe';
import { TIERS } from '../../src/partnerTiers.js';

const DEFAULT_ADMINS = 'martinrooney3@hotmail.com,parkeasyuk@gmail.com';
const PRICE_ENV = {
  featured:  'STRIPE_PRICE_PARTNER_FEATURED',
  sponsored: 'STRIPE_PRICE_PARTNER_SPONSORED',
};

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
  const ADMINS = (process.env.ADMIN_EMAILS || DEFAULT_ADMINS).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

  if (!KEY) return res.status(500).json({ error: 'Stripe not configured (STRIPE_SECRET_KEY)' });
  // Same live-mode guard as booking checkout: a live key without the explicit
  // switch means somebody is about to take real money by accident.
  if (!KEY.startsWith('sk_test_') && process.env.STRIPE_LIVE_ENABLED !== 'true') {
    return res.status(403).json({ error: 'Live payments are not switched on (STRIPE_LIVE_ENABLED).' });
  }
  if (!URL_ || !ANON || !SERVICE) return res.status(500).json({ error: 'Supabase not configured' });

  // Admin only. This creates a payment link in ParkEasy's name.
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Not signed in' });
  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }
  if (!ADMINS.includes((caller.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Not an admin account' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const partnerId = body?.partnerId;
  const tier = String(body?.tier || '');

  if (!partnerId) return res.status(400).json({ error: 'Missing partnerId' });
  if (!TIERS[tier] || TIERS[tier].pricePence === 0) {
    return res.status(400).json({ error: 'Pick a paid tier (featured or sponsored).' });
  }

  const priceId = process.env[PRICE_ENV[tier]];
  if (!priceId) {
    return res.status(500).json({
      error: `${PRICE_ENV[tier]} is not set in Vercel. Create the ${TIERS[tier].label} `
        + `product (£${(TIERS[tier].pricePence / 100).toFixed(0)}/month, recurring) in Stripe `
        + `and add its price id as that environment variable.`,
    });
  }

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  try {
    const pr = await fetch(`${URL_}/rest/v1/partners?id=eq.${encodeURIComponent(partnerId)}&select=id,slug,name,invoice_email,stripe_customer_id`, { headers: svc });
    const partner = (await pr.json())?.[0];
    if (!partner) return res.status(404).json({ error: 'Partner not found' });

    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
    const meta = { partner_id: partner.id, partner_slug: partner.slug || '', tier };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Reuse the customer if they have one, so a partner upgrading from
      // featured to sponsored does not become a second customer in Stripe.
      ...(partner.stripe_customer_id
        ? { customer: partner.stripe_customer_id }
        : { customer_email: partner.invoice_email || undefined }),
      metadata: meta,
      // Mirrored onto the subscription itself, which is what the webhook reads.
      // Without this the tier lives only on the checkout session and is gone by
      // the time the first renewal invoice arrives.
      subscription_data: { metadata: meta },
      success_url: `${APP_URL}/?partner=subscribed`,
      cancel_url: `${APP_URL}/?partner=cancelled`,
    });

    return res.status(200).json({ ok: true, url: session.url, tier, partner: partner.name });
  } catch (e) {
    console.error('partner checkout link failed', String(e));
    return res.status(500).json({ error: e?.message || 'Could not create the link' });
  }
}
