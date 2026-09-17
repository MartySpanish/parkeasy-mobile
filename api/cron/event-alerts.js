// GET /api/cron/event-alerts — the matchday alert that reaches somebody who
// has not opened the app.
//
// Runs hourly. For each event starting in two to four hours, pushes to the
// sessions that follow that venue and have not been told yet.
//
// WHY THIS EXISTS. The home screen already carries "Tonight: Anastacia ·
// Waterfront Hall · 19:00 — park before you set off", and it only reaches
// somebody who opens the app. The person driving to Windsor Park at 18:50 did
// not open it. Forty thousand people went to Boucher Road on 20 August and
// ParkEasy said nothing to a single one of them.
//
// THE EVENT LIST IS THE APP'S, NOT THE DATABASE'S. src/data/events.js is the
// file four researchers built and every date in it was checked against its own
// weekday; it imports nothing, so it is safe to read from here. Copying those
// thirty-odd rows into a table would mean two lists to keep in step, and the
// one on the screen would not be the one being alerted on.
//
// CLAIMED BEFORE SENT. claim_event_alerts() inserts the send rows and returns
// only the sessions it actually claimed, so two overlapping runs cannot both
// push. A crash between claim and push loses an alert rather than duplicating
// one — recoverable, because the banner in the app still says what is on.
//
// Protected by CRON_SECRET: an open endpoint that sends notifications is an
// open endpoint that sends spam.
import { pushToSessions, pushConfigured } from '../_push.js';
import { EVENTS, VENUES, venueOf } from '../../src/data/events.js';
import { dueEvents, alertMessage } from '../../src/eventAlertsCore.js';

// Per event, per run. A venue with more followers than this has the rest told
// on the next hourly run — which still lands inside the two-hour window.
const MAX_PER_EVENT = 500;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secret || auth !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !SERVICE) return res.status(500).json({ error: 'Supabase not configured' });
  // Not an error: a deployment with no VAPID keys cannot send, and saying so is
  // more useful than a 500 every hour.
  if (!pushConfigured()) return res.status(200).json({ ok: true, skipped: 'push not configured' });

  const now = Date.now();
  const due = dueEvents(EVENTS, now);
  if (!due.length) return res.status(200).json({ ok: true, due: 0 });

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
  let sent = 0, failed = 0, expired = 0, claimed = 0;
  const handled = [];

  try {
    for (const { ev, at } of due) {
      // The venue key, which is what followers are keyed on. venueOverride
      // carries a name and coordinates but no key — a one-off location like
      // "Belfast city centre" for the Fleadh — so there is nobody following it
      // and nothing to send.
      const key = ev.venue;
      if (!key || !VENUES[key]) continue;

      const r = await fetch(`${URL_}/rest/v1/rpc/claim_event_alerts`, {
        method: 'POST', headers: svc,
        body: JSON.stringify({ p_event_id: ev.id, p_venue: key, p_limit: MAX_PER_EVENT }),
      });
      if (!r.ok) { failed++; continue; }
      // The function returns a set of text, which PostgREST gives back as an
      // array of scalars.
      const sessions = (await r.json().catch(() => []))
        .map(row => (typeof row === 'string' ? row : row?.claim_event_alerts))
        .filter(Boolean);
      if (!sessions.length) continue;
      claimed += sessions.length;

      const out = await pushToSessions(sessions, alertMessage(ev, venueOf(ev), at));
      sent += out.sent; failed += out.failed; expired += out.expired;
      handled.push({ event: ev.id, followers: sessions.length });
    }
    return res.status(200).json({ ok: true, due: due.length, claimed, sent, failed, expired, handled });
  } catch (e) {
    console.error('cron/event-alerts', e);
    return res.status(500).json({ error: e.message || 'sweep failed' });
  }
}
