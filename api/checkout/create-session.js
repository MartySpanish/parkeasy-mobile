// POST /api/checkout/create-session — create a hosted Stripe Checkout Session
// for a booking (destination charge). ParkEasy is merchant of record; on
// success Stripe transfers 85% of the booking price to the host's connected
// account and keeps 15% + the driver service fee as the application fee.
//
// Money rules live in api/_pricing.js — that module is the single source of
// truth and this endpoint must not re-derive any of it. In short:
//   booking_price   = price_per_hour * duration
//   service_fee     = 15% of booking_price, floored at 99p, capped at £3.50
//   driver pays     = booking_price + service_fee
//   application_fee = round(booking_price * 0.15) + service_fee   (ParkEasy)
//   host receives   = booking_price - round(booking_price * 0.15) = 85%
//
// The price is ALWAYS read from the DB, never from the client. TEST MODE ONLY.
import Stripe from 'stripe';
import { MIN_BOOKING_PENCE, priceBreakdown } from '../_pricing.js';

const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.STRIPE_SECRET_KEY;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const APP_URL = process.env.APP_URL || 'https://parkeasy.uk';

  if (!KEY) return res.status(500).json({ error: 'Stripe not configured (STRIPE_SECRET_KEY)' });
  if (!KEY.startsWith('sk_test_') && process.env.STRIPE_LIVE_ENABLED !== 'true') {
    console.error('checkout BLOCKED: live STRIPE_SECRET_KEY but STRIPE_LIVE_ENABLED is not "true". '
      + 'Set STRIPE_LIVE_ENABLED=true in the Vercel project to take live bookings.');
    return res.status(403).json({ error: 'Card payments aren’t switched on just yet. Nothing has been charged — please try again shortly.' });
  }
  if (!URL_ || !SERVICE) return res.status(500).json({ error: 'Supabase not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const listingId = body?.listingId;
  const durationHours = Math.max(1, Math.min(24, parseInt(body?.durationHours || 1, 10)));
  const startsAt = body?.startsAt || null;
  const marketingOptIn = body?.marketingOptIn === true;
  // Recurring bookings: same slot, weekly, paid once up front. Each week is
  // still an ordinary booking row (same cancellation rules per occurrence).
  const repeatWeeks = Math.max(1, Math.min(12, parseInt(body?.repeatWeeks || 1, 10)));
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' });

  // Vehicle registration — the host uses this to match a car to a paid booking.
  // Normalised uppercase without separators so 'ab12 cde' and 'AB12CDE' compare
  // equal when a marshal is checking a plate against their list. Kept permissive
  // (UK current, older UK and Irish plates all differ) — a driver blocked from
  // paying by an over-strict pattern is a lost booking, and a wrong plate is a
  // conversation on the day, not a payment failure.
  // Required for new bookings, and enforced HERE rather than trusting the
  // client — the button being disabled is a courtesy, not a control.
  const vehicleReg = String(body?.vehicleReg || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (!vehicleReg) {
    return res.status(400).json({ error: 'Please enter your vehicle registration so the host knows it’s you when you arrive.' });
  }
  if (vehicleReg.length < 2) {
    return res.status(400).json({ error: 'That vehicle registration looks too short — please check it.' });
  }

  // Optional driver identity (guest checkout is allowed per Terms §3.1).
  let driver = null;
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (jwt && ANON) {
    try {
      const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
      if (u.ok) driver = await u.json();
    } catch { /* treat as guest */ }
  }

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  try {
    const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(listingId)}&select=*`, { headers: svc });
    const listing = (await lr.json())?.[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.status !== 'active') return res.status(400).json({ error: 'This listing is not currently bookable' });

    // Day-priced sites. Belfast Royal Academy is £15 per vehicle per day for a
    // fixed 8am–5pm window — there is no hourly rate and there shouldn't be:
    // letting someone take a 64-space school car park for two hours at £3.33
    // would undercut the rate the Academy actually agreed. So when a listing is
    // day-priced, durationHours is read as a number of DAYS and the slot is the
    // gate window rather than an arbitrary span.
    //
    // A listing may now carry BOTH rates — a club that will sell you an hour
    // for the shops or the whole matchday. When both exist the driver's choice
    // decides, and it arrives as `unit`. It is read as an enum with 'hour' as
    // the default, never trusted as a price: the amount still comes from the
    // listing row, so the worst a forged `unit` can do is buy the OTHER rate
    // this host published, at that rate's own terms.
    const hasHour = Number(listing.price_per_hour) > 0;
    const hasDay  = Number(listing.price_per_day)  > 0;
    if (!hasHour && !hasDay) {
      return res.status(400).json({ error: 'This listing has no price set' });
    }
    // Only a listing that HAS a day rate can be booked by the day, and a
    // listing with no hourly rate can only ever be booked by the day.
    const wantsDay  = String(req.body?.unit || '').toLowerCase() === 'day';
    const dayPriced = hasDay && (!hasHour || wantsDay);
    let pricePerHour = Number(listing.price_per_hour);
    let pricePerDay  = Number(listing.price_per_day);

    // Event pricing: a per-date override replaces the base hourly price.
    if (startsAt) {
      try {
        const dateStr = String(startsAt).slice(0, 10);
        const ovr = await fetch(`${URL_}/rest/v1/listing_price_overrides?listing_id=eq.${listing.id}&override_date=eq.${dateStr}&select=price_pence`, { headers: svc });
        const o = ovr.ok ? (await ovr.json())?.[0] : null;
        if (o?.price_pence > 0) {
          if (dayPriced) pricePerDay = o.price_pence / 100;
          else pricePerHour = o.price_pence / 100;
        }
      } catch { /* fall back to base price */ }
    }

    // ── HOW THIS LISTING GETS PAID ───────────────────────────────────────────
    // Two models, and the listing says which.
    //
    //   'connect' — the default, and right for a club or a driveway. A
    //     destination charge: Stripe splits the payment at the moment it is
    //     taken and the host's 85% lands in their own account. Needs a
    //     connected account with transfers active, so the gate below is real.
    //
    //   'invoice' — a plain charge into ParkEasy's own balance, settled with
    //     the operator afterwards. No Connect account, no destination, no
    //     application fee. This is how a commercial operator with a finance
    //     department wants to be dealt with, and it is the same arrangement
    //     corporate pooled permits already run on (public.operator_settlements).
    //
    // ⚠️ INVOICE MODE PAYS NOBODY BY ITSELF. The whole amount stays with
    // ParkEasy and a human has to send the operator their share. What is owed
    // is snapshotted onto the booking below and totalled in
    // public.booking_settlements. Nothing else will remind anyone.
    const invoiceMode = listing.payout_mode === 'invoice';
    let host = null;
    if (invoiceMode) {
      // The share is a negotiated commercial term with no sensible default, so
      // an invoice-mode listing missing it is a configuration mistake, not a
      // reason to guess. The DB constraint should have stopped this; refuse
      // rather than take money we cannot account for.
      if (listing.operator_share_pct == null) {
        return res.status(409).json({ error: 'This car park isn’t set up for payouts yet, so it can’t be booked. Please try again later.' });
      }
    } else {
      // The host must have completed Connect onboarding (transfers active).
      const hr = await fetch(`${URL_}/rest/v1/host_accounts?host_id=eq.${listing.owner_id}&select=*`, { headers: svc });
      host = (await hr.json())?.[0];
      if (!host?.stripe_account_id || !host.transfers_active) {
        return res.status(409).json({ error: 'This host hasn’t finished setting up payouts yet, so the space can’t be booked.' });
      }
    }

    // Double-booking prevention. A start time is required so we can check the
    // requested window against existing bookings for this listing.
    if (!startsAt) return res.status(400).json({ error: 'Please choose a start date and time' });
    const startMs = Date.parse(startsAt);
    if (Number.isNaN(startMs)) return res.status(400).json({ error: 'Invalid start time' });
    const spaces = Math.max(1, listing.spaces || 1);
    const PENDING_TTL_MS = 30 * 60000;
    const now = Date.now();
    const WEEK_MS = 7 * 86400000;
    // On a day-priced site the slot is the gate window, not an arbitrary span:
    // durationHours carries the number of DAYS, and each day runs from
    // gate_opens_at to gate_closes_at. A driver books "Tuesday", not "9am–6pm".
    const days = dayPriced ? Math.max(1, Math.min(14, Math.round(durationHours))) : 0;
    const spanMs = dayPriced
      ? (() => {
          const [oh, om] = String(listing.gate_opens_at  || '08:00').split(':').map(Number);
          const [ch, cm] = String(listing.gate_closes_at || '17:00').split(':').map(Number);
          const mins = ((ch * 60 + (cm || 0)) - (oh * 60 + (om || 0)));
          // A same-day window; if the times are odd, fall back to a full day.
          return (mins > 0 ? mins : 9 * 60) * 60000;
        })()
      : durationHours * 3600000;

    // ── Dates the site has actually agreed to ────────────────────────────────
    // Four rules, because a signed licence is not a weekly pattern. Belfast
    // Royal Academy: term from 2 August, Monday to Friday, plus Saturday 8
    // August ONLY, and the Academy may block out any date. As a plain weekday
    // list that reads "every Saturday forever", which would have us selling a
    // locked car park on 15 August in breach of clause 3.
    //
    // Order matters: blocked_dates wins over everything, then extra_dates
    // rescues a weekday that isn't in the weekly pattern.
    {
      const allowed = Array.isArray(listing.available_days) && listing.available_days.length
        ? new Set(listing.available_days.map(Number)) : null;
      const extra   = new Set((listing.extra_dates   || []).map(String));
      const blocked = new Set((listing.blocked_dates || []).map(String));
      const from    = listing.available_from  || null;
      const until   = listing.available_until || null;
      const names = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
      // yyyy-mm-dd as the date reads in Belfast, not in UTC.
      const ymd = (ms) => new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(ms));

      const spans = dayPriced ? days : 1;
      for (let i = 0; i < repeatWeeks; i++) {
        for (let k = 0; k < spans; k++) {
          const ms = startMs + i * WEEK_MS + k * 86400000;
          const day = ymd(ms);
          const local = new Date(new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London' }));
          const iso = local.getDay() === 0 ? 7 : local.getDay();   // JS Sun=0 → ISO Sun=7
          const pretty = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

          if (blocked.has(day)) {
            return res.status(400).json({ error: `This car park is closed on ${pretty}. Please pick a different date.` });
          }
          if (from && day < from) {
            const fromPretty = new Date(`${from}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
            return res.status(400).json({ error: `This car park isn’t taking bookings until ${fromPretty}.` });
          }
          if (until && day > until) {
            const untilPretty = new Date(`${until}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
            return res.status(400).json({ error: `This car park isn’t taking bookings after ${untilPretty}.` });
          }
          if (allowed && !allowed.has(iso) && !extra.has(day)) {
            return res.status(400).json({ error: `This car park isn’t open on ${names[iso - 1]} ${pretty}. Please pick a different date.` });
          }
        }
      }
    }

    // Every occurrence must be free, or we'd take money for a slot we can't honour.
    const occurrences = [];
    for (let i = 0; i < repeatWeeks; i++) {
      const s0 = new Date(startMs + i * WEEK_MS).toISOString();
      const e0 = new Date(startMs + i * WEEK_MS + (dayPriced ? spanMs + (days - 1) * 86400000 : spanMs)).toISOString();
      const or = await fetch(`${URL_}/rest/v1/bookings?listing_id=eq.${listing.id}&status=in.(pending,paid)&starts_at=lt.${encodeURIComponent(e0)}&ends_at=gt.${encodeURIComponent(s0)}&select=status,created_at`, { headers: svc });
      const overlaps = or.ok ? await or.json() : [];
      const held = overlaps.filter(b => b.status === 'paid' || (now - Date.parse(b.created_at) < PENDING_TTL_MS)).length;
      if (held >= spaces) {
        return res.status(409).json({
          error: repeatWeeks > 1
            ? `Week ${i + 1} of that repeat is already booked. Try a different time, or fewer weeks.`
            : 'That time is already booked. Try a different time or duration.',
        });
      }
      occurrences.push({ starts_at: s0, ends_at: e0 });
    }
    const endsAtISO = occurrences[0].ends_at;

    const perWeekPence = dayPriced
      ? Math.round(pricePerDay * days * 100)
      : Math.round(pricePerHour * durationHours * 100);
    const bookingPricePence = perWeekPence * repeatWeeks;

    // Below the minimum the fixed part of the card fee makes the booking not
    // worth running. Checked against the FIRST week, not the series total, so
    // a repeat booking can't sneak a sub-minimum slot through by multiplying up.
    // A day-priced site is above the minimum by definition, and telling someone
    // to "book more hours" on a fixed-window day rate would be nonsense.
    if (!dayPriced && perWeekPence < MIN_BOOKING_PENCE) {
      const needHours = Math.ceil(MIN_BOOKING_PENCE / Math.max(1, Math.round(pricePerHour * 100)));
      return res.status(400).json({
        error: `Minimum booking is £${(MIN_BOOKING_PENCE / 100).toFixed(2)}. At £${pricePerHour.toFixed(2)}/hr that's ${needHours} hour${needHours !== 1 ? 's' : ''} — please book a bit longer.`,
      });
    }

    // Event day = the host has set a price override for that date. That IS what
    // an event day means in this product, so there is no separate flag to keep
    // in step. Fee goes 15% -> 20%; the host's 85% is untouched either way.
    let eventDay = false;
    try {
      const day = occurrences[0].starts_at.slice(0, 10);
      const ov = await fetch(`${URL_}/rest/v1/listing_price_overrides?listing_id=eq.${listing.id}&override_date=eq.${day}&select=price_pence`, { headers: svc });
      eventDay = ov.ok && ((await ov.json())?.length > 0);
    } catch { /* not an event day if we can't tell */ }

    // Overnight lock-in: a car left in after the gates close. Charged once per
    // series. How much of it we keep is a term of THIS listing's agreement, so
    // it is read from the row — Belfast Royal Academy's clause 5 says the fee is
    // paid to the Academy in full (rate 0), newer agreements are written at 15%.
    let surchargePence = 0;
    let overnight = false;
    if (listing.overnight_fee_pence > 0 && listing.gate_closes_at) {
      const end = new Date(occurrences[0].ends_at);
      const [gh, gm] = String(listing.gate_closes_at).split(':').map(Number);
      // Compare in Europe/London, since gate times are wall-clock local.
      const local = new Date(end.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
      const endMins = local.getHours() * 60 + local.getMinutes();
      if (endMins > (gh * 60 + (gm || 0))) {
        overnight = true;
        surchargePence = listing.overnight_fee_pence;
      }
    }

    // One driver service fee per booking series, not per week.
    //
    // Under the invoice model our share of the space price is whatever was
    // negotiated with the operator, not the standard 15%. Passing it through
    // priceBreakdown rather than doing the arithmetic here keeps the checkout
    // line items, the booking row and the settlement view reading from one
    // calculation — which is the entire reason _pricing.js exists.
    const money = priceBreakdown(bookingPricePence, process.env, {
      eventDay, surchargePence,
      surchargeCommissionRate: listing.overnight_fee_commission_rate,
      commissionRate: invoiceMode ? 1 - (Number(listing.operator_share_pct) / 100) : undefined,
    });
    const SERVICE_FEE_PENCE = money.serviceFeePence;
    const applicationFeePence = money.applicationFeePence;
    const totalPence = money.totalPence;
    // What we owe the operator once the money is in our balance. Zero under
    // connect, where Stripe has already moved it. hostReceivesPence is exactly
    // that figure — the space price less our cut, plus their share of any
    // overnight fee — so the two models stay one calculation.
    const operatorSharePence = invoiceMode ? money.hostReceivesPence : 0;

    // from_hotspot: whether this booking started at a free spot. Stripe metadata
    // values are strings, so it is read back with === 'true' below.
    const fromHotspot = body?.fromHotspot === true || body?.fromHotspot === 'true';
    const meta = {
      listing_id: listing.id, host_id: listing.owner_id,
      duration: String(durationHours), weeks: String(repeatWeeks),
      from_hotspot: String(fromHotspot),
    };

    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: driver?.email || undefined,
      line_items: [
        { price_data: { currency: 'gbp', product_data: { name: repeatWeeks > 1 ? `Parking — ${listing.title || 'space'} (${repeatWeeks} weekly bookings)` : `Parking — ${listing.title || 'space'}`, description: listing.address || undefined }, unit_amount: bookingPricePence }, quantity: 1 },
        { price_data: { currency: 'gbp', product_data: { name: eventDay ? 'Driver service fee (event day)' : 'Driver service fee' }, unit_amount: SERVICE_FEE_PENCE }, quantity: 1 },
        // Itemised so the driver sees exactly what the extra is for, and that
        // it belongs to the site rather than to us.
        ...(surchargePence > 0 ? [{
          price_data: {
            currency: 'gbp',
            product_data: {
              name: 'Overnight fee — vehicle left in after the gates close',
              description: `Paid in full to ${listing.title || 'the site'}`,
            },
            unit_amount: surchargePence,
          },
          quantity: 1,
        }] : []),
      ],
      // Invoice mode takes a PLAIN charge into ParkEasy's own balance: no
      // destination, no application fee. Stripe rejects both on a charge with
      // no connected account, and there is nowhere for them to point anyway.
      payment_intent_data: invoiceMode
        ? { metadata: meta }
        : {
            application_fee_amount: applicationFeePence,
            transfer_data: { destination: host.stripe_account_id },
            metadata: meta,
          },
      metadata: meta,
      expires_at: Math.floor(now / 1000) + 30 * 60,   // hold the slot for 30 min max
      success_url: `${APP_URL}/?booking=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/?booking=cancelled`,
    });

    // Record the pending booking(s); the webhook flips them to paid/failed.
    const recurrenceGroup = repeatWeeks > 1 ? crypto.randomUUID() : null;
    const rows = occurrences.map((occ, i) => ({
      listing_id: listing.id, host_id: listing.owner_id,
      driver_id: driver?.id || null, driver_email: driver?.email || null,
      starts_at: occ.starts_at, ends_at: occ.ends_at, duration_hours: durationHours, currency: 'gbp',
      // On EVERY occurrence, not just the first: a marshal checking week 7 of a
      // repeat booking needs the plate as much as week 1 does. (Money stays on
      // the first row only — that's a different concern.)
      vehicle_reg: vehicleReg,
      cancellation_deadline: new Date(Date.parse(occ.starts_at) - (parseInt(process.env.CANCEL_CUTOFF_HOURS || '24', 10)) * 3600000).toISOString(),
      // Money is recorded on the FIRST occurrence only, so totals and refunds
      // never double-count a series that was paid for once.
      amount_total_pence: i === 0 ? totalPence : 0,
      booking_price_pence: i === 0 ? bookingPricePence : 0,
      application_fee_pence: i === 0 ? applicationFeePence : 0,
      service_fee_pence: i === 0 ? SERVICE_FEE_PENCE : 0,
      // Recorded separately so a cancellation can hand it back. It is inside
      // amount_total_pence but is NOT ours — it belongs to the host, and it is
      // owed only if the car is actually left in overnight.
      surcharge_pence: i === 0 ? surchargePence : 0,
      stripe_session_id: i === 0 ? session.id : `${session.id}#${i}`,
      // Null under invoice mode, and that is the flag the refund path reads:
      // no destination means no transfer to reverse.
      stripe_destination: host?.stripe_account_id || null, status: 'pending',
      // Snapshotted, not looked up later. A listing's payout mode and the
      // operator's share can both change; what was owed on a booking already
      // taken cannot.
      payout_mode: invoiceMode ? 'invoice' : 'connect',
      operator_share_pence: i === 0 ? operatorSharePence : 0,
      marketing_opt_in: marketingOptIn,
      // On the first occurrence only, same rule as the money: a repeat series
      // is one conversion from one comparison card, and counting it seven times
      // would flatter the funnel it exists to measure.
      from_hotspot: i === 0 ? fromHotspot : false,
      recurrence_group: recurrenceGroup, recurrence_index: i,
    }));
    // The response here was previously ignored. If the insert failed we still
    // handed back the Stripe URL, so the driver paid and no booking row
    // existed — no confirmation, no host email, nothing for support to find.
    // Never send someone to pay for a booking we failed to record.
    let ins = await fetch(`${URL_}/rest/v1/bookings`, { method: 'POST', headers: svc, body: JSON.stringify(rows) });

    if (!ins.ok) {
      const detail = await ins.text().catch(() => '');
      // 23P01 = exclusion constraint violation, i.e. bookings_no_overlap fired:
      // someone paid for this slot between our availability check above and
      // this insert. That's a race we can only lose at write time, so report it
      // as "just taken" rather than a server error.
      if (/23P01|bookings_no_overlap/.test(detail)) {
        return res.status(409).json({ error: 'That slot was just taken by another driver. Pick a different time — you haven’t been charged.' });
      }
      // Degrade rather than block if the vehicle_reg migration hasn't been
      // applied yet: retry once without the column. A booking that records
      // everything except the plate beats a checkout that refuses to run.
      if (/vehicle_reg/.test(detail)) {
        console.error('bookings insert: vehicle_reg column missing — apply 20260728_booking_vehicle_reg.sql. Retrying without it.');
        const fallback = rows.map(({ vehicle_reg, ...rest }) => rest);
        ins = await fetch(`${URL_}/rest/v1/bookings`, { method: 'POST', headers: svc, body: JSON.stringify(fallback) });
      }
      if (!ins.ok) {
        console.error('bookings insert failed', ins.status, detail.slice(0, 400));
        return res.status(502).json({ error: 'We couldn’t hold that booking just now — nothing has been charged. Please try again in a moment.' });
      }
    }

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('checkout/create-session', e);
    return res.status(500).json({ error: e.message || 'Could not start checkout' });
  }
}
