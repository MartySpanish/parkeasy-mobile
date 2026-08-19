// POST /api/corporate/subscription   body { blockId, action? }
//
// Creates or re-syncs the Stripe Billing subscription behind one permit block.
// Founder-only: this is the endpoint that starts charging a company money.
//
// WHY THIS IS BILLING AND NOT CONNECT. The driver marketplace uses destination
// charges — the driver pays, Stripe splits, the host's 85% lands in their own
// account automatically. None of that applies here. A company is invoiced on
// terms, ParkEasy collects the whole amount, and the car park operator's share
// leaves separately. Nothing in Stripe pays the operator for us; see
// public.operator_settlements for the list of what is owed to whom.
//
// TEST MODE. Same guard as every other money path in this repo: a live key is
// refused unless STRIPE_LIVE_ENABLED is explicitly set. Nothing here moves real
// money until it has been reconciled by hand.
import Stripe from 'stripe';
import { applyCors, config, callerOf, blockById } from './_lib.js';

const DEFAULT_ADMINS = 'martinrooney3@hotmail.com,parkeasyuk@gmail.com';
const INVOICE_DAYS_UNTIL_DUE = 14;

function stripeAllowed(KEY) {
  if (!KEY) return false;
  return KEY.startsWith('sk_test_') || process.env.STRIPE_LIVE_ENABLED === 'true';
}

export default async function handler(req, res) {
  if (applyCors(req, res, 'POST,OPTIONS')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.STRIPE_SECRET_KEY;
  const cfg = config();
  if (!KEY || !cfg.ok) return res.status(500).json({ error: 'Not configured' });
  if (!stripeAllowed(KEY)) return res.status(403).json({ error: 'Live Stripe key without STRIPE_LIVE_ENABLED — refusing.' });

  const caller = await callerOf(req, cfg);
  if (!caller) return res.status(401).json({ error: 'Not signed in' });
  const ADMINS = (process.env.ADMIN_EMAILS || DEFAULT_ADMINS).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!ADMINS.includes((caller.email || '').toLowerCase())) return res.status(403).json({ error: 'Not an admin account' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const blockId = body?.blockId;
  if (!blockId) return res.status(400).json({ error: 'Missing blockId' });

  const stripe = new Stripe(KEY, { apiVersion: '2024-06-20' });

  try {
    const block = await blockById(cfg, blockId);
    if (!block) return res.status(404).json({ error: 'Permit block not found' });

    const [account, listing] = await Promise.all([
      fetch(`${cfg.URL_}/rest/v1/corporate_accounts?id=eq.${encodeURIComponent(block.corporate_account_id)}&select=*`, { headers: cfg.svc })
        .then(r => r.json()).then(a => a?.[0] || null),
      fetch(`${cfg.URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(block.listing_id)}&select=title`, { headers: cfg.svc })
        .then(r => r.json()).then(a => a?.[0] || null),
    ]);
    if (!account) return res.status(404).json({ error: 'Corporate account not found' });

    // 1. The customer, created once and reused.
    let customerId = account.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: account.company_name,
        email: account.billing_contact_email,
        description: `ParkEasy for Business — ${account.company_name}`,
        metadata: { corporate_account_id: account.id },
      });
      customerId = customer.id;
      await fetch(`${cfg.URL_}/rest/v1/corporate_accounts?id=eq.${encodeURIComponent(account.id)}`, {
        method: 'PATCH', headers: cfg.svc,
        body: JSON.stringify({ stripe_customer_id: customerId, updated_at: new Date().toISOString() }),
      });
    }

    // 2. Already subscribed → keep the quantity in step with permit_count and
    //    stop. permit_count is the quota AND the thing being billed for, so the
    //    two must never drift; the guard in the migration already refuses a
    //    reduction below live claims, so whatever is on the row is safe to bill.
    if (block.stripe_subscription_id) {
      const sub = await stripe.subscriptions.retrieve(block.stripe_subscription_id);
      const item = sub.items?.data?.[0];
      if (item && item.quantity !== block.permit_count) {
        await stripe.subscriptionItems.update(item.id, {
          quantity: block.permit_count,
          proration_behavior: 'create_prorations',
        });
      }
      await syncBlockStatus(cfg, block.id, sub.status);
      return res.status(200).json({
        ok: true, action: 'synced',
        subscription_id: sub.id, quantity: block.permit_count, status: sub.status,
      });
    }

    // 3. New subscription. A Price is created per block rather than reused:
    //    every block has its own negotiated monthly rate, so a shared price
    //    would be wrong for the next customer through the door.
    const price = await stripe.prices.create({
      currency: 'gbp',
      unit_amount: block.monthly_price_pence,
      recurring: { interval: 'month' },
      product_data: { name: `ParkEasy permits — ${listing?.title || 'car park'}` },
      metadata: { corporate_permit_block_id: block.id },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id, quantity: block.permit_count }],
      // Invoiced to the business on terms — not a card charged to a member of
      // staff. This is the whole difference between this and every other
      // payment in the product.
      collection_method: 'send_invoice',
      days_until_due: INVOICE_DAYS_UNTIL_DUE,
      metadata: {
        corporate_permit_block_id: block.id,
        corporate_account_id: account.id,
        listing_id: block.listing_id,
      },
    });

    await fetch(`${cfg.URL_}/rest/v1/corporate_permit_blocks?id=eq.${encodeURIComponent(block.id)}`, {
      method: 'PATCH', headers: cfg.svc,
      body: JSON.stringify({
        stripe_subscription_id: subscription.id,
        stripe_subscription_item_id: subscription.items?.data?.[0]?.id || null,
        updated_at: new Date().toISOString(),
      }),
    });

    return res.status(201).json({
      ok: true, action: 'created',
      subscription_id: subscription.id,
      customer_id: customerId,
      quantity: block.permit_count,
      monthly_price_pence: block.monthly_price_pence,
      days_until_due: INVOICE_DAYS_UNTIL_DUE,
      test_mode: KEY.startsWith('sk_test_'),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Subscription step failed', detail: String(e?.message || e).slice(0, 300) });
  }
}

// Stripe is the source of truth; the block row is a cache of it.
async function syncBlockStatus(cfg, blockId, stripeStatus) {
  const status = ['active', 'trialing'].includes(stripeStatus) ? 'active'
    : ['past_due', 'unpaid', 'paused', 'incomplete'].includes(stripeStatus) ? 'paused'
    : ['canceled', 'incomplete_expired'].includes(stripeStatus) ? 'cancelled'
    : null;
  if (!status) return;
  await fetch(`${cfg.URL_}/rest/v1/corporate_permit_blocks?id=eq.${encodeURIComponent(blockId)}`, {
    method: 'PATCH', headers: cfg.svc,
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  }).catch(() => {});
}
