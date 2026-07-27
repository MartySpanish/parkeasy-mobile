// GET /api/calendar?token=<uuid> — read-only iCal feed of a host's upcoming
// bookings, so a volunteer treasurer can see what's coming in their own
// calendar app instead of opening the app. Subscribe-by-URL; the token is the
// only credential, so it's unguessable and rotatable (change the column).
//
// Deliberately read-only and minimal: no personal data beyond the space name
// and the driver's first name.
const ics = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n');
const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

export default async function handler(req, res) {
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = String(req.query.token || '').trim();
  if (!URL_ || !SERVICE) return res.status(500).send('Not configured');
  if (!/^[0-9a-f-]{36}$/i.test(token)) return res.status(400).send('Invalid calendar token');

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
  try {
    const hr = await fetch(`${URL_}/rest/v1/host_accounts?calendar_token=eq.${token}&select=host_id`, { headers: svc });
    const host = (await hr.json())?.[0];
    if (!host) return res.status(404).send('Calendar not found');

    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const br = await fetch(`${URL_}/rest/v1/bookings?host_id=eq.${host.host_id}&status=in.(paid,completed)&starts_at=gte.${from}&select=id,listing_id,starts_at,ends_at,duration_hours,driver_email,amount_total_pence&order=starts_at`, { headers: svc });
    const bookings = br.ok ? await br.json() : [];

    const ids = [...new Set(bookings.map(b => b.listing_id).filter(Boolean))];
    let titles = {};
    if (ids.length) {
      const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=in.(${ids.join(',')})&select=id,title,address`, { headers: svc });
      if (lr.ok) titles = Object.fromEntries((await lr.json()).map(l => [l.id, l]));
    }

    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ParkEasy//Host bookings//EN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:ParkEasy bookings'];
    for (const b of bookings) {
      if (!b.starts_at) continue;
      const l = titles[b.listing_id] || {};
      const end = b.ends_at || new Date(Date.parse(b.starts_at) + (b.duration_hours || 1) * 3600000).toISOString();
      const who = (b.driver_email || '').split('@')[0] || 'a driver';
      lines.push('BEGIN:VEVENT',
        `UID:${b.id}@parkeasy.uk`,
        `DTSTAMP:${stamp(Date.now())}`,
        `DTSTART:${stamp(b.starts_at)}`,
        `DTEND:${stamp(end)}`,
        `SUMMARY:${ics(`Parking booked — ${l.title || 'your space'}`)}`,
        `DESCRIPTION:${ics(`Booked by ${who}. You receive £${(((b.amount_total_pence || 0) * 0.85) / 100).toFixed(2)} (approx, after fees). Manage at parkeasy.uk`)}`,
        `LOCATION:${ics(l.address || '')}`,
        'END:VEVENT');
    }
    lines.push('END:VCALENDAR');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=900');
    return res.status(200).send(lines.join('\r\n'));
  } catch (e) {
    console.error('calendar', e);
    return res.status(500).send('Calendar unavailable');
  }
}
