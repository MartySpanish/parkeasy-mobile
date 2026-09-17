// GET/POST /api/bookings/respond — the host accepts or declines a request.
//
// A booking on a driveway is a REQUEST: the card was authorised at checkout and
// nothing has been taken. This endpoint is where that resolves.
//
//   accept  → capture the PaymentIntent. The application fee and the transfer
//             to the host happen at capture, so this is the first moment any
//             money moves.
//   decline → cancel the PaymentIntent. The hold comes off; there is no charge
//             to refund and no five-day wait for it to come back.
//
// AUTHENTICATED BY THE BOOKING'S OWN access_token, the same mechanism the
// cancellation page already uses. That is deliberate: the two buttons are in
// the host's email, and a host who has to find the app, log in and hunt for a
// queue is a host who answers tomorrow — by which time the authorisation has
// lapsed and the driver has parked somewhere else.
//
// The token is a uuid generated per booking, it is never rendered to the
// driver, and it grants exactly one power: answering this one request. It is
// not a session and it cannot read anything else.
//
// IDEMPOTENT. A host who taps Accept twice, or whose mail client prefetches the
// link, must not double-capture. The status check below is the guard: only a
// booking still in 'awaiting_host' is actionable, and the answer is recorded in
// the same PATCH that moves it out of that state.
import Stripe from 'stripe';

const ANSWERS = new Set(['accept', 'decline']);

// A plain HTML reply, because this is opened in a mail client's browser and
// there is no app around it to render JSON.
const page = (title, body, tone = '#2ED3C6') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — ParkEasy</title>
<style>
  body{margin:0;background:#0B1420;color:#EAF1F8;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{max-width:460px;background:#111C2B;border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:28px}
  h1{font-size:21px;margin:0 0 12px;color:${tone}}
  p{margin:0 0 12px;color:rgba(234,241,248,.78)}
  a{color:${tone}}
</style></head>
<body><div class="card"><h1>${title}</h1>${body}</div></body></html>`;

export default async function handler(req, res) {
  const KEY = process.env.STRIPE_SECRET_KEY;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const APP = process.env.APP_URL || 'https://parkeasy.uk';

  const send = (code, html) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Never cached: the answer changes the booking, and a cached "Accepted"
    // page shown after a later cancellation is a lie.
    res.setHeader('Cache-Control', 'no-store');
    res.status(code).send(html);
  };

  if (!KEY || !URL_ || !SERVICE) {
    return send(500, page('Not configured', '<p>This link cannot be processed right now. Please contact ParkEasy.</p>', '#ff9d9d'));
  }

  const q = req.query || {};
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const token = String(q.token || body.token || '');
  const answer = String(q.answer || body.answer || '').toLowerCase();
  const reason = String(q.reason || body.reason || '').slice(0, 300) || null;

  if (!token || !ANSWERS.has(answer)) {
    return send(400, page('Link not recognised', '<p>That link is incomplete. Open the email again and tap Accept or Decline.</p>', '#ff9d9d'));
  }

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  try {
    const br = await fetch(`${URL_}/rest/v1/bookings?access_token=eq.${encodeURIComponent(token)}&select=*`, { headers: svc });
    const booking = (await br.json())?.[0];
    if (!booking) {
      return send(404, page('Not found', '<p>We could not find that booking request.</p>', '#ff9d9d'));
    }

    // Already answered, or never a request in the first place. Reported plainly
    // rather than as an error: a host tapping the link a second time has done
    // nothing wrong and should be told what the booking says now.
    if (booking.status !== 'awaiting_host') {
      const said = {
        paid: 'You already accepted this one — it is confirmed.',
        declined: 'You already declined this request. Nothing was charged.',
        expired: 'This request lapsed before it was answered. Nothing was charged.',
        cancelled: 'This booking was cancelled.',
      }[booking.status] || `This request is no longer waiting (${booking.status}).`;
      return send(200, page('Already sorted', `<p>${said}</p><p><a href="${APP}">Open ParkEasy</a></p>`));
    }

    if (!booking.stripe_payment_intent) {
      return send(409, page('Nothing to charge', '<p>This request has no payment attached. Please contact ParkEasy.</p>', '#ff9d9d'));
    }

    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
    const now = new Date().toISOString();

    if (answer === 'accept') {
      // Capture first, then record. If capture fails nothing is written, so the
      // request stays answerable rather than showing as paid with no money.
      await stripe.paymentIntents.capture(booking.stripe_payment_intent);
      await fetch(`${URL_}/rest/v1/bookings?id=eq.${booking.id}`, {
        method: 'PATCH', headers: svc,
        body: JSON.stringify({ status: 'paid', host_responded_at: now, updated_at: now }),
      });
      return send(200, page('Accepted',
        `<p>The space is booked and the driver has been charged. They have your arrival
            instructions.</p><p><a href="${APP}">Open ParkEasy</a></p>`));
    }

    // Decline. Cancelling the PaymentIntent releases the authorisation; the
    // driver is never charged, so there is nothing to refund.
    await stripe.paymentIntents.cancel(booking.stripe_payment_intent).catch((e) => {
      // An already-cancelled intent is fine — the booking still needs recording.
      if (e?.code !== 'payment_intent_unexpected_state') throw e;
    });
    await fetch(`${URL_}/rest/v1/bookings?id=eq.${booking.id}`, {
      method: 'PATCH', headers: svc,
      body: JSON.stringify({ status: 'declined', host_responded_at: now, host_decline_reason: reason, updated_at: now }),
    });
    // A pass booking has no card to release — the money was taken when the pass
    // was bought. What has to come back is the CREDIT: a host saying no must not
    // cost the driver one of the ten they paid for.
    if (booking.pass_purchase_id) {
      await fetch(`${URL_}/rest/v1/rpc/restore_pass_credit`, {
        method: 'POST', headers: svc, body: JSON.stringify({ p_purchase: booking.pass_purchase_id }),
      }).catch(e => console.error('pass credit NOT restored on decline', booking.id, String(e)));
    }
    return send(200, page('Declined',
      `<p>Thanks for answering. The driver has been told and <strong>nothing was
          charged</strong> — the hold on their card is released.</p>
       <p><a href="${APP}">Open ParkEasy</a></p>`, '#FFD27A'));
  } catch (e) {
    console.error('booking respond failed', String(e));
    return send(500, page('Something went wrong',
      '<p>We could not record that just now. Nothing has been charged. Please try the link again.</p>', '#ff9d9d'));
  }
}
