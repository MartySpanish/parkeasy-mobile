// POST /api/webhooks/stripe — Stripe's server-to-server notifications.
// Verifies the signature against the raw body, then syncs state into Supabase:
//   • checkout.session.completed / async_payment_succeeded  → booking paid
//     (or, when metadata.kind is car_wash, the wash request is confirmed —
//      checked first, because a wash has no bookings row to mark)
//   • checkout.session.async_payment_failed / expired        → booking failed
//   • account.updated / capability.updated                   → host_accounts state
//   • payout.paid / payout.failed                            → logged (future host UI)
//
//   • invoice.paid                                            → Premium renewal
//   • invoice.paid / payment_failed / subscription.updated|deleted, when the
//     subscription belongs to a corporate permit block → block status + the
//     invoice cache behind operator_settlements. Checked FIRST in every one of
//     those cases, so a company's parking invoice never grants or revokes a
//     consumer Premium subscription.
// Supabase is a cache; Stripe is the source of truth.
import Stripe from 'stripe';
import { hostEmails } from '../_hostEmails.js';
import { hostBookingEmail } from '../_emails/hostBooking.js';
import { bccFor } from '../_bcc.js';

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

// ── ParkEasy for Business ────────────────────────────────────────────────────
// The permit block behind a Stripe subscription, or null if this subscription
// has nothing to do with corporate permits.
//
// EVERY CORPORATE CASE BELOW CALLS THIS FIRST, and that is not tidiness. The
// existing invoice.paid handler grants Premium to whoever the invoice was
// emailed to — so without this lookup, invoicing a company £300 for parking
// permits would quietly hand their finance department a Premium subscription,
// and cancelling that subscription would revoke it again. Corporate billing and
// consumer Premium share an event type and share nothing else.
async function corporateBlockFor(svc, URL_, subscriptionId) {
  if (!subscriptionId) return null;
  try {
    const r = await fetch(
      `${URL_}/rest/v1/corporate_permit_blocks?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=*`,
      { headers: svc },
    );
    if (!r.ok) return null;
    return (await r.json())?.[0] || null;
  } catch { return null; }
}

// Stripe is the source of truth for whether a company is paying; the block row
// is a cache of that. A block that is not 'active' issues no permits — see
// claim_permit(), which refuses on status.
const BLOCK_STATUS_FOR = {
  active: 'active', trialing: 'active',
  past_due: 'paused', unpaid: 'paused', paused: 'paused', incomplete: 'paused',
  canceled: 'cancelled', incomplete_expired: 'cancelled',
};

// ── Partner subscriptions (F3) ──────────────────────────────────────────────
//
// A partner pays £25 or £60 a month for a card. The tier travels in the
// subscription's metadata, set when the checkout link is created, rather than
// being inferred from the price id — a price can be swapped or duplicated in
// the Stripe dashboard, and a partner silently dropping from sponsored to
// featured because somebody made a new price is the kind of bug nobody finds
// until the partner does.
const PARTNER_GRACE_DAYS = 7;

async function partnerForSubscription(svc, URL_, subscriptionId) {
  if (!subscriptionId) return null;
  try {
    const r = await fetch(`${URL_}/rest/v1/partners?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=*`, { headers: svc });
    if (!r.ok) return null;
    return (await r.json())?.[0] || null;
  } catch { return null; }
}

async function patchPartner(svc, URL_, partnerId, patch) {
  const r = await fetch(`${URL_}/rest/v1/partners?id=eq.${encodeURIComponent(partnerId)}`, {
    method: 'PATCH', headers: svc, body: JSON.stringify(patch),
  });
  if (!r.ok) console.error('partner patch failed', partnerId, r.status, await r.text().catch(() => ''));
  return r.ok;
}

async function syncCorporateBlock(svc, URL_, blockId, patch) {
  await fetch(`${URL_}/rest/v1/corporate_permit_blocks?id=eq.${encodeURIComponent(blockId)}`, {
    method: 'PATCH', headers: svc,
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

// Cache the invoice so public.operator_settlements has something to sum. Upsert
// on the Stripe id, because Stripe re-sends events and an invoice counted twice
// is an operator paid twice.
async function recordCorporateInvoice(svc, URL_, inv, block) {
  await fetch(`${URL_}/rest/v1/corporate_invoices?on_conflict=stripe_invoice_id`, {
    method: 'POST', headers: { ...svc, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      corporate_account_id: block.corporate_account_id,
      corporate_permit_block_id: block.id,
      stripe_invoice_id: inv.id,
      stripe_subscription_id: inv.subscription || null,
      amount_due_pence: inv.amount_due ?? 0,
      amount_paid_pence: inv.amount_paid ?? 0,
      currency: inv.currency || 'gbp',
      status: inv.status || 'open',
      period_start: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
      period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
      hosted_invoice_url: inv.hosted_invoice_url || null,
      updated_at: new Date().toISOString(),
    }),
  });
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
// A driveway host has a request waiting, and a driver is holding an
// authorisation that lapses in 24 hours. Both need telling, and the host needs
// the two buttons in the email itself — a host who has to find the app, log in
// and hunt for a queue is a host who answers tomorrow.
//
// The links carry the booking's access_token, which is already how the
// cancellation page authenticates without a login. Nothing in the email
// identifies the driver beyond what the host needs to decide: when, how long,
// and the plate.
async function sendApprovalRequestEmails(svc, URL_, sessionId) {
  const KEYR = process.env.RESEND_API_KEY;
  const FROM = process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>';
  const APP = process.env.APP_URL || 'https://parkeasy.uk';
  if (!KEYR || !sessionId) return;

  const br = await fetch(`${URL_}/rest/v1/bookings?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=*`, { headers: svc });
  const b = (await br.json())?.[0];
  if (!b) return;
  let listing = null;
  if (b.listing_id) {
    const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${b.listing_id}&select=title,address,contact_email,owner_email`, { headers: svc });
    listing = (await lr.json())?.[0] || null;
  }
  const hostTo = listing?.contact_email || listing?.owner_email;
  const when = b.starts_at
    ? new Date(b.starts_at).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'a time to be confirmed';
  const deadline = b.approval_deadline
    ? new Date(b.approval_deadline).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : 'in 24 hours';
  const link = (answer) =>
    `${APP}/api/bookings/respond?token=${encodeURIComponent(b.access_token)}&answer=${answer}`;

  const send = async (to, subject, html) => {
    if (!to) return;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${KEYR}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [to], bcc: bccFor([to]), subject, html }),
      });
      if (!r.ok) console.error('EMAIL FAILED', r.status, to, subject, await r.text().catch(() => ''));
    } catch (e) { console.error('EMAIL FAILED', to, subject, String(e)); }
  };

  await send(hostTo, `Parking request — ${when}`,
    `<p>Someone would like to park at <strong>${listing?.title || 'your space'}</strong>.</p>
     <ul>
       <li><strong>When:</strong> ${when}</li>
       <li><strong>For:</strong> ${b.duration_hours || 1} hour(s)</li>
       <li><strong>Vehicle:</strong> ${b.vehicle_reg || 'not given'}</li>
     </ul>
     <p><strong>Their card has been authorised, not charged.</strong> Nothing is taken
        unless you accept, and nothing is taken at all if you say no.</p>
     <p>
       <a href="${link('accept')}" style="background:#2ED3C6;color:#06231f;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Accept</a>
       &nbsp;&nbsp;
       <a href="${link('decline')}" style="background:#eee;color:#333;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Decline</a>
     </p>
     <p style="color:#666;font-size:13px">If you do not answer by ${deadline} the request
        lapses on its own and the driver is not charged.</p>`);

  await send(b.driver_email, `Request sent — ${listing?.title || 'your parking'}`,
    `<p>Your request for <strong>${listing?.title || 'the space'}</strong> on ${when} has gone to the host.</p>
     <p><strong>You have not been charged.</strong> Your card is authorised only —
        we take the payment if the host accepts, and release it if they do not.</p>
     <p style="color:#666;font-size:13px">Most hosts answer within a few hours. If nobody
        answers by ${deadline} the request lapses and the hold comes off automatically.</p>`);
}

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
      const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${b.listing_id}&select=title,address,contact_email,owner_email,instructions,price_per_hour,price_per_day,gate_opens_at,gate_closes_at,overnight_fee_pence,wash_enabled,wash_days`, { headers: svc });
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

    // The wash offer, in the confirmation email as well as on the confirmation
    // screen. Not a second product being pushed: somebody who has just paid for
    // parking on a Monday is exactly the person for whom "while it's sitting
    // there anyway" is a good idea, and the email is what they still have open
    // when they think of it.
    //
    // ParkEasy is a booking AGENT for this — the wash is carried out by an
    // independent contractor and the contract is with them. That sentence goes
    // in the email too, not just in the app.
    let washHtml = '';
    try {
      if (listing?.wash_enabled) {
        const days = Array.isArray(listing.wash_days) && listing.wash_days.length ? listing.wash_days : [1];
        const NAMES = ['', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
        const dayText = days.map(d => NAMES[d]).filter(Boolean).join(' and ') || 'selected days';
        washHtml = `<div style="font-family:system-ui;margin-top:14px;padding:12px 14px;border:1px solid #99f6e4;border-radius:10px;background:#f0fdfa">
            <strong>✨ Want your car washed while it's parked?</strong>
            <div style="margin-top:4px">Standard car £30 · Large/SUV/4×4 £40 · Van/7-seater £50. ${dayText} at ${title}, and requests close 24 hours before.</div>
            <div style="margin-top:6px"><a href="https://parkeasy.uk/" style="color:#0f766e;font-weight:700">Add a wash in the app →</a></div>
            <div style="margin-top:8px;color:#64748b;font-size:12px">ParkEasy arranges the wash with an independent contractor. The wash itself is a contract between you and them — ParkEasy is booking it, not carrying it out.</div>
          </div>`;
      }
    } catch { /* wash columns may not exist until the migration runs */ }
    // `.catch(() => {})` used to swallow everything here, including a 4xx from
    // Resend. When the club said they never knew about the 8 August bookings
    // there was no way to tell from the logs whether the email had gone out at
    // all — the webhook returned 200 either way. A failed host email is a
    // driver at a locked gate, so it gets logged loudly enough to find.
    const send = async (to, subject, html) => {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${KEYR}`, 'Content-Type': 'application/json' },
          // bccFor returns nothing when `to` is already the founder, so the
          // summary below does not arrive twice.
          body: JSON.stringify({ from: FROM, to: [to], bcc: bccFor([to]), subject, html }),
        });
        if (!r.ok) console.error('EMAIL FAILED', r.status, to, subject, await r.text().catch(() => ''));
        else console.log('email sent', to, subject);
      } catch (e) { console.error('EMAIL FAILED', to, subject, String(e)); }
    };
    const jobs = [];
    // Driver's post-payment anxiety is "will I find the spot" — arrival
    // instructions go FIRST, receipt second.
    const findIt = listing?.instructions
      ? `<div style="font-family:system-ui;margin:10px 0;padding:12px 14px;border-left:4px solid #2ED3C6;background:#f0fdfa;border-radius:8px"><strong>📍 How to find your space</strong><br>${escMultiline(listing.instructions)}</div>`
      : '';
    if (b.driver_email) jobs.push(send(b.driver_email, `✅ Parking booked — ${title}`,
      `<h2 style="font-family:system-ui">Booking confirmed</h2>${findIt}${gateWarning}`
      + `<h3 style="font-family:system-ui;margin:18px 0 4px;font-size:15px">Your booking</h3>${bookingRows('')}`
      + `${receiptRows()}${offerHtml}${washHtml}`
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
    // Both the day-to-day contact AND the account that takes the payout — at
    // a club those are two different people, and the one reconciling the bank
    // transfer is the one who most needs to see the booking. See _hostEmails.js.
    //
    // The content is built in ../_emails/hostBooking.js, which exists because
    // this email failed on 8 August: it told the club a booking had happened
    // and never told anybody to open the gates.
    const hostMail = hostBookingEmail({
      listing, booking: b, title, ref, regBlock, detailRows: bookingRows(''), gbp, esc, appUrl: APP,
    });
    for (const to of hostEmails(listing)) jobs.push(send(to, hostMail.subject, hostMail.html));
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
        // A partner subscribing to a card. MUST be handled before the Premium
        // fallback below, which claims every session carrying neither a pass
        // nor a listing — a barber paying £25 for a listing would otherwise be
        // granted Premium instead.
        //
        // This is also the only moment the subscription id exists: in
        // subscription mode Stripe creates it at payment, not when the checkout
        // link is made, so the link endpoint has nothing to record and the
        // webhook that fires on the first invoice would find no partner.
        if (s.metadata?.partner_id) {
          await patchPartner(svc, URL_, s.metadata.partner_id, {
            stripe_subscription_id: s.subscription || null,
            stripe_customer_id: s.customer || null,
          });
          break;
        }
        if (!s.metadata?.pass_id && !s.metadata?.listing_id) {
          // No booking/pass metadata → a Premium purchase via a Stripe payment
          // link. Link it to the buyer's ParkEasy account by email so Premium
          // follows them across devices (synced by fetchPromoStatus on login).
          await grantPremiumFromPaymentLink(svc, URL_, s).catch(e => console.error('premium link', e));
          break;
        }
        // A car wash. Not a booking and not a pass: 100% ParkEasy, no host
        // share, so it must not fall into markBooking below — which would look
        // for a bookings row that does not exist and silently do nothing.
        if (s.metadata?.kind === 'car_wash') {
          await fetch(`${URL_}/rest/v1/wash_requests?stripe_session_id=eq.${encodeURIComponent(s.id)}`, {
            method: 'PATCH', headers: svc,
            body: JSON.stringify({
              status: 'confirmed',
              stripe_payment_intent: s.payment_intent || null,
              updated_at: new Date().toISOString(),
            }),
          }).catch(e => console.error('wash confirm', e));
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
        } else if (s.metadata?.needs_approval === 'true') {
          // A driveway. The card is AUTHORISED, not charged: this is a request
          // until the host answers it, so the booking must not be marked paid
          // and the driver must not get a confirmation for a space nobody has
          // agreed to give them.
          //
          // The database refuses status 'paid' on an approval booking with no
          // host_responded_at (bookings_host_approval_chk), so a future edit
          // that sends this down the wrong branch fails loudly rather than
          // quietly charging somebody.
          await markBooking(svc, URL_, s.id, {
            status: 'awaiting_host',
            stripe_payment_intent: s.payment_intent || null,
          });
          await sendApprovalRequestEmails(svc, URL_, s.id).catch(e => console.error('approval request email', e));
        } else {
          await markBooking(svc, URL_, s.id, { status: 'paid', stripe_payment_intent: s.payment_intent || null });
          await sendBookingEmails(svc, URL_, s.id);
        }
        break;
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const s = event.data.object;
        if (s.metadata?.kind === 'car_wash') {
          await fetch(`${URL_}/rest/v1/wash_requests?stripe_session_id=eq.${encodeURIComponent(s.id)}`, {
            method: 'PATCH', headers: svc,
            body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() }),
          }).catch(() => {});
          break;
        }
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
        const inv = event.data.object;
        // ParkEasy for Business first. A corporate permit invoice must NEVER
        // fall through to the Premium grant below it.
        const block = await corporateBlockFor(svc, URL_, inv.subscription);
        if (block) {
          await recordCorporateInvoice(svc, URL_, inv, block);
          await syncCorporateBlock(svc, URL_, block.id, { status: 'active' });
          break;
        }
        // A partner's monthly card. Must not fall through to the Premium grant
        // below either — a barber paying for a listing is not buying Premium.
        const paidPartner = await partnerForSubscription(svc, URL_, inv.subscription);
        if (paidPartner) {
          const tier = inv.lines?.data?.[0]?.metadata?.tier
            || inv.subscription_details?.metadata?.tier
            || paidPartner.tier;
          await patchPartner(svc, URL_, paidPartner.id, {
            tier: ['featured', 'sponsored'].includes(tier) ? tier : paidPartner.tier,
            // sold_at is the FIRST payment and never moves; renewal_due_at is
            // the next one. Overwriting sold_at on every renewal would lose the
            // one date that says how long they have been a customer.
            ...(paidPartner.sold_at ? {} : { sold_at: new Date().toISOString() }),
            renewal_due_at: inv.lines?.data?.[0]?.period?.end
              ? new Date(inv.lines.data[0].period.end * 1000).toISOString() : null,
            // A successful payment clears the failure clock outright.
            payment_failed_at: null,
            active: true,
          });
          break;
        }
        // Subscription renewal → extend account-linked Premium by a month.
        // (Requires the invoice.paid event ticked on the Stripe webhook.)
        const email = (inv.customer_email || inv.customer_details?.email || '').trim().toLowerCase();
        // Duration from what they actually paid: annual invoices shouldn't be
        // treated as a month.
        const renewalDays = (inv.amount_paid || 0) < 1000 ? 35 : 366;
        if (email) await grantPremiumByEmail(svc, URL_, email, renewalDays).catch(e => console.error('renewal grant', e));
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const block = await corporateBlockFor(svc, URL_, inv.subscription);
        if (block) {
          await recordCorporateInvoice(svc, URL_, inv, block);
          // PAUSED, NOT CANCELLED, and the difference matters on a Monday
          // morning. A paused block issues no NEW permits, but the claims
          // already made stand — staff who planned their week around a permit
          // are not turned away at the barrier because an invoice is four days
          // late. Cancelling is a decision somebody makes, not a side effect of
          // a failed direct debit.
          await syncCorporateBlock(svc, URL_, block.id, { status: 'paused' });
          break;
        }
        // A partner's card payment failed.
        //
        // NOT dropped on the first failure — a card expiring on a Tuesday is
        // not a cancellation, and pulling a barber's listing over one retry is
        // how you lose the relationship rather than the payment. The clock
        // starts on the first failure and the tier only falls back to 'listed'
        // once the grace window has passed, which Stripe's retry schedule gives
        // us several attempts inside.
        const failedPartner = await partnerForSubscription(svc, URL_, inv.subscription);
        if (failedPartner) {
          const firstFailure = failedPartner.payment_failed_at
            ? Date.parse(failedPartner.payment_failed_at) : Date.now();
          const overdueDays = (Date.now() - firstFailure) / 86400000;
          if (overdueDays >= PARTNER_GRACE_DAYS) {
            await patchPartner(svc, URL_, failedPartner.id, { tier: 'listed' });
            console.log(`partner ${failedPartner.slug}: ${Math.round(overdueDays)} days overdue — dropped to listed`);
          } else if (!failedPartner.payment_failed_at) {
            await patchPartner(svc, URL_, failedPartner.id, { payment_failed_at: new Date().toISOString() });
            console.log(`partner ${failedPartner.slug}: payment failed, ${PARTNER_GRACE_DAYS}-day grace started`);
          }
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const block = await corporateBlockFor(svc, URL_, sub.id);
        if (block) {
          const status = BLOCK_STATUS_FOR[sub.status];
          const patch = {};
          if (status) patch.status = status;
          // Quantity changed in the Stripe dashboard rather than in ParkEasy.
          // Mirror it, but never below the claims already made: the database
          // trigger refuses that update, which is exactly right — a quota cut
          // under next Tuesday's fifteen claims is discovered on Tuesday, at
          // the barrier. The PATCH failing here is the safe outcome, and it
          // leaves Stripe and ParkEasy visibly disagreeing rather than
          // silently overselling.
          const qty = sub.items?.data?.[0]?.quantity;
          if (Number.isInteger(qty) && qty > 0 && qty !== block.permit_count) patch.permit_count = qty;
          if (Object.keys(patch).length) {
            await syncCorporateBlock(svc, URL_, block.id, patch)
              .catch(e => console.error('corporate block sync refused', e.message));
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        // The subscription has actually ended (for a cancel-at-period-end,
        // Stripe sends this AT the period end, not when they clicked cancel).
        // Without this, expires_at was written once at purchase and never
        // revoked: cancel your subscription and you keep Premium forever.
        const sub = event.data.object;
        // Again: a corporate permit subscription ending must not revoke a
        // Premium entitlement belonging to whoever the invoices went to.
        const corporateBlock = await corporateBlockFor(svc, URL_, sub.id);
        if (corporateBlock) {
          await syncCorporateBlock(svc, URL_, corporateBlock.id, { status: 'cancelled' });
          break;
        }
        // A partner cancelled. The card comes down, but the ROW STAYS: their
        // name, pin and 2,000-odd impression history are still worth having,
        // and a cancelled partner who comes back should not have to be
        // re-entered from scratch.
        const goneP = await partnerForSubscription(svc, URL_, sub.id);
        if (goneP) {
          await patchPartner(svc, URL_, goneP.id, { tier: 'listed', stripe_subscription_id: null });
          console.log(`partner ${goneP.slug}: subscription ended — back to listed`);
          break;
        }
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
