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
