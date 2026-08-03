-- Online-only partners, and partners with more than one call to action.
--
-- Marcus Donnelly Fitness is online GAA strength & conditioning. It has no
-- premises. Every partner so far has been somewhere you drive to, so the whole
-- model assumed a front door: partners.lat/lng are NOT NULL, matching is by
-- distance from the city centre, and both the card and the business page lead
-- with "parking around here". For a remote coaching business that is a map of a
-- street it has nothing to do with.
--
--   is_online  — suppresses the parking map, the nearby list and the address
--   links      — [{label,url}] because one link_url could only carry the first
--                of "book a strategy call", "apply", "follow on Instagram"
--
-- lat/lng still have to be filled (NOT NULL, and the city match needs them), so
-- an online partner gets the centre of the city it serves. is_online is what
-- stops that coordinate ever being shown to anyone as a place to go.

alter table public.partners
  add column if not exists is_online boolean not null default false,
  add column if not exists links     jsonb   not null default '[]'::jsonb;

comment on column public.partners.is_online is
  'No premises. Hides the address, the parking map and the nearby-spots list — lat/lng exist only to match the partner to a city.';
comment on column public.partners.links is
  'Ordered [{label,url}]. First is rendered as the primary button. Falls back to link_url when empty.';

-- A remote business cannot have a radius that pulls it onto other listings'
-- cards as "near this space".
alter table public.partners
  drop constraint if exists partners_online_has_no_address;
alter table public.partners
  add constraint partners_online_has_no_address
  check (not is_online or address is null);

insert into public.partners
  (slug, name, tagline, description, logo_url, photo_url, photo_urls,
   link_url, links, is_online, address, postcode, lat, lng, radius_m, priority, active)
values (
  'marcus-donnelly-fitness',
  'Marcus Donnelly Fitness',
  'Online GAA strength & conditioning — win on and off the pitch.',
  'Online strength and conditioning built for GAA players. The Delta programme has taken 200+ GAA athletes to the next level, and had them looking the part while they did it. Start with a free strategy call with Marcus to talk through where you are, what you are chasing, and how to get there.',
  null,
  'https://parkeasy.uk/marcus/banner.jpg',
  array['https://parkeasy.uk/marcus/banner.jpg'],
  'https://calendly.com/marcusdonnellyfitness/strategy-call',
  '[{"label":"Book a free strategy call","url":"https://calendly.com/marcusdonnellyfitness/strategy-call"},
    {"label":"Apply now","url":"https://public.1fit.com/leadforms/0193256a-2e80-73a0-a752-1d8a3103d4a8"},
    {"label":"Follow on Instagram","url":"https://www.instagram.com/marcusdonnellyfitness"}]'::jsonb,
  true,
  null, null,
  -- Belfast city centre. Only ever used to decide which city's list he appears
  -- in; is_online stops it being presented as somewhere to drive to.
  54.5973, -5.9301,
  800, 0, true
)
on conflict (slug) do nothing;
