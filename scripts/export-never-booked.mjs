#!/usr/bin/env node
//
// Export the email of every registered driver who has never completed a
// booking, as a CSV you can open in Excel or paste into an email tool.
//
//   node scripts/export-never-booked.mjs                 → prints the CSV
//   node scripts/export-never-booked.mjs > winback.csv   → saves it to a file
//   node scripts/export-never-booked.mjs --days 30       → only accounts older
//                                                          than 30 days
//   node scripts/export-never-booked.mjs --count         → just the number
//
// WHAT IT NEEDS. Two values from the Supabase dashboard (Project Settings →
// API), given to the script as environment variables — settings you hand a
// program on the command line rather than writing into the file:
//
//   SUPABASE_URL=https://bbgqregyogtjzaustbng.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//     node scripts/export-never-booked.mjs > winback.csv
//
// The service-role key is the master key to the database. Never put it in the
// app, never commit it, and never paste it into a chat. This script is the
// right place for it because it runs on your own machine and talks straight to
// Supabase.
//
// WHAT "NEVER BOOKED" MEANS HERE. Never PAID — see the view's comment in
// supabase/migrations/20260925_booking_paid_authoritative.sql. Somebody whose
// card was declined, or who reached checkout and gave up, has a bookings row
// and has still never parked with us. They are the most winnable people on
// this list, and a naive "has no booking row" query drops them.

const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? true) : fallback;
};
const countOnly = process.argv.includes('--count');
const minDays = Number(arg('days', 0)) || 0;

if (!URL_ || !KEY) {
  console.error(
    'Missing settings.\n\n'
    + '  SUPABASE_URL=https://<your-project>.supabase.co \\\n'
    + '  SUPABASE_SERVICE_ROLE_KEY=<your service role key> \\\n'
    + '    node scripts/export-never-booked.mjs > winback.csv\n\n'
    + 'Both are in the Supabase dashboard under Project Settings → API.',
  );
  process.exit(2);
}

// PostgREST caps a response at 1,000 rows by default, so this pages rather
// than assuming everybody fits in one request. At 477 accounts one page is
// plenty today; the loop is what keeps it true at five thousand.
const PAGE = 1000;

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  // Quote anything that would otherwise break the row, and double any quote
  // inside it — the CSV rule every spreadsheet expects.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function page(from) {
  const q = new URLSearchParams({
    select: 'email,registered_at,days_since_signup',
    order: 'registered_at.desc',
  });
  if (minDays > 0) q.set('days_since_signup', `gte.${minDays}`);

  const r = await fetch(`${URL_}/rest/v1/users_never_booked?${q}`, {
    headers: {
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      Range: `${from}-${from + PAGE - 1}`,
      Prefer: 'count=exact',
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    if (r.status === 404 || /users_never_booked/.test(body)) {
      throw new Error(
        'The users_never_booked view does not exist yet. Apply\n'
        + '  supabase/migrations/20260925_booking_paid_authoritative.sql\n'
        + 'in the Supabase SQL editor first.',
      );
    }
    throw new Error(`Supabase said ${r.status}: ${body.slice(0, 300)}`);
  }
  // content-range looks like "0-476/477" — the total after the slash.
  const total = Number((r.headers.get('content-range') || '').split('/')[1]) || null;
  return { rows: await r.json(), total };
}

try {
  const all = [];
  let total = null;
  for (let from = 0; ; from += PAGE) {
    const { rows, total: t } = await page(from);
    if (t != null) total = t;
    all.push(...rows);
    if (rows.length < PAGE) break;
  }

  if (countOnly) {
    console.log(String(total ?? all.length));
  } else {
    console.log(['email', 'registered_at', 'days_since_signup'].join(','));
    for (const r of all) {
      console.log([r.email, r.registered_at, r.days_since_signup].map(csvCell).join(','));
    }
  }
  // To stderr, so `> winback.csv` gets only the data and you still see this.
  console.error(`\n${all.length} registered driver${all.length === 1 ? '' : 's'} `
    + `${minDays > 0 ? `older than ${minDays} days ` : ''}have never completed a booking.`);
} catch (e) {
  console.error(`\n${e.message}`);
  process.exit(1);
}
