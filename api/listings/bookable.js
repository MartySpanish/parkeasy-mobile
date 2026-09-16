// GET /api/listings/bookable?listingId=… — can this space actually be booked?
//
// Asked when the booking panel opens, so the driver is told BEFORE they pick a
// date, type their registration and tap Pay. Until now the only thing that knew
// the answer was create-session, at the end of the flow, and its refusal
// arrived at the card step where the app read it as a card problem.
//
// WHAT IT DELIBERATELY DOES NOT RETURN. Nothing about the host: no name, no
// email, no Stripe account id, no onboarding state. The answer is a boolean and
// a reason code, and the reason codes are the ones already written to be shown
// to a driver. Anybody can call it with a listing id — which is public — and
// learn only whether that listing takes bookings, which is exactly what the
// booking screen tells them anyway.
import { payoutReadiness } from '../_payouts.js';

const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const listingId = String(req.query?.listingId || '').trim();
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' });

  // Unknown rather than "no". A deployment with no service key, or a database
  // that cannot be reached, must not turn every space on the map into one that
  // cannot be booked — the flow still works, it just refuses later as it did
  // before, with an honest message.
  if (!URL_ || !SERVICE) return res.status(200).json({ bookable: null, reason: 'unknown' });

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
  try {
    // select=* and not a named list. payout_mode and operator_share_pct belong
    // to a migration deliberately NOT applied to production yet, and PostgREST
    // 400s on a select that names a column the table does not have — so naming
    // them would make this endpoint fail everywhere the invoice model is not
    // live, which is everywhere. create-session reads the row the same way.
    const lr = await fetch(
      `${URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(listingId)}&select=*`,
      { headers: svc });
    const listing = lr.ok ? (await lr.json())?.[0] : null;
    if (!listing) return res.status(404).json({ bookable: false, reason: 'not_found' });
    if (listing.status !== 'active') {
      return res.status(200).json({ bookable: false, reason: 'not_active',
        message: 'This listing is not currently bookable.' });
    }

    const payouts = await payoutReadiness(listing, { url: URL_, svc });
    if (!payouts.ok) {
      return res.status(200).json({ bookable: false, reason: payouts.code, message: payouts.message });
    }
    return res.status(200).json({ bookable: true, reason: null });
  } catch {
    return res.status(200).json({ bookable: null, reason: 'unknown' });
  }
}
