// DELETE /api/corporate/claims/:id — cancel a permit claim.
//
// Frees the slot immediately. No cutoff, no charge, no penalty: the block is
// paid monthly whether the permit is used or not, so there is nothing to
// recover and every reason to want the day handed back while a colleague can
// still use it. A cancellation window here would only produce no-shows.
import { applyCors, config, callerOf, memberFor, claimError } from '../_lib.js';

export default async function handler(req, res) {
  if (applyCors(req, res, 'DELETE,POST,OPTIONS')) return;
  // POST accepted alongside DELETE because some clients and proxies drop a
  // body-less DELETE; both do exactly the same thing.
  if (!['DELETE', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const cfg = config();
  if (!cfg.ok) return res.status(500).json({ error: 'Not configured' });

  const caller = await callerOf(req, cfg);
  if (!caller) return res.status(401).json({ error: 'Sign in to cancel a permit' });

  const claimId = req.query?.id;
  if (!claimId) return res.status(400).json({ error: 'Missing claim id' });

  try {
    const claim = await fetch(
      `${cfg.URL_}/rest/v1/permit_claims?id=eq.${encodeURIComponent(claimId)}`
      + `&select=id,status,claim_date,corporate_member_id,corporate_permit_block_id,`
      + `corporate_members(corporate_account_id,user_id,role)`,
      { headers: cfg.svc },
    ).then(r => r.json()).then(a => a?.[0] || null);

    if (!claim) return res.status(404).json({ error: 'That permit claim no longer exists.' });

    // Your own claim, or one belonging to somebody at a company you administer
    // — a manager cancelling for a member who has left for the day.
    const owner = claim.corporate_members || {};
    let allowed = owner.user_id && owner.user_id === caller.id;
    if (!allowed) {
      const me = await memberFor(cfg, caller.id, owner.corporate_account_id);
      allowed = me?.role === 'admin';
    }
    if (!allowed) return res.status(403).json({ error: 'That permit is not yours to cancel.' });

    const rpc = await fetch(`${cfg.URL_}/rest/v1/rpc/cancel_permit_claim`, {
      method: 'POST', headers: cfg.svc,
      body: JSON.stringify({ p_claim_id: claimId }),
    });
    if (!rpc.ok) {
      const { status, body } = claimError(await rpc.json().catch(() => ({})));
      return res.status(status).json(body);
    }

    const row = await rpc.json();
    return res.status(200).json({ ok: true, claim: Array.isArray(row) ? row[0] : row });
  } catch (e) {
    return res.status(500).json({ error: 'Could not cancel that just now.', detail: String(e?.message || e).slice(0, 200) });
  }
}
