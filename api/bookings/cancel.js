// POST /api/bookings/cancel — cancel a booking and refund per Terms §5.
//   • Host cancels                → full refund to the driver.
//   • Driver cancels ≥24h before  → full refund.
//   • Driver cancels <24h before  → 50% of the booking price.
//   • After start / no-show       → no refund.
// Refunds use reverse_transfer (claws the host's share back) + refund the
// application fee, so the accounting stays clean. Amounts in integer pence.
import Stripe from 'stripe';

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

    const isDriver = booking.driver_id === caller.id;
    const isHost = booking.host_id === caller.id;
    if (!isDriver && !isHost) return res.status(403).json({ error: 'Not your booking' });
    if (booking.status !== 'paid') return res.status(400).json({ error: `Can't cancel a booking that is ${booking.status}` });

    // Refund policy.
    const startMs = booking.starts_at ? Date.parse(booking.starts_at) : null;
    const hoursToStart = startMs != null ? (startMs - Date.now()) / 3600000 : 0;
    let refundPence = 0;
    if (isHost) refundPence = booking.amount_total_pence;               // host cancels → full refund
    else if (hoursToStart >= 24) refundPence = booking.amount_total_pence; // driver ≥24h → full refund
    else if (hoursToStart > 0) refundPence = Math.round(booking.booking_price_pence * 0.5); // <24h → 50% of parking
    else refundPence = 0;                                               // started / no-show → none

    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
    if (refundPence > 0 && booking.stripe_payment_intent) {
      await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent,
        amount: refundPence,
        reverse_transfer: true,
        refund_application_fee: true,
      });
    }

    const refundStatus = refundPence === 0 ? 'none' : refundPence >= booking.amount_total_pence ? 'refunded' : 'partial';
    await fetch(`${URL_}/rest/v1/bookings?id=eq.${booking.id}`, {
      method: 'PATCH', headers: svc,
      body: JSON.stringify({
        status: 'cancelled', cancelled_at: new Date().toISOString(),
        cancelled_by: isHost ? 'host' : 'driver', refund_pence: refundPence, refund_status: refundStatus,
        updated_at: new Date().toISOString(),
      }),
    });

    return res.status(200).json({ ok: true, refundPence, refundStatus });
  } catch (e) {
    console.error('bookings/cancel', e);
    return res.status(500).json({ error: e.message || 'Cancellation failed' });
  }
}
