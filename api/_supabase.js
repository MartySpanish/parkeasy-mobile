// Server-side Supabase reader for public pages.
//
// THE EQUIVALENT OF lib/supabase/server.ts, for a codebase that is not Next.
// ParkEasy is a Vite SPA with plain Vercel functions, so there is no server
// component and no @supabase/supabase-js on this side — the functions here talk
// to PostgREST over fetch. This is that pattern in one place, because the
// events pages made it the fourth copy.
//
// THE ANON KEY, DELIBERATELY, AND NOT THE SERVICE KEY. Every other function in
// this directory reads with SUPABASE_SERVICE_ROLE_KEY, because every other one
// is doing something a driver is not allowed to do — taking a payment, writing
// a booking, reading a host's own draft. These pages are the opposite: they
// render what is already public. Read them with the service key and RLS is
// switched off for the whole render, so a mistyped filter quietly publishes a
// draft listing or a retired venue and nothing anywhere says so.
//
// With the anon key the database enforces it instead. The three policies that
// matter already say exactly the right thing:
//
//   events          status <> 'cancelled'     (anon, authenticated)
//   venues          active                    (anon, authenticated)
//   rental_listings status = 'active'         public read
//
// So a cancelled event or an inactive venue cannot reach these pages even if
// the query asks for one — it comes back as zero rows and renders a 404. That
// is the desired behaviour AND the safe one, which is a good sign it is the
// right key.

const URL_ = () => process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
// VITE_SUPABASE_ANON_KEY is what the browser bundle already uses; Vercel
// exposes project env vars to functions regardless of the VITE_ prefix, so
// there is nothing new to configure for this to work in production.
const ANON = () => process.env.VITE_SUPABASE_ANON_KEY
               || process.env.SUPABASE_ANON_KEY
               || process.env.SUPABASE_PUBLISHABLE_KEY;

/** True when this deployment can reach the database at all. */
export function dbConfigured() {
  return Boolean(URL_() && ANON());
}

/**
 * GET a PostgREST path and return the parsed rows.
 *
 * Throws on a non-2xx so the caller can choose between "serve a 503" and
 * "serve the page without this section". A page that renders an empty list
 * when the database is down looks like a quiet week rather than an outage,
 * which is the failure mode worth avoiding.
 *
 * @param {string} path e.g. "upcoming_events?select=*&limit=10"
 * @returns {Promise<Array<object>>}
 */
export async function selectPublic(path) {
  if (!dbConfigured()) throw new Error('Supabase is not configured for this deployment');
  const key = ANON();
  const r = await fetch(`${URL_()}/rest/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} on ${path.split('?')[0]}`);
  return r.json();
}
