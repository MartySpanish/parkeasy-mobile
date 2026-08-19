// In-app messaging between a driver and a host about a booking — for the
// "can't find the entrance" moment — WITHOUT either side seeing the other's
// phone number or email. The server relays a notification; replies come back
// in-app, so contact details are never exchanged.
//
//   GET  /api/messages?bookingId=…            → the thread (both parties)
//   POST /api/messages { bookingId, body }    → send, notifies the other party
//
// The bcc below does NOT weaken that promise: it is blind, so neither party
// sees a third address, and neither of them learns anything about the other.
// It does mean Marty can read the thread, which is a different thing and a
// deliberate one — an unanswered "which gate do I use?" is a driver standing
// at a locked barrier, and he can only step in if he knows it was asked.
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

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !ANON || !SERVICE) return res.status(500).json({ error: 'Not configured' });

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in first' });
  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
  const bookingId = String(req.query.bookingId || (typeof req.body === 'object' ? req.body?.bookingId : '') || '').trim();
  if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

  // Caller must be a party to this booking.
  const br = await fetch(`${URL_}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}&select=id,host_id,driver_id,driver_email,listing_id,starts_at`, { headers: svc });
  const b = (await br.json())?.[0];
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  const role = b.driver_id === caller.id ? 'driver' : b.host_id === caller.id ? 'host' : null;
  if (!role) return res.status(403).json({ error: 'Not your booking' });

  if (req.method === 'GET') {
    const mr = await fetch(`${URL_}/rest/v1/booking_messages?booking_id=eq.${bookingId}&select=id,sender_role,body,created_at&order=created_at`, { headers: svc });
    return res.status(200).json({ messages: mr.ok ? await mr.json() : [], role });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = String(body?.body || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'Write a message first' });

  const ins = await fetch(`${URL_}/rest/v1/booking_messages`, {
    method: 'POST', headers: { ...svc, Prefer: 'return=representation' },
    body: JSON.stringify({ booking_id: b.id, sender_id: caller.id, sender_role: role, body: text }),
  });
  if (!ins.ok) return res.status(502).json({ error: 'Could not send your message' });

  // Notify the other party by email — WITHOUT revealing the sender's address.
  // Reply-to is deliberately omitted; they reply in the app.
  try {
    const KEYR = process.env.RESEND_API_KEY;
    const FROM = process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>';
    if (KEYR) {
      let toEmail = null;
      if (role === 'driver') {
        const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${b.listing_id}&select=contact_email`, { headers: svc });
        toEmail = (await lr.json())?.[0]?.contact_email || null;
      } else {
        toEmail = b.driver_email || null;
      }
      if (toEmail) {
        const who = role === 'driver' ? 'the driver' : 'the host';
        await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${KEYR}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM, to: [toEmail], bcc: bccFor([toEmail]),
            subject: `💬 Message about your ParkEasy booking`,
            html: `<p>You have a new message from ${who} about your booking:</p>
                   <blockquote style="border-left:3px solid #2ED3C6;padding-left:12px;margin:12px 0;color:#334155">${text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])).replace(/\n/g, '<br>')}</blockquote>
                   <p style="font-size:13px;color:#64748b">Reply in the app — open <a href="https://parkeasy.uk">parkeasy.uk</a> and go to your bookings. Your contact details are never shared.</p>`,
          }),
        }).catch(() => {});
      }
    }
  } catch { /* notification is best-effort; the message is already saved */ }

  return res.status(200).json({ ok: true });
}
