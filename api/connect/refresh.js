// GET /api/connect/refresh?acct=acct_xxx — Account Link refresh target. Stripe
// sends the host here if the onboarding link expired or was reloaded. We mint a
// fresh Account Link for the same account and redirect them straight into it.
import Stripe from 'stripe';

export default async function handler(req, res) {
  const KEY = process.env.STRIPE_SECRET_KEY;
  const API_BASE = process.env.API_BASE || 'https://parkeasy-gray.vercel.app';
  const APP_URL = process.env.APP_URL || 'https://parkeasy.uk';
  const acct = String(req.query.acct || '');

  if (!KEY || !KEY.startsWith('sk_test_') || !acct) {
    return res.redirect(302, `${APP_URL}/?payouts=error`);
  }

  try {
    const stripe = new Stripe(KEY);
    const link = await stripe.accountLinks.create({
      account: acct,
      refresh_url: `${API_BASE}/api/connect/refresh?acct=${acct}`,
      return_url: `${API_BASE}/api/connect/return?acct=${acct}`,
      type: 'account_onboarding',
    });
    return res.redirect(302, link.url);
  } catch (e) {
    console.error('connect/refresh', e);
    return res.redirect(302, `${APP_URL}/?payouts=error`);
  }
}
