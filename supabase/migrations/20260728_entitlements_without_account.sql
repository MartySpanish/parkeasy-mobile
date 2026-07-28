-- Let a Premium entitlement exist before the payer has an account.
--
-- promo_redemptions.user_id is uuid NOT NULL with an FK to auth.users. Stripe
-- checkout does not require an account, so when someone paid without one the
-- entitlement INSERT threw, the webhook swallowed it, and the payer got
-- nothing. At least one person then paid a second time three minutes later.
--
-- After this, the webhook records the entitlement against the email with a
-- null user_id, and /api/redeem-promo claims it the first time that person
-- signs in with the same address.

alter table public.promo_redemptions
  alter column user_id drop not null;

-- One unclaimed entitlement per (email, code). Partial, so it does not clash
-- with the existing UNIQUE (user_id, code) once the row has been claimed.
create unique index if not exists promo_redemptions_email_code_unclaimed_uniq
  on public.promo_redemptions (lower(user_email), code)
  where user_id is null;

-- The revoke path (customer.subscription.deleted) patches by email + code, and
-- the claim path reads by email, so both want this.
create index if not exists promo_redemptions_email_code_idx
  on public.promo_redemptions (lower(user_email), code);

comment on column public.promo_redemptions.user_id is
  'Null while the entitlement is unclaimed — paid for before the person had an account. /api/redeem-promo attaches the account on first sign-in with the matching email.';
