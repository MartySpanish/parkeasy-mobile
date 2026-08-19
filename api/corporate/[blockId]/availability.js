// GET /api/corporate/:blockId/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Per-date {date, permits_total, permits_claimed, available} for the staff
// calendar. Counts only — no names, no plates. That is deliberate: an ordinary
// member has no RLS route to the block's claim list (see the policies in
// supabase/migrations/20260820_corporate_permits.sql), so the calendar is built
// from an aggregate that reveals nothing about who is in on Thursday.
import { applyCors, config, callerOf, blockById, memberFor, parseDate } from '../_lib.js';

const MAX_DAYS = 120;

export default async function handler(req, res) {
  if (applyCors(req, res, 'GET,OPTIONS')) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const cfg = config();
  if (!cfg.ok) return res.status(500).json({ error: 'Not configured' });

  const caller = await callerOf(req, cfg);
  if (!caller) return res.status(401).json({ error: 'Sign in to see availability' });

  const blockId = req.query?.blockId;
  const today = new Date().toISOString().slice(0, 10);
  const from = parseDate(req.query?.from) || today;
  const toDefault = (() => { const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 41); return d.toISOString().slice(0, 10); })();
  const to = parseDate(req.query?.to) || toDefault;
  if (to < from) return res.status(400).json({ error: '`to` is before `from`.' });

  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (days > MAX_DAYS) return res.status(400).json({ error: `Ask for at most ${MAX_DAYS} days at a time.` });

  try {
    const block = await blockById(cfg, blockId);
    if (!block) return res.status(404).json({ error: 'That permit block no longer exists.' });

    const member = await memberFor(cfg, caller.id, block.corporate_account_id);
    if (!member) return res.status(403).json({ error: 'You are not a member of the company that holds these permits.' });

    const r = await fetch(
      `${cfg.URL_}/rest/v1/permit_claims`
      + `?corporate_permit_block_id=eq.${encodeURIComponent(blockId)}`
      + `&status=eq.claimed&claim_date=gte.${from}&claim_date=lte.${to}`
      + `&select=claim_date,corporate_member_id`,
      { headers: cfg.svc },
    );
    if (!r.ok) throw new Error(`claims read ${r.status}`);
    const rows = await r.json();

    const claimed = new Map();
    const mine = new Set();
    for (const row of rows) {
      claimed.set(row.claim_date, (claimed.get(row.claim_date) || 0) + 1);
      if (row.corporate_member_id === member.id) mine.add(row.claim_date);
    }

    const dates = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      const taken = claimed.get(date) || 0;
      // A date outside the block's own window has no permits, rather than a
      // full complement nobody can actually claim.
      const inWindow = date >= block.start_date && (!block.end_date || date <= block.end_date)
        && block.status === 'active';
      const total = inWindow ? block.permit_count : 0;
      dates.push({
        date,
        permits_total: total,
        permits_claimed: taken,
        available: Math.max(0, total - taken),
        // So the calendar can show "you're already in" without a second call.
        claimed_by_me: mine.has(date),
      });
    }

    return res.status(200).json({
      block_id: blockId,
      permit_count: block.permit_count,
      status: block.status,
      start_date: block.start_date,
      end_date: block.end_date,
      from, to,
      dates,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Could not load availability.', detail: String(e?.message || e).slice(0, 200) });
  }
}
