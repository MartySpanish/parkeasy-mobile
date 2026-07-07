// API helper. The serverless functions (/api/notify, /api/admin) only run on
// Vercel hosting. parkeasy.uk currently serves the static build from GitHub
// Pages, where those paths 404 — so every API call tries same-origin first
// and falls back to the canonical Vercel deployment (CORS-enabled there).
const VERCEL_API_BASE = 'https://parkeasy-gray.vercel.app';

export async function apiFetch(path, opts = {}) {
  try {
    const r = await fetch(path, opts);
    if (r.status !== 404 && r.status !== 405) return r;
  } catch { /* fall through to the Vercel origin */ }
  return fetch(VERCEL_API_BASE + path, opts);
}

// Redeem a promo code (e.g. PARKEZ) for the signed-in user. Returns
// { ok, premiumUntil, days, error }. Server enforces the window + one-per-account.
export async function redeemPromo(code, token) {
  try {
    const r = await apiFetch('/api/redeem-promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, ...d };
  } catch {
    return { ok: false, error: 'Couldn’t reach the promo service — try again.' };
  }
}

// Fetch the caller's active promo entitlement so Premium follows them across
// devices/logins. Returns { premiumUntil } (ms) or null.
export async function fetchPromoStatus(token) {
  try {
    const r = await apiFetch('/api/redeem-promo', { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// POST a notification to /api/notify, which emails CONTACT_EMAIL via Resend.
// Fails silently so the app keeps working even if email is down.
export async function notify(type, data = {}) {
  try {
    const r = await apiFetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...data }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
