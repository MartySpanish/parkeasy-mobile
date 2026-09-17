// GET /api/cron/parking-timers — the sweep that makes a parking timer real.
//
// Runs every five minutes. Finds the timers whose reminder has come due and
// pushes to that session's subscriptions. This is the only part of the feature
// that is awake when it matters: the driver's phone is in their pocket and the
// tab that set the timer was discarded twenty minutes ago.
//
// STAMPED FIRST, SENT SECOND — and that is deliberate. The alternative order
// loses a whole class of argument: if the push succeeds and the stamp then
// fails, the next sweep sends the same reminder again, and "your parking runs
// out in 15 minutes" arriving twice five minutes apart is a driver who stops
// trusting the notification. Stamping first means a crash between the two loses
// a reminder instead of duplicating one. Neither is good; a lost reminder is
// the one a driver can recover from, because the app still shows the countdown.
//
// Protected by CRON_SECRET: an open endpoint that sends notifications is an
// open endpoint that sends spam.
import { pushToSessions, pushConfigured } from '../_push.js';

// How many to handle in one sweep. A backlog is spread over later runs rather
// than turning one invocation into a timeout.
const MAX_PER_RUN = 200;

/** "in 15 minutes", "in 1 hour", "now" — what the notification actually says. */
export function duePhrase(dueAt, now = Date.now()) {
  const mins = Math.round((new Date(dueAt).getTime() - now) / 60000);
  if (mins <= 1) return 'now';
  if (mins < 60) return `in ${mins} minutes`;
  const hours = Math.round(mins / 60);
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

/** The notification for one timer. Never claims a fine; we do not know that. */
export function timerMessage(row, now = Date.now()) {
  const when = duePhrase(row.due_at, now);
  return {
    title: when === 'now' ? 'Your parking is up' : `Parking runs out ${when}`,
    body: row.label
      ? `${row.label} — tap to find your car`
      : 'Tap to find your car',
    // Deep link to the parked screen. A path, never an absolute url.
    url: '/?parked=1',
    // One tag per session: a replaced reminder replaces the notification too.
    tag: `parking-${row.session_id}`,
    // A parking reminder is the one notification worth a buzz — it has a
    // deadline and a cost attached to missing it.
    requireInteraction: true,
  };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secret || auth !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !SERVICE) return res.status(500).json({ error: 'Supabase not configured' });
  // Not an error: a deployment with no VAPID keys simply cannot send, and
  // saying so is more useful than a 500 every five minutes.
  if (!pushConfigured()) return res.status(200).json({ ok: true, skipped: 'push not configured' });

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
  const q = new URLSearchParams({
    select: 'session_id,due_at,label,lat,lng',
    sent_at: 'is.null',
    cancelled_at: 'is.null',
    remind_at: `lte.${new Date().toISOString()}`,
    order: 'remind_at.asc',
    limit: String(MAX_PER_RUN),
  });

  try {
    const r = await fetch(`${URL_}/rest/v1/parking_timers?${q}`, { headers: svc });
    if (!r.ok) return res.status(502).json({ error: 'Could not read timers' });
    const due = await r.json();
    if (!due.length) return res.status(200).json({ ok: true, due: 0 });

    let sent = 0, failed = 0, expired = 0;
    for (const row of due) {
      // Stamp first. See the header.
      const stamp = await fetch(
        `${URL_}/rest/v1/parking_timers?session_id=eq.${encodeURIComponent(row.session_id)}&sent_at=is.null`,
        { method: 'PATCH', headers: { ...svc, Prefer: 'return=representation' },
          body: JSON.stringify({ sent_at: new Date().toISOString() }) });
      // Nothing came back: another sweep took this row first. Not an error, and
      // not ours to send.
      const claimed = stamp.ok ? (await stamp.json()) : [];
      if (!claimed.length) continue;

      const out = await pushToSessions([row.session_id], timerMessage(row));
      sent += out.sent; failed += out.failed; expired += out.expired;
    }
    return res.status(200).json({ ok: true, due: due.length, sent, failed, expired });
  } catch (e) {
    console.error('cron/parking-timers', e);
    return res.status(500).json({ error: e.message || 'sweep failed' });
  }
}
