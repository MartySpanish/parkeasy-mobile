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

// Start (or resume) Stripe Connect payout onboarding for the signed-in host.
// Returns a Stripe-hosted Account Link URL to redirect the host to.
export async function startPayoutOnboarding(token) {
  const r = await apiFetch('/api/connect/onboard', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.url) throw new Error(d.error || 'Could not start payout setup');
  return d.url;
}

// Create a Stripe Checkout Session for a booking and return the hosted payment
// URL. Price/fees are computed server-side from the listing — the client only
// says which listing and for how long. Token is optional (guest checkout ok).
export async function createBookingSession({ listingId, durationHours, startsAt, token, marketingOptIn, repeatWeeks, vehicleReg }) {
  const r = await apiFetch('/api/checkout/create-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ listingId, durationHours, startsAt, marketingOptIn: !!marketingOptIn, repeatWeeks: repeatWeeks || 1, vehicleReg: vehicleReg || null }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.url) throw new Error(d.error || 'Could not start checkout');
  return d.url;
}

// Buy a season/bundle pass → returns the Stripe Checkout URL.
export async function buyPass(passId, token) {
  const r = await apiFetch('/api/passes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'buy', passId }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.url) throw new Error(d.error || 'Could not start pass purchase');
  return d.url;
}

// Redeem one pass credit for a booking (no charge).
export async function redeemPass({ purchaseId, startsAt, durationHours, token }) {
  const r = await apiFetch('/api/passes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'redeem', purchaseId, startsAt, durationHours }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Could not redeem pass credit');
  return d;
}

// Booking message thread (driver ↔ host, contact details never shared).
export async function fetchMessages(bookingId, token) {
  const r = await apiFetch(`/api/messages?bookingId=${encodeURIComponent(bookingId)}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  return r.ok ? d : { messages: [] };
}
export async function sendMessage(bookingId, body, token) {
  const r = await apiFetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bookingId, body }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Could not send your message');
  return d;
}

// Cancel a booking (driver or host). Returns { ok, refundPence, refundStatus }.
export async function cancelBooking(bookingId, token) {
  const r = await apiFetch('/api/bookings/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bookingId }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Could not cancel');
  return d;
}

// ── Live occupancy, fed by the parking timer ────────────────────────────────
// An opaque per-device key, so a guest (no account) can still start and end
// their own session. Generated once and kept locally; it identifies a device to
// itself, not a person to us.
export function clientKey() {
  try {
    let k = localStorage.getItem('pe_client_key');
    if (!k) {
      k = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now().toString(36));
      localStorage.setItem('pe_client_key', k);
    }
    return k;
  } catch { return 'anon'; }
}

// Best-effort both ways: a parking timer must never fail because a
// nice-to-have signal could not be recorded.
export async function reportOccupancy(spotId, action, city) {
  try {
    await apiFetch('/api/occupancy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotId: String(spotId), key: clientKey(), action, city }),
    });
  } catch { /* ignore */ }
}

export async function fetchOccupancy() {
  try {
    const r = await apiFetch('/api/occupancy');
    if (!r.ok) return {};
    return (await r.json())?.counts || {};
  } catch { return {}; }
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
