// GET /api/cron/notify-waitlist — tell people a space opened near where they
// looked.
//
// parking_requests is the strongest demand signal ParkEasy has: somebody typed
// their email in because there was nothing to book where they were going. The
// table has existed since August and nothing has ever read it, so every one of
// those people is still waiting and does not know a space appeared.
//
// WHAT THIS DOES. For each listing that has gone active, find the unnotified
// requests within 800m of it, email them once, and stamp notified_at.
//
// 800m, matching the funnel's own reach: near enough that the walk is not the
// reason the email gets deleted.
//
// ONCE PER PERSON, EVER. notified_at is stamped whether or not the email
// succeeded, and that is deliberate: the alternative is a retry loop that mails
// somebody four times about the same car park, which loses the address for
// good. A failed send is logged loudly instead — one missed email is recoverable
// by hand, a reputation for spam is not.
//
// Protected by CRON_SECRET: an open endpoint that sends email is an open
// endpoint that sends spam.
import { bccFor } from '../_bcc.js';

const RADIUS_M = 800;
// A cap, so a first run against a year of backlog cannot turn into a thousand
// emails in one go. The rest go out on the next run.
const MAX_PER_RUN = 50;

const metres = (aLat, aLng, bLat, bLng) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secret || auth !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const KEYR = process.env.RESEND_API_KEY;
  const FROM = process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>';
  const APP = process.env.APP_URL || 'https://parkeasy.uk';
  if (!URL_ || !SERVICE) return res.status(500).json({ error: 'Supabase not configured' });

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  try {
    const [lr, rr] = await Promise.all([
      fetch(`${URL_}/rest/v1/rental_listings?status=eq.active&lat=not.is.null&select=id,title,address,lat,lng,price_per_hour,price_per_day`, { headers: svc }),
      fetch(`${URL_}/rest/v1/parking_requests?notified_at=is.null&lat=not.is.null&select=id,email,destination,lat,lng,wanted_on&limit=${MAX_PER_RUN * 4}`, { headers: svc }),
    ]);
    const listings = lr.ok ? await lr.json() : [];
    const requests = rr.ok ? await rr.json() : [];

    if (!listings.length || !requests.length) {
      return res.status(200).json({ ok: true, notified: 0, waiting: requests.length });
    }

    // Nearest live listing per request. Nearest, not cheapest: somebody asked
    // about a specific place.
    const matches = [];
    for (const req_ of requests) {
      let best = null;
      for (const l of listings) {
        const d = metres(req_.lat, req_.lng, l.lat, l.lng);
        if (d <= RADIUS_M && (!best || d < best.d)) best = { listing: l, d };
      }
      if (best) matches.push({ request: req_, ...best });
      if (matches.length >= MAX_PER_RUN) break;
    }

    if (!matches.length) return res.status(200).json({ ok: true, notified: 0, waiting: requests.length });

    let sent = 0, failed = 0;
    for (const m of matches) {
      const walk = Math.max(1, Math.round(m.d / 80));
      const price = Number(m.listing.price_per_day) > 0
        ? `£${Number(m.listing.price_per_day).toFixed(2)} a day`
        : Number(m.listing.price_per_hour) > 0
          ? `£${Number(m.listing.price_per_hour).toFixed(2)} an hour`
          : 'bookable now';

      if (KEYR && m.request.email) {
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${KEYR}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: FROM, to: [m.request.email], bcc: bccFor([m.request.email]),
              subject: `A space opened near ${m.request.destination || 'where you were looking'}`,
              html: `<p>You asked us to tell you when there was parking to book near
                       <strong>${String(m.request.destination || 'there').slice(0, 120)}</strong>.</p>
                     <p>There is now: <strong>${m.listing.title || 'a private space'}</strong>,
                        about a ${walk}-minute walk away, ${price}.</p>
                     <p><a href="${APP}">Book it on ParkEasy</a></p>
                     <p style="color:#666;font-size:12px">You are getting this once, because you asked.
                        We will not email you again about this.</p>`,
            }),
          });
          if (r.ok) sent++;
          else { failed++; console.error('waitlist email failed', r.status, await r.text().catch(() => '')); }
        } catch (e) { failed++; console.error('waitlist email failed', String(e)); }
      }

      // Stamped whether or not the send worked. A retry loop that mails
      // somebody four times about one car park loses the address for good.
      await fetch(`${URL_}/rest/v1/parking_requests?id=eq.${m.request.id}`, {
        method: 'PATCH', headers: svc,
        body: JSON.stringify({ notified_at: new Date().toISOString() }),
      }).catch(e => console.error('waitlist stamp failed', m.request.id, String(e)));
    }

    console.log(`notify-waitlist: ${sent} sent, ${failed} failed, ${matches.length} matched of ${requests.length} waiting`);
    return res.status(200).json({ ok: true, notified: sent, failed, matched: matches.length });
  } catch (e) {
    console.error('notify-waitlist failed', String(e));
    return res.status(500).json({ error: 'Sweep failed' });
  }
}
