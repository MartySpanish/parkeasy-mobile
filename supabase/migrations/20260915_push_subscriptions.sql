-- Web push: the channel every "come back" feature needs.
--
-- The PWA half already works — manifest.json, an installed service worker,
-- maskable icons. What is missing is push, and without it nothing can reach a
-- driver once they close the tab: no parking timer, no "a space opened near
-- where you looked", no matchday alert. The waitlist sweep built last week can
-- only email, and an email about a car park two streets away is read tomorrow.
--
-- ONE ROW PER BROWSER, keyed on the endpoint.
--
-- The endpoint URL is what the push service issues and is unique per
-- browser-per-site. It is the natural key: re-subscribing the same browser must
-- update the row rather than accumulate duplicates, or one person gets four
-- copies of the same notification.
--
-- WHY A FUNCTION RATHER THAN AN INSERT POLICY. Same reason as app_events: an
-- unauthenticated INSERT into a table that drives outbound messaging is a
-- primitive somebody can fill with junk. save_push_subscription() validates the
-- shape, caps what one session can register, and takes user_id from auth.uid()
-- so a subscription cannot be attributed to somebody else's account.
--
-- WHAT IS STORED. The endpoint and the two keys the push protocol needs to
-- encrypt for that browser. No device fingerprint, no location, nothing that
-- identifies a person beyond the account they were signed into.

begin;

create table if not exists public.push_subscriptions (
  endpoint     text primary key,
  -- The subscriber's public key and auth secret, base64url. Without both, a
  -- payload cannot be encrypted and the push is rejected.
  p256dh       text        not null,
  auth         text        not null,
  -- Who it belongs to, when we know. A guest can hold a parking timer, so a
  -- null user_id is legitimate and the session id is what links it.
  user_id      uuid,
  session_id   uuid,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when the push service says the subscription is gone (404/410). Kept
  -- rather than deleted so a browser that comes back is recognised, and so the
  -- churn is visible.
  expired_at   timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id) where expired_at is null;
create index if not exists push_subscriptions_live_idx
  on public.push_subscriptions (last_seen_at desc) where expired_at is null;

alter table public.push_subscriptions enable row level security;
-- No policies: the function below is the whole write surface, and reads are
-- service_role only (the send path). A driver has no reason to read anybody's
-- subscription, including their own.
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.save_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_session_id uuid default null,
  p_user_agent text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare mine integer;
begin
  -- Shape first. A push endpoint is an https URL from the browser's own push
  -- service; anything else cannot be sent to and has no business being stored.
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then
    return false;
  end if;
  if p_p256dh is null or p_auth is null
     or length(p_p256dh) not between 1 and 200
     or length(p_auth)   not between 1 and 100 then
    return false;
  end if;

  -- A session registering twenty browsers is not a person. Bounded so this
  -- cannot be used to fill the table.
  --
  -- The endpoint being saved is excluded from the count on purpose. Without
  -- that, a browser at the cap that re-subscribes — which is the NORMAL path,
  -- since a push service rotates an endpoint whenever it feels like it and the
  -- app re-registers on every load — gets refused, and quietly stops being
  -- reachable. The cap is there to stop new rows piling up, not to stop an
  -- existing row being refreshed.
  if p_session_id is not null then
    select count(*) into mine from public.push_subscriptions
     where session_id = p_session_id and expired_at is null and endpoint <> p_endpoint;
    if mine >= 5 then return false; end if;
  end if;

  insert into public.push_subscriptions
    (endpoint, p256dh, auth, user_id, session_id, user_agent)
  values
    (p_endpoint, p_p256dh, p_auth, auth.uid(), p_session_id, left(p_user_agent, 300))
  on conflict (endpoint) do update
    -- Re-subscribing the same browser REFRESHES it rather than adding a second
    -- row. The keys can rotate, and a subscription that was marked expired and
    -- has come back is live again.
    set p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_id = coalesce(excluded.user_id, public.push_subscriptions.user_id),
        session_id = coalesce(excluded.session_id, public.push_subscriptions.session_id),
        last_seen_at = now(),
        expired_at = null;

  return true;
end $$;

revoke all on function public.save_push_subscription(text, text, text, uuid, text) from public;
grant execute on function public.save_push_subscription(text, text, text, uuid, text)
  to anon, authenticated;

-- Turning notifications off.
--
-- Marks the row expired rather than deleting it, so the churn stays visible and
-- so a browser that turns them back on is the same row again.
--
-- Keyed on the endpoint alone, with no session or account check, and that is
-- deliberate: the endpoint is a long unguessable URL issued by the browser's
-- own push service, and holding it IS the capability. Requiring a session to
-- match would only break the case this has to work for — a browser whose
-- session id has rolled since it subscribed, which is every browser that has
-- cleared its storage. The worst somebody with a stolen endpoint can do here is
-- stop notifications they could already read.
create or replace function public.remove_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare hit integer;
begin
  if p_endpoint is null then return false; end if;
  update public.push_subscriptions
     set expired_at = now()
   where endpoint = p_endpoint and expired_at is null;
  get diagnostics hit = row_count;
  return hit > 0;
end $$;

revoke all on function public.remove_push_subscription(text) from public;
grant execute on function public.remove_push_subscription(text) to anon, authenticated;

commit;
