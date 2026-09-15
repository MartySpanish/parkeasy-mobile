// GET /api/cron/expire-approvals — release the hold on requests nobody answered.
//
// A booking on a driveway sits in 'awaiting_host' with the driver's card
// AUTHORISED but not charged. If the host never answers, two things have to
// happen and neither can wait for someone to notice:
//
//   1. The authorisation is cancelled, so the hold comes off the driver's card
//      rather than sitting there until Stripe expires it a week later. A driver
//      who was never given a space and still has £8 pending is the version of
//      this feature that produces a chargeback.
//   2. The booking is marked 'expired', so it stops appearing as a live request
//      in the host's queue and the driver's screen stops saying "waiting".
//
// HOURLY, not daily. approval_deadline is the sooner of 24 hours and the start
// time, so a request made for a slot in three hours can lapse three hours from
// now — a daily sweep would leave that driver waiting most of a day for an
// answer that was never coming.
//
// Protected by CRON_SECRET, same as the other cron: an open endpoint that
// cancels payments is an open endpoint somebody else can cancel payments with.
import Stripe from 'stripe';

// Never touch more than this in one run. A runaway loop here cancels real
// authorisations, so it fails safe by doing less and running again next hour.
const MAX_PER_RUN = 100;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secret || auth !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const KEY = process.env.STRIPE_SECRET_KEY;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !SERVICE) return res.status(500).json({ error: 'Supabase not configured' });

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
  const nowIso = new Date().toISOString();

  try {
    // "Still waiting, and past its deadline." Both halves matter: dropping the
    // status filter would cancel bookings the host already accepted, and
    // dropping the deadline filter would cancel requests they still have time
    // to answer.
    const q = `${URL_}/rest/v1/bookings`
      + `?status=eq.awaiting_host&approval_deadline=lt.${encodeURIComponent(nowIso)}`
      + `&select=id,stripe_payment_intent,driver_email,pass_purchase_id&limit=${MAX_PER_RUN}`;
    const r = await fetch(q, { headers: svc });
    if (!r.ok) throw new Error(`lookup failed: ${r.status}`);
    const due = await r.json();

    if (!due.length) return res.status(200).json({ ok: true, expired: 0 });

    const stripe = KEY ? new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 }) : null;
    let released = 0, failed = 0;

    for (const b of due) {
      // Cancel the authorisation FIRST. If that fails the row is left alone so
      // the next run tries again — marking it expired while the hold is still
      // on the driver's card is the one outcome worth avoiding here.
      if (b.stripe_payment_intent && stripe) {
        try {
          await stripe.paymentIntents.cancel(b.stripe_payment_intent);
        } catch (e) {
          // Already cancelled or already captured: nothing left to release, so
          // the row can still be settled. Anything else is a real failure.
          if (e?.code !== 'payment_intent_unexpected_state') {
            console.error('expire-approvals: cancel failed', b.id, String(e));
            failed++;
            continue;
          }
        }
      }
      // Same as a decline: a pass booking has no authorisation to release, but
      // the credit must come back. A host who never answered must not cost the
      // driver one of the credits they paid for.
      if (b.pass_purchase_id) {
        await fetch(`${URL_}/rest/v1/rpc/restore_pass_credit`, {
          method: 'POST', headers: svc, body: JSON.stringify({ p_purchase: b.pass_purchase_id }),
        }).catch(e => console.error('pass credit NOT restored on expiry', b.id, String(e)));
      }
      const patch = await fetch(`${URL_}/rest/v1/bookings?id=eq.${b.id}`, {
        method: 'PATCH', headers: svc,
        body: JSON.stringify({ status: 'expired', updated_at: new Date().toISOString() }),
      });
      if (patch.ok) released++;
      else { failed++; console.error('expire-approvals: patch failed', b.id, patch.status); }
    }

    console.log(`expire-approvals: ${released} released, ${failed} failed, ${due.length} due`);
    return res.status(200).json({ ok: true, expired: released, failed, due: due.length });
  } catch (e) {
    console.error('expire-approvals failed', String(e));
    return res.status(500).json({ error: 'Sweep failed' });
  }
}
