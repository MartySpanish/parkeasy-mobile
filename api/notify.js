// Transactional email notifications (contact/feedback, new signup, new space
// listed, rental enquiries). Runs as a Vercel serverless function.
//
// Sends via Resend (https://resend.com) — cleaner than Gmail SMTP on a
// Vercel/Supabase stack, no ~500/day cap, better deliverability.
//
// Required env vars (set in the Vercel project, NOT prefixed with VITE_ so they
// stay server-side and never reach the browser bundle):
//   CONTACT_EMAIL   – where notifications are delivered (e.g. parkeasyuk@gmail.com)
//   RESEND_API_KEY  – your Resend API key
//   EMAIL_FROM      – optional verified sender, e.g. "ParkEasy <noreply@parkeasy.uk>"
//                     (defaults to Resend's shared onboarding sender for testing)

const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

const TEMPLATES = {
  contact:  (d) => ({ subject: `📬 ParkEasy feedback from ${d.name || 'a visitor'}`,
    rows: [['Name', d.name], ['Email', d.email], ['Message', d.message]] }),
  signup:   (d) => ({ subject: `🅿️ New ParkEasy member: ${d.name || d.email || 'someone'}`,
    rows: [['Name', d.name], ['Email', d.email]] }),
  listing:  (d) => ({ subject: `🏠 New space listed: ${d.title || 'untitled'}`,
    rows: [['Title', d.title], ['Address', d.address], ['Type', d.spaceType], ['Price', d.price], ['Listed by', d.email]] }),
  enquiry:  (d) => ({ subject: `💬 Enquiry about: ${d.title || 'a space'}`,
    rows: [['Space', d.title], ['Address', d.address], ['Owner contact', d.ownerEmail]] }),
  business: (d) => ({ subject: `🏪 New business listing enquiry: ${d.name || ''}`,
    rows: [['Business', d.name], ['Email', d.email], ['Message', d.message]] }),
  spot:     (d) => ({ subject: `🅿️ New spot submitted: ${d.name || ''}`,
    rows: [['Spot', d.name], ['Near', d.near], ['Notes', d.message], ['By', d.email]] }),
};


// CORS: the static site on parkeasy.uk (GitHub Pages) calls these functions
// cross-origin on the Vercel deployment.
const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const TO = process.env.CONTACT_EMAIL;
  const KEY = process.env.RESEND_API_KEY;
  const FROM = process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>';
  if (!TO || !KEY) return res.status(500).json({ error: 'Email not configured (set CONTACT_EMAIL and RESEND_API_KEY)' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { type = 'contact', photoData, ...data } = body || {};
  const tpl = (TEMPLATES[type] || TEMPLATES.contact)(data);

  const rowsHtml = tpl.rows
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `<tr><td style="padding:6px 12px;color:#64748b;font-weight:600;vertical-align:top">${esc(k)}</td><td style="padding:6px 12px;color:#0f172a">${esc(v).replace(/\n/g, '<br>')}</td></tr>`)
    .join('');
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
    <h2 style="color:#0f172a;margin:0 0 4px">${esc(tpl.subject)}</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 16px">ParkEasy · ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}</p>
    <table style="border-collapse:collapse;width:100%;background:#f8fafc;border-radius:10px">${rowsHtml}</table>
  </div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: [TO], subject: tpl.subject, html, reply_to: data.email || undefined,
        // Spot-verification photo (compressed client-side) rides along as an attachment
        attachments: (typeof photoData === 'string' && photoData.startsWith('data:image/') && photoData.length < 900000)
          ? [{ filename: 'spot-photo.jpg', content: photoData.split(',')[1] }]
          : undefined,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return res.status(502).json({ error: 'Email provider error', detail });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'send failed' });
  }
}
