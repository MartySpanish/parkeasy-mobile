// GET /api/corporate/:blockId/plate-list?date=YYYY-MM-DD[&format=csv]
//
// The operator handover: which vehicles may enter this car park on this date.
// v1 is Marty emailing the CSV to APCOA. The JSON is shaped so it can later be
// POSTed straight at an operator API without the shape changing — a top-level
// object identifying the car park and the date, and a `vehicles` array whose
// rows are the units an operator's ANPR whitelist actually consumes.
//
// ADMIN ONLY. This is a list of who is where on a given day, keyed by vehicle
// registration, which is personal data about identifiable people. An ordinary
// member gets their own claims and nothing else.
import { applyCors, config, callerOf, blockById, memberFor, parseDate } from '../_lib.js';

export default async function handler(req, res) {
  if (applyCors(req, res, 'GET,OPTIONS')) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const cfg = config();
  if (!cfg.ok) return res.status(500).json({ error: 'Not configured' });

  const caller = await callerOf(req, cfg);
  if (!caller) return res.status(401).json({ error: 'Sign in' });

  const blockId = req.query?.blockId;
  const date = parseDate(req.query?.date) || new Date().toISOString().slice(0, 10);
  const wantsCsv = String(req.query?.format || '').toLowerCase() === 'csv';

  const ADMINS = (process.env.ADMIN_EMAILS || 'martinrooney3@hotmail.com,parkeasyuk@gmail.com')
    .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

  try {
    const block = await blockById(cfg, blockId);
    if (!block) return res.status(404).json({ error: 'That permit block no longer exists.' });

    // Either a ParkEasy founder (who has to send this to the operator) or an
    // admin of the company that holds the block.
    const isFounder = ADMINS.includes((caller.email || '').toLowerCase());
    const member = isFounder ? null : await memberFor(cfg, caller.id, block.corporate_account_id);
    if (!isFounder && member?.role !== 'admin') {
      return res.status(403).json({ error: 'Only an account administrator can see the vehicle list.' });
    }

    const [listing, claims] = await Promise.all([
      fetch(`${cfg.URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(block.listing_id)}&select=title,address`, { headers: cfg.svc })
        .then(r => r.json()).then(a => a?.[0] || null),
      fetch(
        `${cfg.URL_}/rest/v1/permit_claims`
        + `?corporate_permit_block_id=eq.${encodeURIComponent(blockId)}`
        + `&claim_date=eq.${date}&status=eq.claimed`
        + `&select=id,vrn,created_at,corporate_members(full_name,email)`
        + `&order=created_at.asc`,
        { headers: cfg.svc },
      ).then(r => r.json()),
    ]);

    const company = await fetch(
      `${cfg.URL_}/rest/v1/corporate_accounts?id=eq.${encodeURIComponent(block.corporate_account_id)}&select=company_name`,
      { headers: cfg.svc },
    ).then(r => r.json()).then(a => a?.[0]?.company_name || null);

    const vehicles = (Array.isArray(claims) ? claims : []).map(c => ({
      vrn: c.vrn,
      driver_name: c.corporate_members?.full_name || null,
      claim_id: c.id,
      claimed_at: c.created_at,
    }));

    if (wantsCsv) {
      const csv = toCsv(
        ['vrn', 'driver_name', 'date', 'car_park', 'company'],
        vehicles.map(v => [v.vrn, v.driver_name || '', date, listing?.title || '', company || '']),
      );
      const stamp = date.replace(/-/g, '');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="parkeasy-permits-${stamp}.csv"`);
      return res.status(200).send(csv);
    }

    return res.status(200).json({
      date,
      block_id: blockId,
      company,
      car_park: { listing_id: block.listing_id, name: listing?.title || null, address: listing?.address || null },
      permits_total: block.permit_count,
      permits_claimed: vehicles.length,
      vehicles,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Could not build the vehicle list.', detail: String(e?.message || e).slice(0, 200) });
  }
}

// RFC 4180 quoting. A name with a comma in it must not shift every column of
// the file an operator is about to load into their barrier system.
function toCsv(header, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
