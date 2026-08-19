# What has to happen before any of this works

Five features were built as five commits. None of the database-backed ones do
anything until their migration has run, and every money-moving path is in Stripe
test mode until it has been reconciled by hand.

## 1. Migrations — DONE

All five were applied to production on 19 August 2026, in this order, before the
code merged. Kept here as the record of what ran and what each one is load-bearing
for.

| File | Feature | Breaks without it |
|---|---|---|
| `20260820_corporate_permits.sql` | 1 | `/api/corporate/*` 500s |
| `20260820_operator_site_terminology.sql` | 1 | "held for you" appears over an APCOA car park the day either draft listing goes active |
| `20260820_booking_from_hotspot.sql` | 2 | checkout 400s on an unknown column |
| `20260820_hotspot_moderation.sql` | 3 | the report button and the cluster panel silently do nothing |
| `20260820_car_wash.sql` | 4 | `/api/wash` 500s |

Feature 5 needs no migration.

**One of them nearly took the site down, and the reason is worth keeping.**
`20260820_operator_site_terminology.sql` recreates `listings_public`, and the
first draft copied the column list out of the migration that created that view.
Production's version had **nine more columns** — gate hours, the overnight fee,
availability windows, the featured flag — added by later migrations. Since
`create or replace view` replaces rather than merges, applying that draft would
have silently dropped all nine and broken gate hours and booking windows across
the app, with nothing erroring. The list was read back off production with
`pg_get_viewdef` instead. Do the same next time: **the migration files in this
repo are not a complete record of this database.**

## 2. Environment variables

Already set: `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`ADMIN_EMAILS`, `EMAIL_FROM`, `APP_URL`.

**New: `CRON_SECRET`.** The renewal-reminder cron refuses every request without
it. Set it in the Vercel project (Settings → Environment Variables); Vercel Cron
sends it automatically as `Authorization: Bearer $CRON_SECRET`. Until it is set
the cron 401s every day, which is the safe failure — an open endpoint that sends
email is an open endpoint that sends spam.

`STRIPE_LIVE_ENABLED` stays **unset**. Every money path here refuses a live key
without it.

## 3. Data somebody has to enter before a feature is visible

Feature 1 has no admin UI for creating a company or a block yet — those rows are
created server-side. To pilot it:

1. Insert a `corporate_accounts` row (company name + billing contact email).
2. Insert a `corporate_permit_blocks` row pointing at a `rental_listings` id,
   with `permit_count`, `monthly_price_pence` and `operator_share_pct`.
3. Insert `corporate_members` — at least one with `role='admin'`, matched on the
   email they sign in with. `user_id` fills itself in only if you set it; a
   member with a null `user_id` cannot claim until it is linked.
4. `POST /api/corporate/subscription {blockId}` as a founder account to create
   the Stripe subscription.

Feature 4 needs `rental_listings.wash_enabled = true` on at least one site. The
add-on renders nothing anywhere until then.

## 4. Run the tests

```
npm test
```

100 checks plus the concurrency run. The database suites need a Postgres binary;
without one they skip and say so.

## 5. What is deliberately not built

- **No admin UI for corporate accounts, blocks or staff invites.** Rows are
  created server-side. A pilot with one employer does not need a CRUD screen and
  building one before the first customer is building the wrong thing.
- **No valeter accounts or scheduling.** Marty reads a list of registrations off
  the dashboard and hands it to somebody. That is the whole of car wash v1.
- **No automatic operator settlement.** Stripe Billing does not split to the
  operator, and nothing here pretends it does. `operator_settlements` is a list
  of what is owed; paying it is a bank transfer somebody makes.

## 6. One thing worth fixing separately

`supabase/migrations/*` cannot currently rebuild the database from nothing:
`spot_submissions.photo_url` exists in production and no migration creates it.
It was applied by hand and never written down. Recorded in
`tests/db/known-drift.sql` so the test chain runs; the real fix is a migration
that creates it properly.
