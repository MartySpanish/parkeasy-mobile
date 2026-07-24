// POST /api/webhooks/stripe — Stripe's server-to-server notifications.
// Verifies the signature against the raw body, then syncs state into Supabase:
//   • checkout.session.completed / async_payment_succeeded  → booking paid
//   • checkout.session.async_payment_failed / expired        → booking failed
//   • account.updated / capability.updated                   → host_accounts state
//   • payout.paid / payout.failed                            → logged (future host UI)
//
// Supabase is a cache; Stripe is the source of truth. TEST MODE ONLY.
import Stripe from 'stripe';

// Stripe needs the raw request body to verify the signature — disable parsing.
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

async function syncHostAccount(stripe, svc, URL_, accountId) {
  const account = await stripe.accounts.retrieve(accountId);
  const transfersActive = account.capabilities?.transfers === 'active';
  const status = transfersActive && account.payouts_enabled
    ? 'active'
    : account.requirements?.disabled_reason
      ? 'restricted'
      : 'onboarding';
  // Upsert on host_id (from account metadata) so a missing row self-heals.
  const hostId = account.metadata?.host_id || null;
  if (hostId) {
    await fetch(`${URL_}/rest/v1/host_accounts?on_conflict=host_id`, {
      method: 'POST', headers: { ...svc, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ host_id: hostId, stripe_account_id: accountId, onboarding_status: status, transfers_active: transfersActive, updated_at: new Date().toISOString() }),
    });
  } else {
    await fetch(`${URL_}/rest/v1/host_accounts?stripe_account_id=eq.${accountId}`, {
      method: 'PATCH', headers: svc,
      body: JSON.stringify({ onboarding_status: status, transfers_active: transfersActive, updated_at: new Date().toISOString() }),
    });
  }
}

async function markBooking(svc, URL_, sessionId, patch) {
  if (!sessionId) return;
  await fetch(`${URL_}/rest/v1/bookings?stripe_session_id=eq.${sessionId}`, {
    method: 'PATCH', headers: svc,
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!KEY || !WEBHOOK_SECRET || !URL_ || !SERVICE) return res.status(500).json({ error: 'Webhook not configured' });

  const stripe = new Stripe(KEY);
  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  let event;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(raw, sig, WEBHOOK_SECRET);
  } catch (e) {
    console.error('stripe webhook signature verification failed', e.message);
    return res.status(400).json({ error: `Webhook signature verification failed` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const s = event.data.object;
        await markBooking(svc, URL_, s.id, { status: 'paid', stripe_payment_intent: s.payment_intent || null });
        break;
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const s = event.data.object;
        await markBooking(svc, URL_, s.id, { status: 'failed' });
        break;
      }
      case 'account.updated': {
        await syncHostAccount(stripe, svc, URL_, event.data.object.id);
        break;
      }
      case 'capability.updated': {
        const accountId = event.data.object.account;
        if (accountId) await syncHostAccount(stripe, svc, URL_, accountId);
        break;
      }
      case 'payout.paid':
      case 'payout.failed':
        // Reserved for host payout visibility in a later dashboard.
        break;
      default:
        break;
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('stripe webhook handler error', e);
    // 500 tells Stripe to retry.
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
