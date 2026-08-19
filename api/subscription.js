// GET  /api/subscription           — what the caller is subscribed to, if anything
// POST /api/subscription {action}  — 'cancel': ends it at the period end
//
// SELF-SERVE, AND DELIBERATELY BORING. Two taps and it is done: no retention
// interstitial, no "are you sure" maze, no discount offer, no phone number.
//
// WHY NOW, WHEN NOTHING REQUIRES IT YET. The FAQ told subscribers to contact
// ParkEasy to cancel, which is a real liability and a slow one — every one of
// those is an email somebody has to answer, and a subscriber who cannot get out
// easily is a chargeback waiting to happen. The DMCC Act 2024 subscription
// regime, expected spring 2027, will require straightforward cancellation,
// renewal reminders and pre-contract information. Building it now is cheap;
// retrofitting it against a deadline is not.
//
// AT THE PERIOD END, NOT IMMEDIATELY, AND NOT PRORATED. They paid for the
// month; taking the access away the moment they cancel would be keeping money
// for a service withdrawn. The confirmation says the exact date it ends, so
// there is nothing to be surprised by.
import Stripe from 'stripe';
import { bccFor } from './_bcc.js';

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

const ukDate = (unixSeconds) => new Date(unixSeconds * 1000).toLocaleDateString('en-GB',
  { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/**
 * The caller's live Stripe subscription, or null.
 *
 * Found by EMAIL, because Premium is bought through a Stripe payment link and
 * there is no customer id stored against the ParkEasy account — the entitlement
 * lives in promo_redemptions under the code STRIPE-SUB. Matching on the address
 * they are signed in with is the only link that exists, and it is the same link
 * the webhook already uses to grant Premium in the first place.
 */
async function findSubscription(stripe, email) {
  if (!email) return null;
  const customers = await stripe.customers.list({ email, limit: 10 });
  for (const c of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 10 });
    const live = subs.data.find(s => ['active', 'trialing', 'past_due'].includes(s.status));
    if (live) return { customer: c, subscription: live };
  }
  return null;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.STRIPE_SECRET_KEY;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!KEY || !URL_ || !ANON) return res.status(500).json({ error: 'Not configured' });
  if (!stripeAllowed(KEY)) return res.status(403).json({ error: 'Live Stripe key without STRIPE_LIVE_ENABLED — refusing.' });

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in to manage your subscription' });
  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  const email = (caller.email || '').trim().toLowerCase();
  const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });

  try {
    const found = await findSubscription(stripe, email);

    if (req.method === 'GET') {
      if (!found) return res.status(200).json({ subscription: null });
      const s = found.subscription;
      const item = s.items?.data?.[0];
      return res.status(200).json({
        subscription: {
          id: s.id,
          status: s.status,
          cancel_at_period_end: !!s.cancel_at_period_end,
          current_period_end: s.current_period_end,
          // Pre-contract information, in the DMCCA sense: what it costs, how
          // often, and when the next one is taken. Said plainly, before they
          // have to ask.
          renews_on: ukDate(s.current_period_end),
          amount_pence: item?.price?.unit_amount ?? null,
          interval: item?.price?.recurring?.interval || null,
        },
      });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    if (body?.action !== 'cancel') return res.status(400).json({ error: 'Unknown action' });
    if (!found) return res.status(404).json({ error: 'No active subscription found for this account.' });

    const s = found.subscription;
    if (s.cancel_at_period_end) {
      // Already cancelled. Say so and give the date again rather than treating
      // a second tap as an error.
      return res.status(200).json({
        ok: true, already: true,
        ends_on: ukDate(s.current_period_end), current_period_end: s.current_period_end,
      });
    }

    const updated = await stripe.subscriptions.update(s.id, {
      cancel_at_period_end: true,
      // No proration. They paid for this period and they keep it — clawing part
      // of it back would be charging for a service and then withdrawing it.
      proration_behavior: 'none',
      cancellation_details: { comment: 'Cancelled by the subscriber in the ParkEasy app' },
    });

    const endsOn = ukDate(updated.current_period_end);

    // The confirmation email. Not a retention attempt: it states the date and
    // how to come back, and nothing else.
    const KEYR = process.env.RESEND_API_KEY;
    if (KEYR && email) {
      const FROM = process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>';
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEYR}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: [email], bcc: bccFor([email]),
          subject: 'Your ParkEasy Premium subscription is cancelled',
          html: `<p style="font-family:system-ui">Your ParkEasy Premium subscription has been cancelled. You won't be charged again.</p>
                 <p style="font-family:system-ui"><strong>You keep Premium until ${endsOn}.</strong> After that your account carries on working — the free spots, the map and bookings are all still there. It's the hidden gems and the EV picks that go.</p>
                 <p style="font-family:system-ui">Changed your mind? You can subscribe again any time in the app, and nothing is lost in the meantime.</p>
                 <p style="font-family:system-ui;color:#64748b;font-size:12px">ParkEasy · Parkeasy Apps Ltd · parkeasy.uk</p>`,
        }),
      }).catch(e => console.error('cancellation email failed', e?.message || e));
    }

    return res.status(200).json({
      ok: true,
      ends_on: endsOn,
      current_period_end: updated.current_period_end,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Could not reach your subscription just now.', detail: String(e?.message || e).slice(0, 200) });
  }
}
