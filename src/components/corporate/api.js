// Thin client for the /api/corporate endpoints.
//
// Every call carries the caller's Supabase access token; the server resolves
// which member they are from it. Nothing here ever sends a member id — see the
// note on memberFor() in api/corporate/_lib.js for why that matters.
import { supabase } from '../../supabase';

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Sign in to use work parking.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function call(path, init = {}) {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init.headers || {}) } });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text.slice(0, 200) }; }
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = body.code;
    err.nextAvailable = body.next_available || null;
    throw err;
  }
  return body;
}

export const getAvailability = (blockId, from, to) =>
  call(`/api/corporate/${encodeURIComponent(blockId)}/availability?from=${from}&to=${to}`);

export const claimPermit = (blockId, date, vrn) =>
  call(`/api/corporate/${encodeURIComponent(blockId)}/claims`, {
    method: 'POST', body: JSON.stringify({ date, ...(vrn ? { vrn } : {}) }),
  });

export const cancelClaim = (claimId) =>
  call(`/api/corporate/claims/${encodeURIComponent(claimId)}`, { method: 'DELETE' });

export const getPlateList = (blockId, date) =>
  call(`/api/corporate/${encodeURIComponent(blockId)}/plate-list?date=${date}`);

/** The CSV the operator gets. Opened in a tab rather than fetched, so the
 *  browser's own download handling applies and no blob is held in memory. */
export async function plateListCsvUrl(blockId, date) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const res = await fetch(
    `/api/corporate/${encodeURIComponent(blockId)}/plate-list?date=${date}&format=csv`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error('Could not build the vehicle list.');
  return URL.createObjectURL(await res.blob());
}
