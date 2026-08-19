// Shared plumbing for the /api/corporate endpoints.
//
// The leading underscore keeps Vercel from routing this file as an endpoint.
//
// TERMINOLOGY, ENFORCED HERE AS WELL AS IN THE MIGRATION. A permit is a right
// of entry against a quota, not a numbered bay. Nothing in this feature — copy,
// error message or field name — says "bay", "reserved bay" or "your bay",
// because ParkEasy does not control these car parks and cannot keep that
// promise. "Guaranteed access" and the car park's own name are the words.

const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;

export function applyCors(req, res, methods = 'GET,POST,DELETE,OPTIONS') {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export function config() {
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ok = Boolean(URL_ && ANON && SERVICE);
  return {
    ok, URL_, ANON, SERVICE,
    svc: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' },
  };
}

/** The signed-in user behind this request, or null. */
export async function callerOf(req, { URL_, ANON }) {
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return null;
    return await u.json();
  } catch { return null; }
}

async function one(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return (await r.json())?.[0] || null;
}

export async function blockById(cfg, blockId) {
  return one(`${cfg.URL_}/rest/v1/corporate_permit_blocks?id=eq.${encodeURIComponent(blockId)}&select=*`, cfg.svc);
}

/**
 * The caller's own membership of the company that owns this block.
 *
 * THE ENDPOINTS NEVER TAKE A MEMBER ID FROM THE REQUEST. Every claim is made
 * for whoever is holding the session, resolved here. Accepting a member id
 * from the client would let any signed-in user burn a colleague's permit, or
 * claim into a company they have nothing to do with — and the claim function is
 * SECURITY DEFINER, so it would happily oblige.
 */
export async function memberFor(cfg, userId, accountId) {
  if (!userId || !accountId) return null;
  return one(
    `${cfg.URL_}/rest/v1/corporate_members`
    + `?user_id=eq.${encodeURIComponent(userId)}`
    + `&corporate_account_id=eq.${encodeURIComponent(accountId)}`
    + `&status=eq.active&select=*`,
    cfg.svc,
  );
}

/** YYYY-MM-DD or null. Deliberately strict — a half-parsed date books a wrong day. */
export function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip check, so 2026-02-31 is rejected rather than silently becoming March.
  return d.toISOString().slice(0, 10) === value ? value : null;
}

export const normaliseVrn = (v) =>
  (String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null);

/**
 * A plate, safe to put in a log line.
 *
 * Vehicle registrations are personal data — they identify a keeper through the
 * DVLA — so they never go into application logs in full. Enough characters to
 * match up a support query, not enough to be a plate.
 */
export const maskVrn = (v) => {
  const s = normaliseVrn(v);
  return s ? `${s.slice(0, 2)}***${s.slice(-2)}` : '(none)';
};

/**
 * Postgres error -> HTTP status and a sentence a driver can act on.
 *
 * The SQLSTATEs come from claim_permit / cancel_permit_claim in
 * supabase/migrations/20260820_corporate_permits.sql. Mapping them here rather
 * than passing the raw message through means the database can be blunt and the
 * app can be kind.
 */
const CLAIM_ERRORS = {
  PE001: [404, 'That permit block no longer exists.'],
  PE002: [409, 'This permit block is paused, so no permits can be claimed right now.'],
  PE003: [400, 'That date is outside the dates this permit block covers.'],
  PE004: [403, 'You are not an active member of this account.'],
  PE005: [403, 'You are not a member of the company that holds these permits.'],
  PE006: [400, 'Add a vehicle registration before claiming a permit.'],
  PE007: [409, 'Fully booked for that date.'],
  PE008: [409, 'You already have a permit for that date.'],
  PE009: [409, 'That permit has already been cancelled.'],
};

export function claimError(payload) {
  // PostgREST surfaces a raised exception as {code, message, details, hint}.
  const code = payload?.code;
  if (CLAIM_ERRORS[code]) {
    const [status, error] = CLAIM_ERRORS[code];
    return { status, body: { error, code } };
  }
  return { status: 500, body: { error: 'Could not complete that just now.' } };
}
