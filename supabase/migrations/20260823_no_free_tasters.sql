-- No more free hidden gems.
--
-- The five tasters were a deliberate giveaway: hand a free user the five
-- best-rated gems in full so they have some reason to believe the other 84 are
-- worth paying for. In practice it put the single best gem in the country —
-- Ormeau Embankment riverside, 67 votes — on the results list with its name,
-- notes and kerb-accurate pin readable by anyone, and it was repeatedly read as
-- the paywall being broken. The gems ARE the subscription. Giving away the five
-- best is giving away the pitch.
--
-- WHAT THIS ACTUALLY CHANGES. is_taster is not decoration; hidden_gems_teaser
-- keys off it directly:
--
--     case when is_taster then name end        as name,
--     case when is_taster then notes end       as notes,
--     case when is_taster then lat  else round(...) end as approx_lat,
--
-- so flipping it to false is what stops the name, the restriction, the notes,
-- the walk and the exact coordinates being SENT to a non-subscriber. This is
-- not a display change — after this migration the server no longer hands those
-- columns to an anonymous client at all. The view is left exactly as it is,
-- because it was already correct; only the data it keys off changes.
--
-- The app has the same dial in FREE_GEMS_TOTAL (src/App.jsx), used only as an
-- offline fallback when this table cannot be read. Both were set to zero
-- together. Change one without the other and a free user's screen stops
-- matching what the server will actually give them.
--
-- REVERSIBLE. To reopen the top five by votes:
--
--   update public.hidden_gems set is_taster = true
--   where id in (select id from public.hidden_gems
--                where status = 'published'
--                order by votes desc, id limit 5);
--
-- and set FREE_GEMS_TOTAL back to 5 in the same deploy.

update public.hidden_gems
   set is_taster = false
 where is_taster;

-- Belt and braces: a seed re-run must not quietly reopen them. The seed
-- upserts is_taster from its own column list, so the default is what a new row
-- lands on.
alter table public.hidden_gems alter column is_taster set default false;

do $$
declare n integer;
begin
  select count(*) into n from public.hidden_gems where is_taster;
  if n <> 0 then
    raise exception 'expected 0 tasters after this migration, found %', n;
  end if;
end $$;
