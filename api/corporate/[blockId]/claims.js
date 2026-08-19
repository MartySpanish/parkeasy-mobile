// POST /api/corporate/:blockId/claims   body { date, vrn? }
//
// Claims one permit for the signed-in member on one date. The quota is enforced
// inside the database by claim_permit(), which takes a row lock on the block
// before it counts — see supabase/migrations/20260820_corporate_permits.sql and
// tests/db/concurrency.sh, where twenty simultaneous claims against a one-permit
// block produce exactly one winner.
//
// This endpoint does NOT do the counting itself, on purpose. A count here would
// be a count in one Node process, and two of those interleave.
import { applyCors, config, callerOf, blockById, memberFor, parseDate, normaliseVrn, maskVrn, claimError } from '../_lib.js';

export default async function handler(req, res) {
  if (applyCors(req, res, 'POST,OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const cfg = config();
  if (!cfg.ok) return res.status(500).json({ error: 'Not configured' });

  const caller = await callerOf(req, cfg);
  if (!caller) return res.status(401).json({ error: 'Sign in to claim a permit' });

  const blockId = req.query?.blockId;
  if (!blockId) return res.status(400).json({ error: 'Missing permit block' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const date = parseDate(body?.date);
  if (!date) return res.status(400).json({ error: 'Give a date as YYYY-MM-DD.' });

  try {
    const block = await blockById(cfg, blockId);
    if (!block) return res.status(404).json({ error: 'That permit block no longer exists.' });

    // Whoever is holding the session — never a member id off the request.
    const member = await memberFor(cfg, caller.id, block.corporate_account_id);
    if (!member) return res.status(403).json({ error: 'You are not a member of the company that holds these permits.' });

    // The plate: whatever they sent, else their primary vehicle, else their
    // only vehicle. Asking for it again on every claim would be the kind of
    // friction that makes people stop using the thing.
    let vrn = normaliseVrn(body?.vrn);
    if (!vrn) {
      const r = await fetch(
        `${cfg.URL_}/rest/v1/member_vehicles?corporate_member_id=eq.${encodeURIComponent(member.id)}`
        + `&select=vrn,is_primary&order=is_primary.desc,created_at.asc&limit=1`,
        { headers: cfg.svc },
      );
      vrn = (await r.json().catch(() => []))?.[0]?.vrn || null;
    }
    if (!vrn) return res.status(400).json({ error: 'Add a vehicle registration before claiming a permit.' });

    const rpc = await fetch(`${cfg.URL_}/rest/v1/rpc/claim_permit`, {
      method: 'POST', headers: cfg.svc,
      body: JSON.stringify({
        p_block_id: blockId, p_member_id: member.id, p_claim_date: date, p_vrn: vrn,
      }),
    });

    if (!rpc.ok) {
      const payload = await rpc.json().catch(() => ({}));
      const { status, body: errBody } = claimError(payload);
      // "Fully booked" is the answer somebody has to act on, so it comes with
      // the next date that is not — otherwise the app has said no and left them
      // to guess. Best effort: if this lookup fails the refusal still stands.
      if (errBody.code === 'PE007') {
        errBody.next_available = await nextAvailable(cfg, block, date).catch(() => null);
      }
      return res.status(status).json(errBody);
    }

    const claim = await rpc.json();
    // Plate masked: a VRN identifies a keeper, so it does not go in a log line.
    console.log(`permit claimed block=${blockId} date=${date} vrn=${maskVrn(vrn)}`);
    return res.status(201).json({ ok: true, claim: Array.isArray(claim) ? claim[0] : claim });
  } catch (e) {
    return res.status(500).json({ error: 'Could not complete that just now.', detail: String(e?.message || e).slice(0, 200) });
  }
}

/** The first date on or after `from` with a permit left, within 60 days. */
async function nextAvailable(cfg, block, from) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 60);
  const endStr = end.toISOString().slice(0, 10);

  const r = await fetch(
    `${cfg.URL_}/rest/v1/permit_claims`
    + `?corporate_permit_block_id=eq.${encodeURIComponent(block.id)}`
    + `&status=eq.claimed&claim_date=gte.${from}&claim_date=lte.${endStr}`
    + `&select=claim_date`,
    { headers: cfg.svc },
  );
  if (!r.ok) return null;
  const counts = new Map();
  for (const row of await r.json()) counts.set(row.claim_date, (counts.get(row.claim_date) || 0) + 1);

  for (let i = 1; i <= 60; i++) {
    const d = new Date(start); d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    if (block.end_date && key > block.end_date) return null;
    if ((counts.get(key) || 0) < block.permit_count) return key;
  }
  return null;
}
