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

// Shared requirement checker — mirrors the client checklist exactly.
export function listingRequirements(l) {
  const missing = [];
  const photos = l.photos || [];
  const minPhotos = l.host_type === 'organization' ? 5 : 3;
  if (photos.length < minPhotos) missing.push(`${minPhotos - photos.length} more photo${minPhotos - photos.length !== 1 ? 's' : ''} (min ${minPhotos})`);
  if (photos.length > 10) missing.push('Maximum 10 photos');
  if ((l.instructions || '').trim().length < 30) missing.push(`"How to find it" too short — ${(l.instructions || '').trim().length}/30 characters`);
  if (l.lat == null || l.lng == null) missing.push('Verified address (pick from the suggestions)');
  if (!(l.price_per_hour ?? l.price_per_day ?? l.price_per_month)) missing.push('A price');
  if (!l.availability) missing.push('Availability preset');
  if (!(l.contact_phone || '').trim()) missing.push('Host mobile number');
  const cap = l.spaces ?? 1;
  if (!(cap >= 1 && cap <= 200)) missing.push('Capacity between 1 and 200');
  if (l.space_type === 'ev_charger') {
    const a = l.amenities || [];
    if (!a.some(x => String(x).startsWith('speed:'))) missing.push('Charger speed');
    if (!a.some(x => String(x).startsWith('connector:'))) missing.push('Connector type');
  }
  if (l.host_type === 'organization') {
    if (!(l.org_name || '').trim()) missing.push('Organization legal name');
    if (!l.org_type) missing.push('Organization type');
    if (!(l.org_registration || '').trim()) missing.push('Registration number (or "none — explain")');
    if (!(l.access_contact_name || '').trim() || !(l.access_contact_phone || '').trim()) missing.push('Named access contact (name + mobile)');
    if ((l.access_method || '').trim().length < 30) missing.push(`Access method too short — ${(l.access_method || '').trim().length}/30 characters`);
  }
  return missing;
}

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
        html: `<p><strong>${l.org_name || l.title}</strong> (${l.org_type || 'organization'}) submitted a listing at ${l.address}.<br>Open the ParkEasy admin dashboard to approve or reject it.</p>`,
      }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, status: patch.status });
}
