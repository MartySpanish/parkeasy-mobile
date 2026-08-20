// POST /api/bookings/cancel — cancel a booking and refund per Terms §5.
//   • Host cancels                → full refund to the driver.
//   • Driver cancels ≥24h before  → full refund.
//   • Driver cancels <24h before  → 50% of the booking price.
//   • After start / no-show       → no refund.
// Refunds on a destination charge use reverse_transfer (claws the host's share
// back) + refund the application fee, so the accounting stays clean. On an
// invoice-mode booking there is neither, and the refund comes straight out of
// ParkEasy's balance — what the operator is owed is reduced by hand at
// settlement time. Amounts in integer pence.
import Stripe from 'stripe';
import { hostEmails } from '../_hostEmails.js';
import { bccFor } from '../_bcc.js';

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
function stripeAllowed(KEY) {
  if (!KEY) return false;
  return KEY.startsWith('sk_test_') || process.env.STRIPE_LIVE_ENABLED === 'true';
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.STRIPE_SECRET_KEY;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!KEY || !URL_ || !ANON || !SERVICE) return res.status(500).json({ error: 'Not configured' });
  if (!stripeAllowed(KEY)) return res.status(403).json({ error: 'Live Stripe key without STRIPE_LIVE_ENABLED — refusing.' });

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in to cancel a booking' });
  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const bookingId = body?.bookingId;
  if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  try {
    const br = await fetch(`${URL_}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}&select=*`, { headers: svc });
    const booking = (await br.json())?.[0];
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // The listing, purely so the cancellation email can reach the right people.
    // hostEmails() needs contact_email AND owner_email — the secretary and the
    // treasurer are different people at a club, and only one of them can see
    // Stripe. Fetched here rather than inside the notify block so a failure to
    // load it can never sit between the driver and their refund.
    let listing = null;
    try {
      const lr = await fetch(
        `${URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(booking.listing_id)}&select=title,contact_email,owner_email`,
        { headers: svc });
      if (lr.ok) listing = (await lr.json())?.[0] || null;
    } catch { /* the refund matters more than the email */ }

    const isDriver = booking.driver_id === caller.id;
    const isHost = booking.host_id === caller.id;
    if (!isDriver && !isHost) return res.status(403).json({ error: 'Not your booking' });
    if (booking.status !== 'paid') return res.status(400).json({ error: `Can't cancel a booking that is ${booking.status}` });

    // Refund policy (Terms §5): host cancel → full refund incl. service fee.
    // Driver cancel before the stored cancellation_deadline (default 24h,
    // CANCEL_CUTOFF_HOURS) → full booking price back, service fee non-refundable.
    // After the deadline (or no-show) → non-refundable: the slot was held and
    // the host still receives their share.
    const now = Date.now();
    const startMs = booking.starts_at ? Date.parse(booking.starts_at) : null;
    const cutoffHours = parseInt(process.env.CANCEL_CUTOFF_HOURS || '24', 10);
    const deadlineMs = booking.cancellation_deadline
      ? Date.parse(booking.cancellation_deadline)
      : (startMs != null ? startMs - cutoffHours * 3600000 : null);
    let refundPence = 0;
    if (isHost) refundPence = booking.amount_total_pence;
    // Space price AND any host surcharge. The surcharge (e.g. the overnight
    // lock-in fee) is only owed if the car is actually left in overnight — on a
    // cancellation the driver never turns up, so keeping it would be charging
    // them for a night they did not have. Only the service fee is retained.
    else if (deadlineMs != null && now <= deadlineMs) refundPence = (booking.booking_price_pence || 0) + (booking.surcharge_pence || 0);
    else refundPence = 0;

    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
    if (refundPence > 0 && booking.stripe_payment_intent) {
      // reverse_transfer and refund_application_fee only mean anything on a
      // DESTINATION charge — the money is sitting in the host's connected
      // account and has to be clawed back. An invoice-mode booking is a plain
      // charge into ParkEasy's own balance: there is no transfer and no
      // application fee, and Stripe rejects the call outright if you claim
      // there is. That rejection would throw here, before the row is updated,
      // so the driver would get no refund AND no cancellation.
      //
      // Keyed off stripe_destination rather than payout_mode because it is the
      // literal thing being reversed, and because it is correct for the
      // bookings taken before payout_mode existed.
      const destinationCharge = !!booking.stripe_destination;
      await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent,
        amount: refundPence,
        ...(destinationCharge ? { reverse_transfer: true, refund_application_fee: true } : {}),
      });
    }

    const refundStatus = refundPence === 0 ? 'denied_late' : refundPence >= booking.amount_total_pence ? 'refunded' : 'partial';
    await fetch(`${URL_}/rest/v1/bookings?id=eq.${booking.id}`, {
      method: 'PATCH', headers: svc,
      body: JSON.stringify({
        status: 'cancelled', cancelled_at: new Date().toISOString(),
        cancelled_by: isHost ? 'host' : 'driver', refund_pence: refundPence, refund_status: refundStatus,
        updated_at: new Date().toISOString(),
      }),
    });

    // ── TELL THE HOST ────────────────────────────────────────────────────
    // Until now a cancellation refunded the driver, updated the row and told
    // NOBODY. A club expecting four cars on Saturday had no way to learn that
    // two of them were no longer coming — and the whole reason Davitt Park's
    // gates were locked on 8 August is a host acting on information the app
    // had not given them. A booking appearing and a booking disappearing are
    // the same class of fact.
    //
    // Both addresses on the listing, same rule as a new booking: the secretary
    // takes the day-to-day and the treasurer reconciles the money, and only one
    // of them can see Stripe.
    //
    // Sent AFTER the refund and the status write, and never allowed to fail the
    // request — a driver whose refund succeeded must not see an error because
    // an email bounced.
    try {
      const KEY_R = process.env.RESEND_API_KEY;
      const TO_ADMIN = process.env.CONTACT_EMAIL;
      const FROM = process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>';
      if (KEY_R) {
        const when = booking.starts_at
          ? new Date(booking.starts_at).toLocaleString('en-GB',
              { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit', timeZone:'Europe/London' })
          : 'an unspecified time';
        const who = isHost ? 'the host' : 'the driver';
        const money = refundPence > 0
          ? `The driver has been refunded £${(refundPence / 100).toFixed(2)}.`
          : 'No refund was due — the cancellation was after the deadline, so your share is unchanged.';
        const subject = `Booking cancelled — ${listing?.title || 'your space'}, ${when}`;
        const html = `<div style="font-family:system-ui,sans-serif;max-width:520px">
          <h2 style="margin:0 0 12px">A booking has been cancelled</h2>
          <p style="margin:0 0 10px"><strong>${listing?.title || 'Your space'}</strong><br>${when}</p>
          <p style="margin:0 0 10px">Cancelled by ${who}. ${money}</p>
          ${booking.vehicle_reg ? `<p style="margin:0 0 10px">Vehicle: <strong>${booking.vehicle_reg}</strong> — this car is no longer expected.</p>` : ''}
          <p style="margin:16px 0 0;color:#555;font-size:13px">You don't need to do anything. This is just so the space isn't held for a car that isn't coming.</p>
        </div>`;
        const send = (to, subj, body, bcc) => fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${KEY_R}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: [to], bcc, subject: subj, html: body }),
        }).catch(() => {});

        const targets = hostEmails(listing);
        if (TO_ADMIN) targets.push(TO_ADMIN);
        const jobs = targets.map(to => send(to, subject, html));

        // ── AND TELL THE DRIVER ──────────────────────────────────────────
        // This whole block notified the host, the co-host and the admin, and
        // never the one person whose money had just moved. booking.driver_email
        // sat in the row the entire time — select=* — and was never read.
        //
        // The silence was worst in exactly the case that matters most. When a
        // HOST cancels, the driver has done nothing wrong, has already paid,
        // and finds out either from a Stripe line on their statement days later
        // or by driving to a space that is no longer theirs. That is the same
        // failure as the locked gates on 8 August, pointed the other way.
        //
        // Three outcomes, three different things to say, because "your booking
        // was cancelled" answers none of the questions a driver actually has:
        // was it me or them, am I getting my money back, and how much.
        const refundLine = (() => {
          const amt = `£${(refundPence / 100).toFixed(2)}`;
          if (isHost) {
            return `<p style="margin:0 0 10px">You have been refunded <strong>${amt}</strong> in full, including the booking fee. Refunds usually land back on your card within 5–10 working days.</p>`;
          }
          if (refundPence <= 0) {
            return `<p style="margin:0 0 10px">This cancellation was after the free-cancellation deadline, so <strong>no refund is due</strong> — the space had been held for you and the host still receives their share.</p>`;
          }
          if (refundPence >= booking.amount_total_pence) {
            return `<p style="margin:0 0 10px">You have been refunded <strong>${amt}</strong> in full. Refunds usually land back on your card within 5–10 working days.</p>`;
          }
          const fee = `£${((booking.amount_total_pence - refundPence) / 100).toFixed(2)}`;
          return `<p style="margin:0 0 10px">You have been refunded <strong>${amt}</strong> — the parking price in full. The ${fee} booking fee is non-refundable. Refunds usually land back on your card within 5–10 working days.</p>`;
        })();

        // The subject has to survive a lock screen. "Cancelled by the host" is
        // the fact that changes what the driver does next; their own
        // cancellation is something they already know about.
        const driverSubject = isHost
          ? `The host cancelled your parking — ${listing?.title || 'your space'}, ${when}`
          : `Your parking is cancelled — ${listing?.title || 'your space'}, ${when}`;

        const driverHtml = `<div style="font-family:system-ui,sans-serif;max-width:520px">
          <h2 style="margin:0 0 12px">${isHost ? 'Your booking was cancelled by the host' : 'Your booking is cancelled'}</h2>
          <p style="margin:0 0 10px"><strong>${listing?.title || 'Your space'}</strong><br>${when}</p>
          ${isHost ? '<p style="margin:0 0 10px">You do not need to do anything, and this is not your fault — the host has withdrawn the space.</p>' : ''}
          ${refundLine}
          ${booking.vehicle_reg ? `<p style="margin:0 0 10px">Vehicle: <strong>${booking.vehicle_reg}</strong></p>` : ''}
          ${isHost ? '<p style="margin:16px 0 0"><a href="https://parkeasy.uk" style="color:#0f766e;font-weight:bold">Find another space on ParkEasy →</a></p>' : ''}
          <p style="margin:16px 0 0;color:#555;font-size:13px">Any questions, just reply to this email.</p>
        </div>`;

        if (booking.driver_email) {
          jobs.push(send(booking.driver_email, driverSubject, driverHtml, bccFor(booking.driver_email)));
        }

        await Promise.all(jobs);
      }
    } catch (e) {
      // Logged, never surfaced. The cancellation itself already succeeded.
      console.error('bookings/cancel: host notification failed', e);
    }

    return res.status(200).json({ ok: true, refundPence, refundStatus });
  } catch (e) {
    console.error('bookings/cancel', e);
    return res.status(500).json({ error: e.message || 'Cancellation failed' });
  }
}
