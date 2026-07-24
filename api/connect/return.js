// GET /api/connect/return?acct=acct_xxx — Account Link return target. Stripe
// sends the host here after they finish (or exit) hosted onboarding. We
// re-fetch the account from Stripe (source of truth), sync host_accounts, then
// redirect the host back into the app on parkeasy.uk.
import Stripe from 'stripe';

export default async function handler(req, res) {
  const KEY = process.env.STRIPE_SECRET_KEY;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const APP_URL = process.env.APP_URL || 'https://parkeasy.uk';
  const acct = String(req.query.acct || '');

  if (!KEY || !KEY.startsWith('sk_test_') || !URL_ || !SERVICE || !acct) {
    return res.redirect(302, `${APP_URL}/?payouts=error`);
  }

  try {
    const stripe = new Stripe(KEY);
    const account = await stripe.accounts.retrieve(acct);
    const transfersActive = account.capabilities?.transfers === 'active';
    const status = transfersActive && account.payouts_enabled
      ? 'active'
      : account.requirements?.disabled_reason
        ? 'restricted'
        : 'onboarding';

    const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
    await fetch(`${URL_}/rest/v1/host_accounts?stripe_account_id=eq.${acct}`, {
      method: 'PATCH', headers: svc,
      body: JSON.stringify({ onboarding_status: status, transfers_active: transfersActive, updated_at: new Date().toISOString() }),
    });

    return res.redirect(302, `${APP_URL}/?payouts=${status === 'active' ? 'done' : 'pending'}`);
  } catch (e) {
    console.error('connect/return', e);
    return res.redirect(302, `${APP_URL}/?payouts=error`);
  }
}
