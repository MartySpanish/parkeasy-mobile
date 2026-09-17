-- QR codes: the route that was never built, and the targets that never existed.
--
-- qr_scans has zero rows against 26 codes and 106 planned stickers and flyers.
-- The write was not broken — /q/ was never a route at all. A scan fell through
-- the SPA catch-all to the homepage, which looks like it worked and records
-- nothing. api/q.js is the route; this fixes the data it redirects to.
--
-- HALF THE PRINT RUN POINTED AT A PAGE THAT DOES NOT EXIST.
--
--   /belfast   13 codes, 50 items — fine, redirects to /area/belfast.html
--   /host      11 codes, 34 items — THERE IS NO /host. The page is /hosts.
--   /fleadh     2 codes,  6 items — there is no /fleadh either.
--
-- The eleven /host codes are the whole host-recruitment run: GAA clubs,
-- churches, libraries, leisure centres, Men's Sheds, and the driveway flyers
-- for four streets. Every one of them was landing a club treasurer on the
-- driver homepage instead of the page that asks him to list his car park.
-- That is fixed here — /hosts exists, the intent is unambiguous, and the
-- stickers themselves do not need reprinting because they point at /q/<code>,
-- not at the destination.
--
-- The two /fleadh codes were cut for a specific event and there is no /fleadh
-- page either. They sit at taxi dispatch desks and hotel front desks — both
-- audiences of people who want to know where to PARK, not where an event is —
-- so they go to /belfast with the rest of the driver-facing run. Leaving them
-- pointing at nothing serves nobody, and the event they were made for is over.

begin;

update public.qr_codes
   set lands_on = replace(lands_on, '/host?', '/hosts?')
 where lands_on like '/host?%';

update public.qr_codes
   set lands_on = replace(lands_on, '/fleadh?', '/belfast?')
 where lands_on like '/fleadh?%';

-- Scans per code per week, for the admin screen. service_role only: it is the
-- whole marketing picture, and there is no reason for it to be public.
create or replace function public.qr_scan_stats(p_days integer default 90)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce(jsonb_agg(r order by (r->>'scans')::int desc, r->>'code'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'code', c.code,
               'medium', c.medium,
               'area', c.area,
               'location', c.location,
               'lands_on', c.lands_on,
               'quantity', c.quantity,
               'active', c.active,
               'placed_at', c.placed_at,
               'scans', count(s.id),
               'last_scan', max(s.created_at),
               'this_week', count(s.id) filter (where s.created_at > now() - interval '7 days')
             ) r
        from public.qr_codes c
        -- LEFT join: a code with no scans is the entire point of looking. An
        -- inner join hides exactly the sticker that is not working.
        left join public.qr_scans s
               on s.code = c.code
              and s.created_at > now() - make_interval(days => greatest(1, least(p_days, 365)))
       group by c.code, c.medium, c.area, c.location, c.lands_on, c.quantity, c.active, c.placed_at
    ) q;
$$;

revoke all on function public.qr_scan_stats(integer) from public, anon, authenticated;
grant execute on function public.qr_scan_stats(integer) to service_role;

create index if not exists qr_scans_code_created_idx on public.qr_scans (code, created_at desc);

do $$
declare n integer;
begin
  select count(*) into n from public.qr_codes where lands_on like '/host?%';
  if n > 0 then raise exception '% codes still point at /host, which does not exist', n; end if;
  select count(*) into n from public.qr_codes where lands_on like '/fleadh?%';
  if n > 0 then raise exception '% codes still point at /fleadh, which does not exist', n; end if;

  -- Every code must land on a path this site actually serves. /belfast
  -- redirects to /area/belfast.html and /hosts is a real page; anything else
  -- falls through the SPA catch-all to the homepage, which is what caused this.
  select count(*) into n from public.qr_codes
   where lands_on is null
      or split_part(lands_on, '?', 1) not in ('/belfast', '/hosts', '/');
  if n > 0 then raise exception '% codes point somewhere this site does not serve', n; end if;

  raise notice 'qr: % codes land on /hosts, % on /belfast',
    (select count(*) from public.qr_codes where lands_on like '/hosts?%'),
    (select count(*) from public.qr_codes where lands_on like '/belfast?%');
end $$;

commit;
