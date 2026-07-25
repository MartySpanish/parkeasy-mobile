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

// Booking confirmation emails (driver + host + founder), via Resend. Best-effort.
async function sendBookingEmails(svc, URL_, sessionId) {
  const KEYR = process.env.RESEND_API_KEY;
  const FROM = process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>';
  const FOUNDER = process.env.CONTACT_EMAIL;
  if (!KEYR) return;
  try {
    const br = await fetch(`${URL_}/rest/v1/bookings?stripe_session_id=eq.${sessionId}&select=*`, { headers: svc });
    const b = (await br.json())?.[0];
    if (!b) return;
    let listing = null;
    if (b.listing_id) {
      const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${b.listing_id}&select=title,address,contact_email,instructions`, { headers: svc });
      listing = (await lr.json())?.[0] || null;
    }
    const gbp = (p) => `£${(p / 100).toFixed(2)}`;
    const when = b.starts_at ? new Date(b.starts_at).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : 'see app';
    const title = listing?.title || 'a space';
    const rows = (extra) => `<table style="border-collapse:collapse"><tr><td style="padding:4px 10px;color:#64748b">Space</td><td style="padding:4px 10px"><strong>${title}</strong></td></tr>`
      + `<tr><td style="padding:4px 10px;color:#64748b">Address</td><td style="padding:4px 10px">${listing?.address || ''}</td></tr>`
      + `<tr><td style="padding:4px 10px;color:#64748b">When</td><td style="padding:4px 10px">${when} · ${b.duration_hours}h</td></tr>`
      + `<tr><td style="padding:4px 10px;color:#64748b">Total paid</td><td style="padding:4px 10px">${gbp(b.amount_total_pence)}</td></tr>${extra || ''}</table>`;
    const send = (to, subject, html) => fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${KEYR}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    }).catch(() => {});
    const jobs = [];
    if (b.driver_email) jobs.push(send(b.driver_email, `✅ Parking booked — ${title}`,
      `<h2 style="font-family:system-ui">Booking confirmed</h2>${rows(listing?.instructions ? `<tr><td style="padding:4px 10px;color:#64748b">How to find it</td><td style="padding:4px 10px">${listing.instructions}</td></tr>` : '')}<p style="font-family:system-ui;color:#64748b;font-size:12px">Free cancellation up to 1 hour before start (full refund 24h+ before). You park at your own risk — see our Terms.</p>`));
    if (listing?.contact_email) jobs.push(send(listing.contact_email, `🅿️ Your space was booked — ${title}`,
      `<h2 style="font-family:system-ui">You've got a booking</h2>${rows(`<tr><td style="padding:4px 10px;color:#64748b">You receive</td><td style="padding:4px 10px"><strong>${gbp(b.booking_price_pence - (b.application_fee_pence - b.service_fee_pence))}</strong> (after 15% fee), paid out weekly by Stripe.</td></tr>`)}`));
    if (FOUNDER) jobs.push(send(FOUNDER, `💷 New ParkEasy booking — ${title}`, rows()));
    await Promise.all(jobs);
  } catch (e) { console.error('sendBookingEmails', e); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!KEY || !WEBHOOK_SECRET || !URL_ || !SERVICE) return res.status(500).json({ error: 'Webhook not configured' });

  const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
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
        if (s.metadata?.pass_id) {
          // Season-pass purchase → credit the pass (idempotent on session id).
          await fetch(`${URL_}/rest/v1/pass_purchases?on_conflict=stripe_session_id`, {
            method: 'POST', headers: { ...svc, Prefer: 'resolution=ignore-duplicates' },
            body: JSON.stringify({
              pass_id: s.metadata.pass_id, driver_id: s.metadata.driver_id,
              stripe_session_id: s.id, stripe_payment_intent_id: s.payment_intent || null,
              credits_remaining: parseInt(s.metadata.num_credits || '0', 10) || 0,
            }),
          }).catch(() => {});
        } else {
          await markBooking(svc, URL_, s.id, { status: 'paid', stripe_payment_intent: s.payment_intent || null });
          await sendBookingEmails(svc, URL_, s.id);
        }
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
