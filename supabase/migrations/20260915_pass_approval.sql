-- Two holes in the pass path, one of them opened by the host-approval work.
--
-- HOLE 1: A PASS CREDIT BYPASSES THE HOST ENTIRELY.
--
-- 20260907_host_approval.sql made a booking on a driveway a REQUEST: the card
-- is authorised and captured only when the host accepts. api/passes.js predates
-- that and inserts its booking with status 'paid' directly, never reading
-- requires_host_approval and never setting it on the row.
--
-- So the database constraint does not fire — the column defaults to false, and
-- the check is
--
--     not (requires_host_approval and status = 'paid' and host_responded_at is null)
--
-- which is satisfied by a row claiming it never needed approval. The booking
-- lands as confirmed and the driveway host is never asked. Somebody with a
-- season pass books a stranger's drive and the first they hear of it is a car
-- arriving.
--
-- Nobody has bought a pass yet, so this has never happened. It would have, the
-- first time a pass was sold against a driveway.
--
-- HOLE 2: A LOST CREDIT.
--
-- redeem_pass_credit() decrements BEFORE the booking row is inserted — correct,
-- because the other order hands out a free booking when the decrement fails.
-- But when the insert then fails, the credit is gone and there is no way back:
-- the driver has paid for ten and can use nine.
--
-- restore_pass_credit() is the way back, and it is also what a declined or
-- expired approval needs — a host saying no must not cost the driver a credit.

begin;

create or replace function public.restore_pass_credit(p_purchase uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  -- Capped at the number bought, so a double restore cannot mint credits.
  -- least() rather than a guard clause: this is called from three places (a
  -- failed insert, a decline, an expiry) and any of them may retry.
  update public.pass_purchases p
     set credits_remaining = least(p.credits_remaining + 1,
                                   coalesce((select lp.num_credits from public.listing_passes lp
                                              where lp.id = p.pass_id), p.credits_remaining + 1))
   where p.id = p_purchase
  returning p.credits_remaining;
$$;

revoke all on function public.restore_pass_credit(uuid) from public, anon, authenticated;
grant execute on function public.restore_pass_credit(uuid) to service_role;

-- THE INVARIANT, TIGHTENED.
--
-- The old check let a row opt out of approval by simply not setting the flag,
-- which is exactly what the pass path did. This version asks the LISTING
-- rather than trusting the booking: if the listing requires approval, a paid
-- booking against it must carry a host response, whatever the booking row
-- claims about itself.
--
-- Written as a trigger rather than a CHECK because a CHECK cannot read another
-- table. Same guarantee, enforced on every write.
create or replace function public.guard_host_approval()
returns trigger language plpgsql as $$
declare needs boolean;
begin
  if new.status = 'paid' and new.host_responded_at is null then
    select l.requires_host_approval into needs
      from public.rental_listings l where l.id = new.listing_id;
    if coalesce(needs, false) then
      raise exception
        'listing % requires host approval: a booking cannot be paid before the host answers', new.listing_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists bookings_host_approval_trg on public.bookings;
create trigger bookings_host_approval_trg
  before insert or update of status, host_responded_at on public.bookings
  for each row execute function public.guard_host_approval();

commit;
