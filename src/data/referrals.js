// Referrals: the code, and the code somebody arrived on.
//
// THE ORDERING PROBLEM THIS SOLVES. An invited driver lands on
// parkeasy.uk/?ref=PQ4R7T with no account. The referral cannot be recorded
// until they have one, and they may not sign in for a week — so the code is
// held on the device and claimed the moment an account exists. Without that,
// every referral link that did not end in an immediate signup was lost, which
// is most of them.
import { supabase, isSupabaseEnabled } from '../supabase';
import { normaliseCode } from './referralsCore';

export { CODE_ALPHABET, CODE_RE, normaliseCode, looksLikeCode, referralLine, claimMessage }
  from './referralsCore';

const PENDING = 'pe_ref_code';

/** Remember a code from the URL until there is an account to attach it to. */
export const rememberCode = (raw) => {
  const code = normaliseCode(raw);
  if (!code) return null;
  try {
    // Never overwrites: the first friend whose link they followed is the one
    // who gets the credit, and a later link cannot take it off them.
    if (!localStorage.getItem(PENDING)) localStorage.setItem(PENDING, code);
    return localStorage.getItem(PENDING);
  } catch { return code; }
};

export const pendingCode = () => {
  try { return localStorage.getItem(PENDING) || null; } catch { return null; }
};

const forgetCode = () => { try { localStorage.removeItem(PENDING); } catch { /* private mode */ } };

/**
 * Claim whatever code is waiting, now that somebody is signed in.
 *
 * @returns the reason string, or null when there was nothing to claim.
 *
 * The code is forgotten on every outcome EXCEPT a failure to reach the server.
 * 'unknown_code' and 'own_code' will never succeed however many times they are
 * retried, and retrying them on every page load is a request per load forever.
 */
export async function claimPendingCode() {
  const code = pendingCode();
  if (!code || !isSupabaseEnabled) return null;
  try {
    const { data, error } = await supabase.rpc('claim_referral', { p_code: code });
    if (error || !data) return null;           // keep it; the server was unreachable
    if (data.reason !== 'signed_out') forgetCode();
    return data.reason;
  } catch { return null; }
}

/** The signed-in driver's own code and counts, or null. */
export async function fetchReferrals() {
  if (!isSupabaseEnabled) return null;
  try {
    const { data, error } = await supabase.rpc('my_referrals');
    if (error || !data || data.signed_in === false) return null;
    return data;
  } catch { return null; }
}

/** Mint the caller's code, if they have not got one yet. */
export async function ensureCode() {
  if (!isSupabaseEnabled) return null;
  try {
    const { data, error } = await supabase.rpc('my_referral_code');
    return error ? null : (data || null);
  } catch { return null; }
}

/** The link to send. */
export const referralLink = (code) =>
  code ? `https://parkeasy.uk/?ref=${encodeURIComponent(code)}` : null;

export default fetchReferrals;
