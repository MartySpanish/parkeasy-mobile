// POST /api/ai/listing-copy — turn a host's rough notes into polished listing
// copy (title + description + how-to-find-it). One Claude API call, cheap
// model. Requires ANTHROPIC_API_KEY in the Vercel env; degrades gracefully
// with a clear error when unset. Auth required (hosts only, rate-limited by
// being signed in).
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

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const AI_KEY = process.env.ANTHROPIC_API_KEY;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!AI_KEY) return res.status(503).json({ error: 'AI writing isn’t set up yet (ANTHROPIC_API_KEY missing)' });
  if (!URL_ || !ANON) return res.status(500).json({ error: 'Not configured' });

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in first' });
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { spaceType = 'driveway', address = '', notes = '' } = body || {};

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You write listing copy for ParkEasy, a Northern Ireland parking marketplace. A host is listing a ${spaceType} at "${address}". Their rough notes: "${notes || '(none)'}".

Write warm, honest, local-sounding copy (no hype, no invented amenities). Return ONLY JSON:
{"title": "max 60 chars, specific", "description": "2-3 sentences a driver would trust", "instructions": "clear how-to-find-it directions a stranger could follow, min 30 chars — base only on the address/notes given, don't invent gate codes or features"}`,
        }],
      }),
    });
    if (!r.ok) return res.status(502).json({ error: 'AI request failed' });
    const d = await r.json();
    const text = d?.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: 'AI returned an unexpected format' });
    const out = JSON.parse(m[0]);
    return res.status(200).json({ title: String(out.title || ''), description: String(out.description || ''), instructions: String(out.instructions || '') });
  } catch (e) {
    console.error('ai/listing-copy', e);
    return res.status(500).json({ error: 'AI writing failed — try again' });
  }
}
