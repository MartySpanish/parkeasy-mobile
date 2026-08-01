// POST /api/webhooks/stripe — Stripe's server-to-server notifications.
// Verifies the signature against the raw body, then syncs state into Supabase:
//   • checkout.session.completed / async_payment_succeeded  → booking paid
//   • checkout.session.async_payment_failed / expired        → booking failed
//   • account.updated / capability.updated                   → host_accounts state
//   • payout.paid / payout.failed                            → logged (future host UI)
//
//   • invoice.paid                                            → Premium renewal
// Supabase is a cache; Stripe is the source of truth.
import Stripe from 'stripe';

// Stripe needs the raw request body to verify the signature — disable parsing.
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

async function syncHostAccount(stripe, svc, URL_, accountId) {
  const account = await stripe.accounts.retrieve(accountId);
  const transfersActive = account.capabilities?.transfers === 'active';
  const status = transfersActive && account.payouts_enabled
    ? 'active'
    : account.requirements?.disabled_reason
      ? 'restricted'
      : 'onboarding';
  // Upsert on host_id (from account metadata) so a missing row self-heals.
  const hostId = account.metadata?.host_id || null;
  if (hostId) {
    await fetch(`${URL_}/rest/v1/host_accounts?on_conflict=host_id`, {
      method: 'POST', headers: { ...svc, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ host_id: hostId, stripe_account_id: accountId, onboarding_status: status, transfers_active: transfersActive, updated_at: new Date().toISOString() }),
    });
  } else {
    await fetch(`${URL_}/rest/v1/host_accounts?stripe_account_id=eq.${accountId}`, {
      method: 'PATCH', headers: svc,
      body: JSON.stringify({ onboarding_status: status, transfers_active: transfersActive, updated_at: new Date().toISOString() }),
    });
  }
}

// Premium bought via a Stripe payment link: find the auth user by the buyer's
// email and record the entitlement in promo_redemptions (code STRIPE-SUB), so
// the existing login sync surfaces Premium on every device. Duration: monthly
// price (< £10) → 35 days; anything bigger (annual/lifetime) → 366 days.
// Renewals arrive as invoice.paid and extend the same entitlement.
// End a Stripe-subscription entitlement. Deliberately touches ONLY the
// STRIPE-SUB row: a promo or hidden-gem reward is a separate grant and must
// survive someone cancelling their paid subscription.
async function revokePremiumByEmail(svc, URL_, email) {
  if (!email) return;
  const now = new Date().toISOString();
  const r = await fetch(
    `${URL_}/rest/v1/promo_redemptions?user_email=eq.${encodeURIComponent(email)}&code=eq.STRIPE-SUB`,
    { method: 'PATCH', headers: svc, body: JSON.stringify({ expires_at: now }) },
  );
  if (!r.ok) throw new Error(`revoke failed: ${r.status}`);
}

async function grantPremiumByEmail(svc, URL_, email, days) {
  if (!email) return;
  let userId = null;
  for (let page = 1; page <= 5 && !userId; page++) {
    const r = await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: svc });
    if (!r.ok) break;
    const d = await r.json();
    const batch = d.users || d || [];
    userId = batch.find(u => (u.email || '').toLowerCase() === email)?.id || null;
    if (batch.length < 200) break;
  }
  // No account yet. Previously this returned and the entitlement was lost: the
  // payer got nothing, and at least one person then paid a second time three
  // minutes later. Record it against the email instead so it is waiting to be
  // claimed the moment they sign up. Requires promo_redemptions.user_id to be
  // nullable — see 20260728_entitlements_without_account.sql.
  if (!userId) {
    console.warn('premium grant: no account yet for', email, '— storing unclaimed entitlement');
    // NOT a PostgREST upsert. on_conflict can only name plain columns, and the
    // unique index guarding these rows is
    //   (lower(user_email), code) WHERE user_id IS NULL
    // — an expression on a PARTIAL index. Postgres cannot infer that from column
    // names, so `on_conflict=user_email,code` returned 42P10 ("no unique or
    // exclusion constraint matching the ON CONFLICT specification") every single
    // time. The throw below then 500'd, Stripe retried, and it failed again.
    //
    // Net effect: anyone who paid for Premium BEFORE creating an account got
    // nothing, which is the exact case this code path exists to handle. So do
    // it in two explicit steps against the index we actually have.
    const candidate = Date.now() + days * 86400000;
    const q = `${URL_}/rest/v1/promo_redemptions`
      + `?user_email=eq.${encodeURIComponent(email)}&code=eq.STRIPE-SUB&user_id=is.null`;

    // Never shorten an existing unclaimed grant, same rule as the claimed path:
    // a new annual subscription fires checkout.session.completed AND invoice.paid.
    let current = 0;
    try {
      const cr = await fetch(`${q}&select=expires_at`, { headers: svc });
      if (cr.ok) current = Date.parse((await cr.json())?.[0]?.expires_at || 0) || 0;
    } catch { /* treat as none */ }
    const expiresAt = new Date(Math.max(candidate, current)).toISOString();

    const patch = await fetch(q, {
      method: 'PATCH', headers: { ...svc, Prefer: 'return=representation' },
      body: JSON.stringify({ expires_at: expiresAt }),
    });
    if (!patch.ok) throw new Error(`unclaimed entitlement update failed: ${patch.status} ${await patch.text().catch(()=>'')}`);
    const updated = await patch.json().catch(() => []);
    if (!updated.length) {
      const ins = await fetch(`${URL_}/rest/v1/promo_redemptions`, {
        method: 'POST', headers: svc,
        body: JSON.stringify({ user_id: null, user_email: email, code: 'STRIPE-SUB', expires_at: expiresAt }),
      });
      // 23505 means a concurrent delivery of the same event won the race and the
      // row now exists — the entitlement is recorded, which is all we needed.
      if (!ins.ok) {
        const detail = await ins.text().catch(() => '');
        if (!detail.includes('23505')) {
          // Throw so the handler returns 500 and Stripe retries. A 200 here would
          // mark the event delivered and we would never hear about it again.
          throw new Error(`unclaimed entitlement write failed: ${ins.status} ${detail}`);
        }
      }
    }
    return;
  }
  // Never shorten an existing entitlement. A new annual subscription fires
  // BOTH checkout.session.completed (366d) and invoice.paid for its first
  // invoice — without this, the renewal path would cut an annual to 35 days.
  let current = 0;
  try {
    const cr = await fetch(`${URL_}/rest/v1/promo_redemptions?user_id=eq.${userId}&code=eq.STRIPE-SUB&select=expires_at`, { headers: svc });
    if (cr.ok) current = Date.parse((await cr.json())?.[0]?.expires_at || 0) || 0;
  } catch { /* treat as none */ }
  const candidate = Date.now() + days * 86400000;
  const expiresAt = new Date(Math.max(candidate, current)).toISOString();
  await fetch(`${URL_}/rest/v1/promo_redemptions?on_conflict=user_id,code`, {
    method: 'POST', headers: { ...svc, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: userId, user_email: email, code: 'STRIPE-SUB', expires_at: expiresAt }),
  });
}

async function grantPremiumFromPaymentLink(svc, URL_, s) {
  const email = (s.customer_details?.email || s.customer_email || '').trim().toLowerCase();
  if (!email || !s.amount_total) return;
  const days = s.amount_total < 1000 ? 35 : 366;
  await grantPremiumByEmail(svc, URL_, email, days);
}

async function markBooking(svc, URL_, sessionId, patch) {
  if (!sessionId) return;
  await fetch(`${URL_}/rest/v1/bookings?stripe_session_id=eq.${sessionId}`, {
    method: 'PATCH', headers: svc,
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

// Booking confirmation emails (driver + host + founder), via Resend. Best-effort.
async function sendBookingEmails(svc, URL_, sessionId) {
  const KEYR = process.env.RESEND_API_KEY;
  const FROM = process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>';
  const FOUNDER = process.env.CONTACT_EMAIL;
  if (!KEYR) return;
  try {
    const br = await fetch(`${URL_}/rest/v1/bookings?stripe_session_id=eq.${sessionId}&select=*`, { headers: svc });
    const b = (await br.json())?.[0];
    if (!b) return;
    let listing = null;
    if (b.listing_id) {
      const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${b.listing_id}&select=title,address,contact_email,instructions,price_per_hour,price_per_day,gate_opens_at,gate_closes_at,overnight_fee_pence`, { headers: svc });
      listing = (await lr.json())?.[0] || null;
    }
    const gbp = (p) => `£${(p / 100).toFixed(2)}`;
    // Titles, addresses, arrival instructions and offer copy are free text a
    // host typed. They were being interpolated straight into the HTML of an
    // email we send to a driver — one stray "<" mangles the message, and worse
    // is possible. notify.js has escaped its rows from the start; this file
    // never did.
    const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    // Arrival instructions are the one field where a host's own line breaks
    // carry meaning ("park left or right / not the courtyard"), so keep them.
    const escMultiline = (s) => esc(s).replace(/\n/g, '<br>');

    // duration_hours holds DAYS on a day-priced site (see create-session), so a
    // 5-day booking at Belfast Royal Academy was about to be confirmed to the
    // driver as "5h". Read the unit off the listing, the same test checkout uses.
    const dayPriced = !(Number(listing?.price_per_hour) > 0) && Number(listing?.price_per_day) > 0;
    const n = Number(b.duration_hours) || 1;
    const lengthText = dayPriced ? `${n} day${n !== 1 ? 's' : ''}` : `${n}h`;
    const when = b.starts_at
      ? (dayPriced
          // The gates define the window, so a start time is noise — give the
          // date and the hours they can actually get in and out.
          ? `${new Date(b.starts_at).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' })}`
            + (listing?.gate_opens_at ? `, ${String(listing.gate_opens_at).slice(0,5)}–${String(listing.gate_closes_at || '').slice(0,5)}` : '')
          : new Date(b.starts_at).toLocaleString('en-GB', { timeZone: 'Europe/London' }))
      : 'see app';
    const title = esc(listing?.title || 'a space');
    const ref = String(b.id || '').slice(0, 8).toUpperCase();
    // A locked gate and a fee the driver didn't expect is the complaint this
    // whole listing type generates, so it goes in the confirmation, not just
    // in the booking sheet they saw once.
    const gateWarning = (dayPriced && listing?.gate_closes_at)
      ? `<p style="font-family:system-ui;margin:10px 0;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;color:#92400e">
           <strong>Gates lock at ${String(listing.gate_closes_at).slice(0,5)}.</strong> ${Number(listing.overnight_fee_pence) > 0
             ? `A vehicle left in after that is locked in overnight and there's a ${gbp(listing.overnight_fee_pence)} charge, which goes to the site.`
             : `A vehicle left in after that is locked in until the site reopens.`}
         </p>`
      : '';
    // "Your booking" (what you need to turn up) is kept separate from the
    // receipt (what you paid). The registration belongs in the first: a driver
    // checks it before setting off, and it is not a payment detail.
    const bookingRows = (extra) => `<table style="border-collapse:collapse"><tr><td style="padding:4px 10px;color:#64748b">Space</td><td style="padding:4px 10px"><strong>${title}</strong></td></tr>`
      + `<tr><td style="padding:4px 10px;color:#64748b">Address</td><td style="padding:4px 10px">${esc(listing?.address || '')}</td></tr>`
      + `<tr><td style="padding:4px 10px;color:#64748b">When</td><td style="padding:4px 10px">${when} · ${lengthText}</td></tr>`
      + `<tr><td style="padding:4px 10px;color:#64748b">Vehicle</td><td style="padding:4px 10px"><strong style="letter-spacing:.08em">${b.vehicle_reg || '—'}</strong></td></tr>`
      + `<tr><td style="padding:4px 10px;color:#64748b">Reference</td><td style="padding:4px 10px">${ref}</td></tr>${extra || ''}</table>`;
    const receiptRows = () => `<h3 style="font-family:system-ui;margin:18px 0 4px;font-size:15px">Receipt</h3>`
      + `<table style="border-collapse:collapse"><tr><td style="padding:4px 10px;color:#64748b">Total paid</td><td style="padding:4px 10px">${gbp(b.amount_total_pence)}</td></tr></table>`;
    // Kept for the founder/host notifications, which want one flat summary.
    const rows = (extra) => bookingRows(`<tr><td style="padding:4px 10px;color:#64748b">Total paid</td><td style="padding:4px 10px">${gbp(b.amount_total_pence)}</td></tr>${extra || ''}`);
    // Local offer for this listing (active + in window) — rides along in the
    // driver's confirmation email. Best-effort; table may not exist yet.
    let offerHtml = '';
    try {
      const today = new Date().toISOString().slice(0, 10);
      const ofr = await fetch(`${URL_}/rest/v1/local_offers?listing_id=eq.${b.listing_id}&active=is.true&or=(start_date.is.null,start_date.lte.${today})&or=(end_date.is.null,end_date.gte.${today})&select=business_name,description,offer_code&limit=1`, { headers: svc });
      const offer = ofr.ok ? (await ofr.json())?.[0] : null;
      if (offer) offerHtml = `<div style="font-family:system-ui;margin-top:14px;padding:12px 14px;border:1px solid #99f6e4;border-radius:10px;background:#f0fdfa"><strong>📍 While you're there:</strong> ${esc(offer.description)} — ${esc(offer.business_name)}${offer.offer_code ? ` · code <strong>${esc(offer.offer_code)}</strong>` : ''}</div>`;
    } catch { /* no offers table yet */ }
    const send = (to, subject, html) => fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${KEYR}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    }).catch(() => {});
    const jobs = [];
    // Driver's post-payment anxiety is "will I find the spot" — arrival
    // instructions go FIRST, receipt second.
    const findIt = listing?.instructions
      ? `<div style="font-family:system-ui;margin:10px 0;padding:12px 14px;border-left:4px solid #2ED3C6;background:#f0fdfa;border-radius:8px"><strong>📍 How to find your space</strong><br>${escMultiline(listing.instructions)}</div>`
      : '';
    if (b.driver_email) jobs.push(send(b.driver_email, `✅ Parking booked — ${title}`,
      `<h2 style="font-family:system-ui">Booking confirmed</h2>${findIt}${gateWarning}`
      + `<h3 style="font-family:system-ui;margin:18px 0 4px;font-size:15px">Your booking</h3>${bookingRows('')}`
      + `${receiptRows()}${offerHtml}`
      + `<p style="font-family:system-ui;color:#64748b;font-size:12px">Cancel 24h+ before the start for a full refund of the parking price (the driver service fee is non-refundable); after that it's non-refundable. You park at your own risk — see our Terms.</p>`));
    // The host's email is what a volunteer marshal actually stands in the car
    // park holding, so the registration goes at the TOP, big — not buried in a
    // table under the address. Asked for directly by a host committee: "this is
    // how we know who has booked and paid so we can direct them to their space."
    const APP = process.env.APP_URL || 'https://parkeasy.uk';
    const regBlock = b.vehicle_reg
      ? `<div style="font-family:system-ui;margin:12px 0;padding:14px;border:2px solid #2ED3C6;border-radius:10px;background:#f0fdfa;text-align:center">
           <div style="font-size:12px;color:#0f766e;letter-spacing:.12em;font-weight:700">VEHICLE REGISTRATION</div>
           <div style="font-size:26px;font-weight:800;letter-spacing:.12em;color:#083344;margin-top:4px">${b.vehicle_reg}</div>
           <div style="font-size:12px;color:#64748b;margin-top:4px">Look for this car — it's the one that has paid.</div>
         </div>`
      : `<p style="font-family:system-ui;color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 12px">No registration was given for this booking.</p>`;
    const manageBtn = `<p style="font-family:system-ui;margin:16px 0">
        <a href="${APP}/?tab=spaces" style="background:#2ED3C6;color:#06231f;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:24px;display:inline-block">View all your bookings →</a>
      </p>
      <p style="font-family:system-ui;color:#64748b;font-size:12px">Every booking, with its registration and arrival time, is in the app under <strong>Spaces → Your bookings</strong>. You can also subscribe to your bookings calendar there so they appear alongside everything else in your diary.</p>`;
    if (listing?.contact_email) jobs.push(send(listing.contact_email, `🅿️ Your space was booked — ${title}${b.vehicle_reg ? ` (${b.vehicle_reg})` : ''}`,
      `<h2 style="font-family:system-ui">You've got a booking</h2>${regBlock}${rows(`<tr><td style="padding:4px 10px;color:#64748b">You receive</td><td style="padding:4px 10px"><strong>${gbp(b.booking_price_pence - (b.application_fee_pence - b.service_fee_pence))}</strong> (after 15% fee), paid out weekly by Stripe.</td></tr>`)}${manageBtn}`));
    if (FOUNDER) jobs.push(send(FOUNDER, `💷 New ParkEasy booking — ${title}`, rows()));
    await Promise.all(jobs);
  } catch (e) { console.error('sendBookingEmails', e); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!KEY || !WEBHOOK_SECRET || !URL_ || !SERVICE) return res.status(500).json({ error: 'Webhook not configured' });

  const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  let event;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(raw, sig, WEBHOOK_SECRET);
  } catch (e) {
    console.error('stripe webhook signature verification failed', e.message);
    return res.status(400).json({ error: `Webhook signature verification failed` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const s = event.data.object;
        if (!s.metadata?.pass_id && !s.metadata?.listing_id) {
          // No booking/pass metadata → a Premium purchase via a Stripe payment
          // link. Link it to the buyer's ParkEasy account by email so Premium
          // follows them across devices (synced by fetchPromoStatus on login).
          await grantPremiumFromPaymentLink(svc, URL_, s).catch(e => console.error('premium link', e));
          break;
        }
        if (s.metadata?.pass_id) {
          // Season-pass purchase → credit the pass (idempotent on session id).
          await fetch(`${URL_}/rest/v1/pass_purchases?on_conflict=stripe_session_id`, {
            method: 'POST', headers: { ...svc, Prefer: 'resolution=ignore-duplicates' },
            body: JSON.stringify({
              pass_id: s.metadata.pass_id, driver_id: s.metadata.driver_id,
              stripe_session_id: s.id, stripe_payment_intent_id: s.payment_intent || null,
              credits_remaining: parseInt(s.metadata.num_credits || '0', 10) || 0,
            }),
          }).catch(() => {});
        } else {
          await markBooking(svc, URL_, s.id, { status: 'paid', stripe_payment_intent: s.payment_intent || null });
          await sendBookingEmails(svc, URL_, s.id);
        }
        break;
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const s = event.data.object;
        await markBooking(svc, URL_, s.id, { status: 'failed' });
        break;
      }
      case 'account.updated': {
        await syncHostAccount(stripe, svc, URL_, event.data.object.id);
        break;
      }
      case 'capability.updated': {
        const accountId = event.data.object.account;
        if (accountId) await syncHostAccount(stripe, svc, URL_, accountId);
        break;
      }
      case 'invoice.paid': {
        // Subscription renewal → extend account-linked Premium by a month.
        // (Requires the invoice.paid event ticked on the Stripe webhook.)
        const inv = event.data.object;
        const email = (inv.customer_email || inv.customer_details?.email || '').trim().toLowerCase();
        // Duration from what they actually paid: annual invoices shouldn't be
        // treated as a month.
        const renewalDays = (inv.amount_paid || 0) < 1000 ? 35 : 366;
        if (email) await grantPremiumByEmail(svc, URL_, email, renewalDays).catch(e => console.error('renewal grant', e));
        break;
      }
      case 'customer.subscription.deleted': {
        // The subscription has actually ended (for a cancel-at-period-end,
        // Stripe sends this AT the period end, not when they clicked cancel).
        // Without this, expires_at was written once at purchase and never
        // revoked: cancel your subscription and you keep Premium forever.
        const sub = event.data.object;
        let email = (sub.customer_email || '').trim().toLowerCase();
        if (!email && sub.customer) {
          try {
            const cust = await stripe.customers.retrieve(sub.customer);
            email = (cust?.email || '').trim().toLowerCase();
          } catch (e) { console.error('subscription.deleted: customer lookup', e.message); }
        }
        if (email) await revokePremiumByEmail(svc, URL_, email).catch(e => console.error('revoke', e));
        break;
      }
      case 'payout.paid':
      case 'payout.failed':
        // Reserved for host payout visibility in a later dashboard.
        break;
      default:
        break;
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('stripe webhook handler error', e);
    // 500 tells Stripe to retry.
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
