-- The number that sells the next card.
--
-- partner_events holds 2,062 impressions and 84 clicks and nothing reads them
-- except one raw count on the admin dashboard. The sentence that renews a £25
-- listing is "your card was seen 300 times last month and 11 people tapped
-- through to you", and right now that sentence cannot be said.
--
-- TWO FUNCTIONS, because they have two different audiences.
--
--   partner_stats()            every partner, for the admin screen. service_role
--                              only — it reads the whole book of business.
--   partner_stats_for_token()  ONE partner, for a link Marty can text to a
--                              barber. Keyed on a token, readable by anon.
--
-- WHY A TOKEN AND NOT A LOGIN. The audience is a barber with a phone, on a
-- Tuesday, being asked to keep paying £25 a month. Making him create an account
-- to see his own numbers is how that conversation stops. The token grants
-- exactly one thing: the impression and click counts for the partner it belongs
-- to. It carries no name, no email, and no access to anybody else's row.

begin;

-- partner_events, in version control for the first time.
--
-- Like app_events, this table exists in production but no migration ever
-- created it — it was made by hand in the dashboard, so the repo had no
-- reproducible definition and there was nothing for tests/db/run.sh to apply
-- the functions below against. This block matches the live columns exactly and
-- is a no-op there.
--
-- Its INSERT policy is NOT recreated here and does not need to be: 
-- 20260727_security_hardening.sql already narrowed it to
-- partner_events_insert_live_partners_only, which requires the event type to
-- be 'impression' or 'click' AND the partner to be active and in-window. Worth
-- recording because the build brief lists this table as an open-INSERT problem
-- to avoid — it was, and it was fixed in July. What it still lacks is a rate
-- limit, which is a separate change with a client write path to move first.
create table if not exists public.partner_events (
  id         bigserial primary key,
  partner_id uuid        not null,
  listing_id uuid,
  event_type text        not null,
  created_at timestamptz not null default now()
);

alter table public.partners
  add column if not exists stats_token uuid not null default gen_random_uuid();

comment on column public.partners.stats_token is
  'Opaque key for the public per-partner stats page. Grants counts for this '
  'partner only. Rotate by setting it to gen_random_uuid().';

create unique index if not exists partners_stats_token_idx on public.partners (stats_token);

-- The stats query is always "this partner, over this window".
create index if not exists partner_events_partner_created_idx
  on public.partner_events (partner_id, created_at desc);

-- ── Every partner, for the admin screen ─────────────────────────────────────
create or replace function public.partner_stats(p_days integer default 30)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with windowed as (
    select partner_id, event_type
      from public.partner_events
     where created_at > now() - make_interval(days => greatest(1, least(p_days, 365))))
  select coalesce(jsonb_agg(r order by (r->>'impressions')::int desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'slug', p.slug,
               'tier', p.tier,
               'active', p.active,
               'sold_at', p.sold_at,
               'renewal_due_at', p.renewal_due_at,
               'payment_failed_at', p.payment_failed_at,
               'stats_token', p.stats_token,
               'impressions', count(*) filter (where w.event_type = 'impression'),
               'clicks',      count(*) filter (where w.event_type = 'click')
             ) r
        from public.partners p
        -- LEFT join on purpose: a partner with no impressions this month is
        -- exactly the one worth looking at, and an inner join would hide them.
        left join windowed w on w.partner_id = p.id
       group by p.id, p.name, p.slug, p.tier, p.active, p.sold_at,
                p.renewal_due_at, p.payment_failed_at, p.stats_token
    ) q;
$$;

revoke all on function public.partner_stats(integer) from public, anon, authenticated;
grant execute on function public.partner_stats(integer) to service_role;

-- ── One partner, by token, for the page you can text them ───────────────────
create or replace function public.partner_stats_for_token(p_token uuid, p_days integer default 30)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case when p.id is null then null else jsonb_build_object(
    'name', p.name,
    'days', greatest(1, least(p_days, 365)),
    'impressions', (select count(*) from public.partner_events e
                     where e.partner_id = p.id and e.event_type = 'impression'
                       and e.created_at > now() - make_interval(days => greatest(1, least(p_days, 365)))),
    'clicks',      (select count(*) from public.partner_events e
                     where e.partner_id = p.id and e.event_type = 'click'
                       and e.created_at > now() - make_interval(days => greatest(1, least(p_days, 365))))
  ) end
  from (select id, name from public.partners where stats_token = p_token) p;
$$;

-- Anon CAN run this, because the whole point is a link with no login. The token
-- is the credential, and the function returns counts for that partner only —
-- there is no argument through which it could be made to return anybody else's.
revoke all on function public.partner_stats_for_token(uuid, integer) from public;
grant execute on function public.partner_stats_for_token(uuid, integer) to anon, authenticated, service_role;

do $$
declare n integer;
begin
  select count(*) into n from public.partners where stats_token is null;
  if n > 0 then raise exception '% partners have no stats token', n; end if;
end $$;

commit;
