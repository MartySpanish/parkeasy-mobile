// GET /api/cron/renewal-reminders — a heads-up 7 days before an annual renewal.
//
// Run daily by Vercel Cron (see vercel.json). Protected by CRON_SECRET, because
// an open endpoint that sends email is an open endpoint that sends spam.
//
// NOT REQUIRED YET, AND WORTH IT ANYWAY. The DMCC Act 2024 subscription regime
// (expected spring 2027) will require renewal reminders. Ahead of that, this
// prevents the specific complaint that kills trust in a subscription business:
// an annual charge nobody remembered agreeing to, twelve months later, followed
// by a chargeback and a one-star review.
//
// ANNUAL ONLY, ON PURPOSE. A monthly subscriber sees the charge often enough to
// remember it; a reminder every month is a nuisance email that teaches people
// to filter us. It is the twelve-month gap that produces the surprise.
import Stripe from 'stripe';
import { bccFor } from '../_bcc.js';

const REMIND_DAYS_BEFORE = 7;
const stripeAllowed = (KEY) =>
  Boolean(KEY) && (KEY.startsWith('sk_test_') || process.env.STRIPE_LIVE_ENABLED === 'true');

const gbp = (p) => `£${((p || 0) / 100).toFixed(2)}`;
const ukDate = (unix) => new Date(unix * 1000).toLocaleDateString('en-GB',
  { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export default async function handler(req, res) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Refuse without it
  // rather than defaulting to open — the failure mode of a mistake here is
  // mail sent to real customers.
  const secret = process.env.CRON_SECRET;
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secret || auth !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const KEY = process.env.STRIPE_SECRET_KEY;
  const KEYR = process.env.RESEND_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'Not configured' });
  if (!stripeAllowed(KEY)) return res.status(403).json({ error: 'Live Stripe key without STRIPE_LIVE_ENABLED — refusing.' });

  const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
  const FROM = process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>';

  // The 24-hour window exactly REMIND_DAYS_BEFORE days out. A window rather
  // than a single instant because this runs once a day: anything narrower and a
  // renewal falls between two runs and nobody is told.
  const now = Math.floor(Date.now() / 1000);
  const from = now + (REMIND_DAYS_BEFORE - 1) * 86400;
  const to = now + REMIND_DAYS_BEFORE * 86400;

  const sent = [];
  const skipped = [];
  try {
    let startingAfter;
    for (let page = 0; page < 10; page++) {
      const subs = await stripe.subscriptions.list({
        status: 'active', limit: 100,
        current_period_end: { gte: from, lt: to },
        expand: ['data.customer'],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const s of subs.data) {
        const item = s.items?.data?.[0];
        const interval = item?.price?.recurring?.interval;
        const email = (s.customer && typeof s.customer === 'object' ? s.customer.email : null) || null;

        // Annual only, and never one that is already on its way out — telling
        // somebody who cancelled last week that they are about to be charged is
        // the opposite of reassuring.
        if (interval !== 'year') { skipped.push({ id: s.id, why: interval || 'no interval' }); continue; }
        if (s.cancel_at_period_end) { skipped.push({ id: s.id, why: 'already cancelling' }); continue; }
        if (!email) { skipped.push({ id: s.id, why: 'no email' }); continue; }

        // Corporate permit blocks are billed annually in some cases and are NOT
        // consumer subscriptions — a company on invoiced terms does not want a
        // consumer renewal reminder, and their finance contact did not sign up
        // for one.
        if (s.metadata?.corporate_permit_block_id) { skipped.push({ id: s.id, why: 'corporate' }); continue; }

        const when = ukDate(s.current_period_end);
        const amount = gbp(item?.price?.unit_amount);
        if (KEYR) {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${KEYR}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: FROM, to: [email], bcc: bccFor([email]),
              subject: `Your ParkEasy Premium renews on ${when}`,
              html: `<p style="font-family:system-ui">Just so it isn't a surprise: your ParkEasy Premium subscription renews on <strong>${when}</strong>, and <strong>${amount}</strong> will be taken then.</p>
                     <p style="font-family:system-ui">Nothing to do if you're happy to carry on. If you'd rather stop, you can cancel yourself in the app — Account → Cancel subscription — and you'll keep Premium until ${when} either way.</p>
                     <p style="font-family:system-ui;color:#64748b;font-size:12px">ParkEasy · Parkeasy Apps Ltd · parkeasy.uk</p>`,
            }),
          });
          if (!r.ok) { skipped.push({ id: s.id, why: `email ${r.status}` }); continue; }
        }
        sent.push(s.id);
      }

      if (!subs.has_more) break;
      startingAfter = subs.data[subs.data.length - 1]?.id;
    }

    return res.status(200).json({ ok: true, window: { from, to }, sent: sent.length, skipped: skipped.length, detail: { sent, skipped } });
  } catch (e) {
    return res.status(500).json({ error: 'Reminder run failed', detail: String(e?.message || e).slice(0, 300) });
  }
}
