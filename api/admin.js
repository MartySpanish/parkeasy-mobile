// Master-account analytics endpoint.
//
// Security model: the caller must be logged in via Supabase; we verify their
// JWT server-side and only proceed when their email is on the admin list.
// User counts come from the Supabase Admin API using the SERVICE ROLE key,
// which lives only in Vercel env vars — never in the client bundle.
//
// Required Vercel env:
//   SUPABASE_SERVICE_ROLE_KEY  – Supabase → Settings → API → service_role
// Optional:
//   ADMIN_EMAILS               – comma-separated master emails
//   (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are reused from the app.)

import { hostEmails } from './_hostEmails.js';
import { bccFor } from './_bcc.js';

const DEFAULT_ADMINS = 'martinrooney3@hotmail.com,parkeasyuk@gmail.com';


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
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMINS = (process.env.ADMIN_EMAILS || DEFAULT_ADMINS).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

  if (!URL_ || !ANON) return res.status(500).json({ error: 'Supabase not configured' });

  // 1) Verify the caller's own session token
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Not signed in' });
  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }
  if (!ADMINS.includes((caller.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Not an admin account' });
  }

  // Config health (booleans / masked values only — never leak secrets). Lets the
  // dashboard show exactly which env vars are missing and why email/analytics
  // aren't working.
  const env = {
    contactEmail: !!process.env.CONTACT_EMAIL,
    contactEmailMasked: process.env.CONTACT_EMAIL
      ? process.env.CONTACT_EMAIL.replace(/^(.).*(@.*)$/, '$1•••$2') : null,
    resendKey: !!process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM || 'onboarding@resend.dev (Resend test sender)',
    emailFromCustom: !!process.env.EMAIL_FROM,
    serviceKey: !!SERVICE,
  };

  // ── Live test email: sends to CONTACT_EMAIL and returns the REAL Resend
  // result, so the admin sees the actual delivery error (test-mode restriction,
  // unverified domain, bad key, …) instead of the app's silent failure. ──
  if (req.method === 'POST') {
    let peek = req.body;
    if (typeof peek === 'string') { try { peek = JSON.parse(peek); } catch { peek = {}; } }
    if (peek?.action === 'test-email') {
      const TO = process.env.CONTACT_EMAIL;
      const KEY = process.env.RESEND_API_KEY;
      const FROM = process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>';
      if (!TO) return res.status(200).json({ ok: false, stage: 'config', error: 'CONTACT_EMAIL is not set in Vercel — the app has nowhere to send notifications.' });
      if (!KEY) return res.status(200).json({ ok: false, stage: 'config', error: 'RESEND_API_KEY is not set in Vercel — the app cannot send any email.' });
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM, to: [TO],
            subject: '✅ ParkEasy test email — notifications are working',
            html: `<p>This diagnostic email was sent from your ParkEasy admin dashboard.</p><p>If you can read this, signup and listing notifications will arrive at <strong>${TO}</strong>.</p>`,
          }),
        });
        const detail = await r.text().catch(() => '');
        if (!r.ok) return res.status(200).json({ ok: false, stage: 'resend', httpStatus: r.status, error: detail || 'Resend rejected the request.', to: env.contactEmailMasked, from: FROM });
        return res.status(200).json({ ok: true, to: env.contactEmailMasked, from: FROM });
      } catch (e) {
        return res.status(200).json({ ok: false, stage: 'network', error: e.message || 'send failed' });
      }
    }
  }

  if (!SERVICE) {
    return res.status(200).json({ ok: true, configured: false, env,
      hint: 'Add SUPABASE_SERVICE_ROLE_KEY to Vercel env to unlock user analytics.' });
  }

  const svcH = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  // ── Founder action: grant Premium to any account by email (support tool —
  // e.g. Stripe buyers from before purchases were account-linked). Writes a
  // promo_redemptions entitlement; the user's next signed-in app open syncs it.
  if (req.method === 'POST') {
    let peek2 = req.body;
    if (typeof peek2 === 'string') { try { peek2 = JSON.parse(peek2); } catch { peek2 = {}; } }
    if (peek2?.action === 'grant-premium') {
      const email = String(peek2.email || '').trim().toLowerCase();
      const days = Math.max(1, Math.min(3660, parseInt(peek2.days || 366, 10)));
      if (!email) return res.status(400).json({ error: 'Email required' });
      let userId = null;
      for (let page = 1; page <= 5 && !userId; page++) {
        const r = await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: svcH });
        if (!r.ok) break;
        const d = await r.json();
        const batch = d.users || d || [];
        userId = batch.find(u => (u.email || '').toLowerCase() === email)?.id || null;
        if (batch.length < 200) break;
      }
      if (!userId) return res.status(404).json({ error: `No account found for ${email}` });
      const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      const w = await fetch(`${URL_}/rest/v1/promo_redemptions?on_conflict=user_id,code`, {
        method: 'POST', headers: { ...svcH, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: userId, user_email: email, code: 'STRIPE-SUB', expires_at: expiresAt }),
      });
      if (!w.ok) return res.status(502).json({ error: 'Grant failed', detail: await w.text().catch(() => '') });
      return res.status(200).json({ ok: true, email, days, expiresAt });
    }
  }

  // ── Founder action: apply the pending partner rows ────────────────────────
  //
  // WHY THIS EXISTS. Partner rows are written by hand through the Supabase
  // connector, and the connector is regularly unavailable — bookableSpaces.js
  // says as much, and it has now cost real time twice in one day: Tara Lodge
  // agreed a partnership on 12 August and Jack Daniels' gym has had its map
  // switched off since morning, both waiting on a connection rather than on a
  // decision. Sitting on a signed partner because a tool is offline is the
  // wrong failure. This is the same three writes, through a route that is
  // always up.
  //
  // DELIBERATELY NOT A SQL RUNNER. It executes one fixed, reviewed set of
  // writes, not whatever it is handed — an admin-authenticated "run this SQL"
  // endpoint on a public deployment is a much bigger thing to own than the
  // problem it would solve. Every value below is the one committed in
  // supabase/migrations/, and the reasoning for each lives there.
  //
  // Idempotent: the insert merges on slug, the updates match on slug. Running
  // it twice changes nothing the second time.
  if (req.method === 'POST') {
    let p = req.body;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
    if (p?.action === 'sync-partners') {
      const steps = [];
      const run = async (label, url, method, payload, extraHeaders) => {
        try {
          const r = await fetch(url, {
            method, headers: { ...svcH, ...(extraHeaders || {}) },
            body: payload ? JSON.stringify(payload) : undefined,
          });
          const text = await r.text().catch(() => '');
          steps.push({ step: label, ok: r.ok, status: r.status, ...(r.ok ? {} : { error: text.slice(0, 400) }) });
          return r.ok;
        } catch (e) {
          steps.push({ step: label, ok: false, error: e.message || 'request failed' });
          return false;
        }
      };

      // 1. Tara Lodge — 20260817_tara_lodge.sql, already carrying the verified
      //    pin from 20260817_tara_lodge_pin.sql rather than the placeholder.
      //    One write instead of two; identical end state.
      await run('tara-lodge', `${URL_}/rest/v1/partners?on_conflict=slug`, 'POST', {
        slug: 'tara-lodge',
        name: 'Tara Lodge',
        tagline: '4-star boutique hotel in the Queen’s Quarter — and one of the few places in central Belfast with free, secure parking of its own.',
        description: 'A 34-room boutique hotel on a quiet residential street off Botanic Avenue, five minutes from Queen’s University and the Ulster Museum and about fifteen minutes’ walk from the city centre.\n\n'
          + 'The part that matters if you are driving: Tara Lodge has its own free, secure on-site car park, which almost nothing else this close to the middle of Belfast can say. Guests are not paying for parking and not circling for it. Breakfast is à la carte and made to order, and the WiFi is free throughout.\n\n'
          + 'Visiting rather than staying? Cromwell Road sits in the middle of the Botanic and Queen’s parking that ParkEasy already maps — free evening and weekend kerbside on the side streets, and the University Road bays after 6pm.',
        logo_url: null,
        photo_url: 'https://parkeasy.uk/taralodge/1-exterior.jpg',
        photo_urls: ['https://parkeasy.uk/taralodge/1-exterior.jpg',
                     'https://parkeasy.uk/taralodge/2-reception.jpg'],
        link_url: 'https://www.taralodge.com/',
        links: [{ label: 'Book a room at Tara Lodge', url: 'https://www.taralodge.com/' }],
        is_online: false,
        address: '36 Cromwell Road, Belfast',
        postcode: 'BT7 1JW',
        // OSNI Irish Grid E333754 N373031 for BT7 1JW, converted offline and
        // confirmed against the published decimal centroid for the same
        // postcode. Postcode centroid, not the door — tens of metres, on a
        // 700m radius. See 20260817_tara_lodge_pin.sql.
        lat: 54.587835, lng: -5.931730, geo_verified: true,
        radius_m: 700,
        // NO PRIORITY HERE, ON PURPOSE.
        //
        // This is an upsert with Prefer: resolution=merge-duplicates, so every
        // field in this payload overwrites the live row. Priority used to be
        // in it, hardcoded at 4, and that is exactly how she was silently
        // demoted below Sandy after the order had been set in SQL — the home
        // page featured the wrong business and nothing errored.
        //
        // Ordering is a commercial decision that changes often; getting rows
        // INTO the database is what this button is for. Two different jobs, so
        // two different places. Partner order now lives only in the database
        // and in supabase/migrations/*, and this button can never revert it
        // again. A brand-new partner lands on the column default and gets
        // ranked deliberately afterwards, which is the right way round.
        active: true,
      }, { Prefer: 'resolution=merge-duplicates' });

      // 2. Jack Daniels Fitness — 20260817_jack_daniels_pin.sql. Conway Mill,
      //    from Apple Maps' own place card for Atlas Gym Belfast.
      await run('jack-daniels-fitness', `${URL_}/rest/v1/partners?slug=eq.jack-daniels-fitness`, 'PATCH', {
        lat: 54.599499, lng: -5.951222, geo_verified: true,
        address: '3rd Floor, Conway Mill, 5-7 Conway Street, Belfast',
        postcode: 'BT13 2DE',
      });

      // 3. Read back what is actually in the table, so the dashboard reports
      //    the database's answer rather than this function's optimism.
      let partners = null;
      try {
        const r = await fetch(`${URL_}/rest/v1/partners?select=slug,name,priority,geo_verified,active,lat,lng&order=priority.desc`, { headers: svcH });
        if (r.ok) partners = await r.json();
      } catch { /* reported as null below */ }

      const failed = steps.filter(s => !s.ok);
      return res.status(200).json({
        ok: failed.length === 0,
        steps,
        partners,
        // The one failure this cannot fix itself: PostgREST cannot add a
        // column, so if 20260817_partners_geo_verified.sql never ran, both
        // writes above fail on an unknown column and the fix is that file.
        ...(failed.some(s => /geo_verified/.test(s.error || ''))
          ? { hint: 'partners.geo_verified is missing — run supabase/migrations/20260817_partners_geo_verified.sql first.' }
          : {}),
      });
    }
  }

  // ── Founder actions: approve / reject organization listings ──
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const { action, id, reason, kind } = body || {};
    if (!id || !['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Bad request' });
    if (action === 'reject' && !(reason || '').trim()) return res.status(400).json({ error: 'Rejection requires a reason' });

    // ── Community spot submissions ──
    // Approving is what makes a submitted spot public: spots_public selects
    // only status='approved'. Kept service-role-only and deliberately given no
    // update policy for authenticated users, so a submitter can never approve
    // their own spot — which is the whole point of the review step.
    if (kind === 'spot') {
      const sr = await fetch(`${URL_}/rest/v1/spot_submissions?id=eq.${encodeURIComponent(id)}&select=*`, { headers: svcH });
      const sub = (await sr.json())?.[0];
      if (!sub) return res.status(404).json({ error: 'Submission not found' });
      if (action === 'approve' && (sub.lat == null || sub.lng == null)) {
        return res.status(400).json({ error: 'This submission has no location, so it cannot go on the map. Reject it and ask them to resubmit with location on.' });
      }

      const patch = action === 'approve'
        ? { status: 'approved', reviewed_at: new Date().toISOString(), review_note: null }
        : { status: 'rejected', reviewed_at: new Date().toISOString(), review_note: reason.trim() };
      const up = await fetch(`${URL_}/rest/v1/spot_submissions?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: svcH, body: JSON.stringify(patch),
      });
      if (!up.ok) return res.status(502).json({ error: 'Update failed', detail: await up.text().catch(() => '') });

      if (sub.submitter_email && process.env.RESEND_API_KEY) {
        const place = sub.street || sub.near || 'your spot';
        const subj = action === 'approve'
          ? `✅ Your ParkEasy spot is live — ${place}`
          : `About the spot you sent us — ${place}`;
        const html = action === 'approve'
          ? `<p>Thanks for adding <strong>${String(place).replace(/</g, '&lt;')}</strong> to ParkEasy — it's been checked and it's now on the map for every driver in Northern Ireland.</p><p>That's one more space someone won't circle the block looking for. <a href="https://parkeasy.uk">See it on the map →</a></p>`
          : `<p>Thanks for sending us <strong>${String(place).replace(/</g, '&lt;')}</strong>. We haven't put this one on the map:</p><blockquote style="border-left:3px solid #2ED3C6;padding-left:12px;margin:12px 0;color:#334155">${(reason || '').replace(/</g, '&lt;')}</blockquote><p>If we've got that wrong, just reply and tell us — and please do keep sending spots.</p>`;
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>', to: [sub.submitter_email], bcc: bccFor([sub.submitter_email]), subject: subj, html }),
        }).catch(() => {});
      }
      return res.status(200).json({ ok: true, status: patch.status });
    }

    const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(id)}&select=*`, { headers: svcH });
    const listing = (await lr.json())?.[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const patch = action === 'approve'
      ? { approved_by_founder: true, status: 'active', published_at: new Date().toISOString(), rejection_reason: null }
      : { status: 'rejected', rejection_reason: reason.trim() };
    const up = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: svcH, body: JSON.stringify(patch),
    });
    if (!up.ok) return res.status(502).json({ error: 'Update failed', detail: await up.text().catch(() => '') });

    // Tell the host by email (approval or rejection with reason).
    // Both addresses, not a fallback: "your car park is now live and can take
    // money" is exactly the thing the person who owns the payout account needs
    // to know, and at a club that is not the same person as the contact.
    const hostTo = hostEmails(listing);
    if (hostTo.length && process.env.RESEND_API_KEY) {
      const subj = action === 'approve'
        ? `✅ Your ParkEasy listing is live: ${listing.title}`
        : `Your ParkEasy listing needs changes: ${listing.title}`;
      const html = action === 'approve'
        ? `<p>Good news — your listing <strong>${listing.title}</strong> has been approved and is now live on ParkEasy.</p>`
        : `<p>Thanks for submitting <strong>${listing.title}</strong>. We can't publish it yet:</p><blockquote>${(reason || '').replace(/</g, '&lt;')}</blockquote><p>Update the listing in the ParkEasy app and resubmit — we review within 24 hours.</p>`;
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>', to: hostTo, bcc: bccFor(hostTo), subject: subj, html }),
      }).catch(() => {});
    }
    return res.status(200).json({ ok: true });
  }

  // 2) Pull analytics with the service key (server-side only)
  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE };
  try {
    // Users (paginate up to 20 pages × 200 = 4k users; fine for now)
    const users = [];
    for (let page = 1; page <= 20; page++) {
      const r = await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: svc });
      if (!r.ok) break;
      const d = await r.json();
      const batch = d.users || d || [];
      users.push(...batch);
      if (batch.length < 200) break;
    }
    const now = Date.now(), DAY = 86400000;
    const within = (u, days) => now - new Date(u.created_at).getTime() < days * DAY;
    const latest = [...users]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 12)
      .map(u => ({ email: u.email, name: u.user_metadata?.name || '', created: u.created_at, lastSeen: u.last_sign_in_at }));

    // Private space listings, split by status — a draft is NOT bookable and
    // shouldn't be presented as if it were.
    let listings = { total: 0, live: 0, draft: 0, pending: 0, latest: [] };
    try {
      const lr = await fetch(`${URL_}/rest/v1/rental_listings?select=id,title,address,created_at,status,owner_email,price_per_hour,price_per_day,photos&order=created_at.desc&limit=100`,
        { headers: { ...svc, Prefer: 'count=exact' } });
      if (lr.ok) {
        const rows = await lr.json();
        const range = lr.headers.get('content-range');
        listings.total   = range?.includes('/') ? parseInt(range.split('/')[1]) || rows.length : rows.length;
        listings.live    = rows.filter(r => r.status === 'active').length;
        listings.draft   = rows.filter(r => r.status === 'draft').length;
        listings.pending = rows.filter(r => r.status === 'pending_approval').length;
        listings.latest  = rows.slice(0, 8).map(r => ({
          id: r.id, title: r.title, address: r.address, status: r.status,
          created_at: r.created_at, owner_email: r.owner_email,
          price_per_hour: r.price_per_hour, price_per_day: r.price_per_day,
          photos: Array.isArray(r.photos) ? r.photos.length : 0,
        }));
      }
    } catch { /* table may not exist yet */ }

    // Organization listings awaiting founder approval
    let pending = [];
    try {
      const pr = await fetch(`${URL_}/rest/v1/rental_listings?status=eq.pending_approval&select=*&order=created_at.asc`, { headers: svcH });
      if (pr.ok) pending = await pr.json();
    } catch { /* ignore */ }

    // Promo-code redemptions (e.g. PARKEZ) — total count + most recent.
    let promos = { total: 0, latest: [] };
    try {
      const rr = await fetch(`${URL_}/rest/v1/promo_redemptions?select=user_id,user_email,code,redeemed_at,expires_at&order=redeemed_at.desc&limit=200`,
        { headers: { ...svc, Prefer: 'count=exact' } });
      if (rr.ok) {
        const rows = await rr.json();
        const range = rr.headers.get('content-range');
        promos.total = range?.includes('/') ? parseInt(range.split('/')[1]) || rows.length : rows.length;
        promos.latest = rows.slice(0, 8);
      }
    } catch { /* table may not exist yet */ }

    // Community spot submissions (from the "Add a Spot" tab) — total + recent.
    let spots = { total: 0, latest: [] };
    try {
      // id and photo_url are needed so the dashboard can show what was
      // photographed and act on it — you cannot approve a spot you can't see.
      const sr = await fetch(`${URL_}/rest/v1/spot_submissions?select=id,near,street,type,restriction,notes,submitter_name,submitter_email,has_photo,photo_url,lat,lng,status,created_at,reviewed_at,review_note&order=created_at.desc&limit=50`,
        { headers: { ...svc, Prefer: 'count=exact' } });
      if (sr.ok) {
        const rows = await sr.json();
        const range = sr.headers.get('content-range');
        spots.total = range?.includes('/') ? parseInt(range.split('/')[1]) || rows.length : rows.length;
        // Awaiting review comes first and in full — that is the queue Marty
        // works through. The rest is history and only needs a short tail.
        spots.pending  = rows.filter(r => r.status === 'new');
        spots.approved = rows.filter(r => r.status === 'approved').length;
        spots.rejected = rows.filter(r => r.status === 'rejected').length;
        spots.latest   = rows.slice(0, 12);
      }
    } catch { /* table may not exist yet */ }

    // ── Premium members ────────────────────────────────────────────────
    // Every entitlement now lives in promo_redemptions, including Stripe
    // purchases (code STRIPE-SUB, written by the webhook), so this is the
    // whole picture rather than promos only. Counts are of DISTINCT accounts:
    // someone with both a promo and a subscription is one member, attributed
    // to their paid subscription.
    let premium = {
      active: 0, expiring7: 0, expiring30: 0, new30: 0,
      paying: 0, promo: 0, reward: 0,
      mrrPence: 0, conversionPct: 0,
      latest: [],
    };
    try {
      const nowISO = new Date(now).toISOString();
      const soon7  = new Date(now + 7 * DAY).toISOString();
      const soon30 = new Date(now + 30 * DAY).toISOString();
      const pr2 = await fetch(`${URL_}/rest/v1/promo_redemptions?expires_at=gt.${nowISO}&select=user_id,user_email,code,redeemed_at,expires_at&order=redeemed_at.desc`,
        { headers: svc });
      if (pr2.ok) {
        const rows = await pr2.json();
        // Collapse to one entry per account, keeping the strongest source
        // (paid beats promo beats reward) and the latest expiry.
        const rank = (code) => /STRIPE/i.test(code) ? 3 : /GEM|REWARD/i.test(code) ? 1 : 2;
        const byUser = new Map();
        for (const r of rows) {
          const id = r.user_id || r.user_email;
          if (!id) continue;
          const prev = byUser.get(id);
          if (!prev || rank(r.code) > rank(prev.code) ||
              (rank(r.code) === rank(prev.code) && r.expires_at > prev.expires_at)) {
            byUser.set(id, r);
          }
        }
        const members = [...byUser.values()];
        premium.active     = members.length;
        premium.expiring7  = members.filter(r => r.expires_at && r.expires_at < soon7).length;
        premium.expiring30 = members.filter(r => r.expires_at && r.expires_at < soon30).length;
        premium.new30      = members.filter(r => r.redeemed_at && (now - Date.parse(r.redeemed_at)) < 30 * DAY).length;
        premium.paying     = members.filter(r => rank(r.code) === 3).length;
        premium.reward     = members.filter(r => rank(r.code) === 1).length;
        premium.promo      = members.filter(r => rank(r.code) === 2).length;
        // Rough MRR from paying members only. A long entitlement implies an
        // annual plan spread over 12 months; a short one implies monthly.
        // Prices rose on 28 Jul 2026 (annual £20→£29, monthly £2.99→£3.99) and
        // everyone who subscribed before that is deliberately grandfathered on
        // the old price, so bill each member at whatever was current when they
        // joined. Using one price for everyone would overstate the old cohort
        // and understate every new one.
        const PRICE_V2_FROM = Date.parse('2026-07-28T00:00:00Z');
        premium.mrrPence = members.filter(r => rank(r.code) === 3).reduce((sum, r) => {
          const joined   = Date.parse(r.redeemed_at || r.expires_at);
          const daysLeft = (Date.parse(r.expires_at) - joined) / DAY;
          const isAnnual = daysLeft > 200;
          const v2       = joined >= PRICE_V2_FROM;
          if (isAnnual) return sum + Math.round((v2 ? 2900 : 2000) / 12);
          return sum + (v2 ? 399 : 299);
        }, 0);
        premium.conversionPct = users.length ? Math.round((members.length / users.length) * 1000) / 10 : 0;
        premium.latest = members.slice(0, 8).map(r => ({
          email: r.user_email, code: r.code, expires: r.expires_at,
          kind: rank(r.code) === 3 ? 'paid' : rank(r.code) === 1 ? 'reward' : 'promo',
        }));
      }
    } catch { /* table may not exist yet */ }

    // Partner (advertiser) performance: impressions/clicks/CTR per partner —
    // the numbers Marty quotes back to the business at renewal time.
    let partners = [];
    try {
      const [pr3, ev] = await Promise.all([
        fetch(`${URL_}/rest/v1/partners?select=id,name,active,ends_at`, { headers: svc }),
        fetch(`${URL_}/rest/v1/partner_events?select=partner_id,event_type&limit=10000`, { headers: svc }),
      ]);
      if (pr3.ok && ev.ok) {
        const rows = await pr3.json();
        const events = await ev.json();
        partners = rows.map(p => {
          const mine = events.filter(e => e.partner_id === p.id);
          const impressions = mine.filter(e => e.event_type === 'impression').length;
          const clicks = mine.filter(e => e.event_type === 'click').length;
          return { name: p.name, active: p.active, ends_at: p.ends_at, impressions, clicks,
            ctr: impressions ? Math.round((clicks / impressions) * 1000) / 10 : null };
        });
      }
    } catch { /* tables may not exist yet */ }

    // Bookings summary (Stripe Checkout marketplace). Gross paid + our fees.
    let bookings = { total: 0, paid: 0, grossPence: 0, feePence: 0, hostsOnboarded: 0 };
    try {
      const brr = await fetch(`${URL_}/rest/v1/bookings?select=status,amount_total_pence,application_fee_pence&order=created_at.desc&limit=1000`, { headers: svc });
      if (brr.ok) {
        const rows = await brr.json();
        bookings.total = rows.length;
        for (const b of rows) {
          if (b.status === 'paid') {
            bookings.paid += 1;
            bookings.grossPence += b.amount_total_pence || 0;
            bookings.feePence += b.application_fee_pence || 0;
          }
        }
      }
      const har = await fetch(`${URL_}/rest/v1/host_accounts?transfers_active=is.true&select=host_id`, { headers: { ...svc, Prefer: 'count=exact' } });
      if (har.ok) {
        const range = har.headers.get('content-range');
        bookings.hostsOnboarded = range?.includes('/') ? parseInt(range.split('/')[1]) || 0 : (await har.json()).length;
      }
    } catch { /* tables may not exist yet */ }

    return res.status(200).json({
      ok: true, configured: true,
      env,
      pending,
      promos,
      spots,
      premium,
      bookings,
      partners,
      users: {
        total: users.length,
        last7: users.filter(u => within(u, 7)).length,
        last30: users.filter(u => within(u, 30)).length,
        activeLast7: users.filter(u => u.last_sign_in_at && (now - new Date(u.last_sign_in_at).getTime() < 7 * DAY)).length,
        latest,
      },
      listings,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Analytics fetch failed' });
  }
}
