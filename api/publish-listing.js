// Server-side publish gate for space listings. The UI checklist is advisory;
// THIS is the enforcement (plus DB CHECK constraints as the final backstop).
// Drafts can always be saved incomplete — publishing is what's gated.

const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// The gate itself lives in src/data/publishGateCore.js and is re-exported here.
//
// It used to live in this file, with a hand-kept twin in App.jsx — and that twin
// is how the last change to the rule quietly did nothing: this file lowered the
// bar for organisations and the form in front of the host went on demanding the
// old one, so the treasurer still could not submit. One copy now, imported by
// both, with a test that fails if a second one appears.
export { listingRequirements, approvalChecklist } from '../src/data/publishGateCore.js';
import { listingRequirements, approvalChecklist } from '../src/data/publishGateCore.js';

// Host-controlled text reaches an HTML email, so it is escaped. A listing
// title is whatever they typed.
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !ANON || !SERVICE) return res.status(500).json({ error: 'Backend not configured (SUPABASE_SERVICE_ROLE_KEY required)' });

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in to publish a listing' });
  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const id = body?.id;
  if (!id) return res.status(400).json({ error: 'Missing listing id' });

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
  const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(id)}&select=*`, { headers: svc });
  const rows = await lr.json();
  const l = rows?.[0];
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  if (l.owner_id !== caller.id) return res.status(403).json({ error: 'You can only publish your own listing' });

  const missing = listingRequirements(l);
  if (missing.length) return res.status(422).json({ error: 'Requirements not met', missing });

  // Residential → live immediately. Organization → founder approval queue.
  const isOrg = l.host_type === 'organization';
  const owed = approvalChecklist(l);
  const patch = isOrg && !l.approved_by_founder
    ? { status: 'pending_approval' }
    : { status: 'active', published_at: new Date().toISOString(), needs_update: false };

  const up = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { ...svc, Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  if (!up.ok) return res.status(502).json({ error: 'Update failed', detail: await up.text().catch(() => '') });

  // Nudge the founder inbox when an organization listing enters the queue
  if (isOrg && !l.approved_by_founder && process.env.RESEND_API_KEY && process.env.CONTACT_EMAIL) {
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>',
        to: [process.env.CONTACT_EMAIL],
        subject: `🏛️ Organization listing awaiting approval: ${l.title}`,
        // The checklist rides along, because these stopped being publish
        // blockers and would otherwise quietly stop being asked for at all.
        // They are now a phone call rather than a form field, which is both a
        // better way to get them and the moment to explain why they matter.
        html: `<p><strong>${esc(l.org_name || l.title)}</strong> (${esc(l.org_type || 'organization')}) `
          + `submitted a listing at ${esc(l.address)}.<br>Open the ParkEasy admin dashboard to approve or reject it.</p>`
          + (owed.length
            ? `<p><strong>Still to ask them for:</strong></p><ul>${owed.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
              + `<p>These are no longer blocking publication — the listing is in the queue, not live.</p>`
            : `<p>Nothing outstanding — they filled in everything.</p>`),
      }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, status: patch.status });
}
