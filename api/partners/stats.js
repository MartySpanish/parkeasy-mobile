// GET /api/partners/stats?token=… — a partner's own numbers, on a page you can
// text them.
//
// The audience is a barber with a phone, on a Tuesday, being asked to keep
// paying £25 a month. Making him create an account to see his own figures is
// how that conversation stops, so this is a link and nothing else: no login, no
// app, no cookie.
//
// THE TOKEN IS THE CREDENTIAL, and it is deliberately narrow. It comes from
// partners.stats_token, is unique per partner, and reaches exactly one
// function — partner_stats_for_token — which returns a name and two counts for
// the partner it belongs to. There is no argument through which it could be
// made to return anybody else's, and it grants nothing else in the database.
// If one leaks, rotate that partner's token; nothing else is exposed.
//
// Rendered server-side as plain HTML because it is opened from a text message,
// often on a slow connection, and there is no reason for it to be an app.
const DAYS = 30;

const page = (body, title = 'Your ParkEasy numbers') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;background:#0B1420;color:#EAF1F8;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{max-width:460px;width:100%;background:#111C2B;border:1px solid rgba(255,255,255,.1);
        border-radius:22px;padding:28px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:rgba(234,241,248,.5);font-size:13px;margin:0 0 22px}
  .row{display:flex;gap:12px;margin-bottom:18px}
  .stat{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
        border-radius:16px;padding:16px;text-align:center}
  .n{font-size:30px;font-weight:800;line-height:1;color:#5BE7DA}
  .n.alt{color:#C9A7FF}
  .l{font-size:11px;color:#6b7d96;margin-top:6px;font-weight:600}
  p{color:rgba(234,241,248,.7);font-size:14px}
  a{color:#5BE7DA}
</style></head>
<body><div class="card">${body}</div></body></html>`;

export default async function handler(req, res) {
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Counts move; a cached page showing last week's numbers during a renewal
  // conversation is worse than a slow one.
  res.setHeader('Cache-Control', 'no-store');

  const token = String(req.query?.token || '');
  // Checked here so a malformed token is a clean "not recognised" rather than a
  // 400 from PostgREST about a uuid cast.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return res.status(400).send(page('<h1>Link not recognised</h1><p>Ask ParkEasy for a fresh link.</p>'));
  }
  if (!URL_ || !ANON) {
    return res.status(500).send(page('<h1>Not available</h1><p>Please try again shortly.</p>'));
  }

  try {
    const r = await fetch(`${URL_}/rest/v1/rpc/partner_stats_for_token`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token, p_days: DAYS }),
    });
    const data = r.ok ? await r.json() : null;
    if (!data?.name) {
      return res.status(404).send(page('<h1>Link not recognised</h1><p>Ask ParkEasy for a fresh link.</p>'));
    }

    const impressions = Number(data.impressions) || 0;
    const clicks = Number(data.clicks) || 0;
    const ctr = impressions > 0 ? `${((clicks / impressions) * 100).toFixed(1)}%` : '—';
    // Escaped: the name is data from the database, and the page is HTML.
    const name = String(data.name).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    return res.status(200).send(page(`
      <h1>${name} on ParkEasy</h1>
      <p class="sub">Last ${DAYS} days</p>
      <div class="row">
        <div class="stat"><div class="n">${impressions.toLocaleString('en-GB')}</div><div class="l">TIMES SHOWN</div></div>
        <div class="stat"><div class="n alt">${clicks.toLocaleString('en-GB')}</div><div class="l">TAPPED THROUGH</div></div>
        <div class="stat"><div class="n">${ctr}</div><div class="l">CLICK RATE</div></div>
      </div>
      <p>Your card appears to drivers parking near you — on the space they book
         and on the map around it.</p>
      <p style="font-size:12.5px;color:rgba(234,241,248,.45)">
         Numbers update live. <a href="https://parkeasy.uk">parkeasy.uk</a></p>
    `, `${name} — ParkEasy`));
  } catch (e) {
    console.error('partner stats page failed', String(e));
    return res.status(500).send(page('<h1>Not available</h1><p>Please try again shortly.</p>'));
  }
}
