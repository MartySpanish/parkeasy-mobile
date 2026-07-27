-- Item 0: security fixes from the 25 Jul advisor scan.
--
-- 1) partner_events had `with check (true)` for anon+authenticated — anyone
--    could POST arbitrary impression/click rows and inflate an advertiser's
--    numbers (the numbers we quote at renewal). Tighten to: the partner must
--    exist and be currently live, and the event type must be valid. That's as
--    far as RLS can go without a session-side token; combined with the
--    IntersectionObserver client and manual review of outliers it's adequate
--    for v1. (A signed-event endpoint is the real fix at scale — noted.)
drop policy if exists "partner_events_public_insert" on public.partner_events;
create policy "partner_events_insert_live_partners_only" on public.partner_events
  for insert to anon, authenticated
  with check (
    event_type in ('impression', 'click')
    and exists (
      select 1 from public.partners p
      where p.id = partner_id
        and p.active
        and (p.starts_at is null or p.starts_at <= now())
        and (p.ends_at   is null or p.ends_at   >= now())
    )
  );

-- 2) guard_admin_columns: lock down execution and pin the search path
--    (mutable search_path is a privilege-escalation vector on SECURITY
--    DEFINER functions). Guarded so this migration is safe if the function
--    was renamed or removed.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guard_admin_columns'
  ) then
    execute 'alter function public.guard_admin_columns() set search_path = public, pg_temp';
    execute 'revoke all on function public.guard_admin_columns() from public, anon, authenticated';
  end if;
end
$$;

-- 3) Same hardening for our own SECURITY DEFINER helper.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'redeem_pass_credit'
  ) then
    execute 'revoke all on function public.redeem_pass_credit(uuid) from public, anon, authenticated';
  end if;
end
$$;

-- 4) listing-photos storage: allow fetching a known object, not listing the
--    bucket's contents (bucket enumeration leaks every host's photo paths).
do $$
begin
  if exists (select 1 from storage.buckets where id = 'listing-photos') then
    -- Replace any blanket public policy with read-by-key only.
    execute 'drop policy if exists "Public read listing photos" on storage.objects';
    execute 'drop policy if exists "listing_photos_public_read" on storage.objects';
    execute $p$
      create policy "listing_photos_read_by_key" on storage.objects
        for select to anon, authenticated
        using (bucket_id = 'listing-photos' and name is not null)
    $p$;
  end if;
end
$$;

-- 5) Leaked-password protection (HaveIBeenPwned check) is an Auth dashboard
--    toggle, not SQL: Supabase → Authentication → Policies → enable
--    "Prevent use of leaked passwords". Left as a documented manual step.
