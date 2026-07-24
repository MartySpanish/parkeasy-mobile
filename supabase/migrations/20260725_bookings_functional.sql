-- Make bookings a fully-functional system: overlap/double-booking prevention
-- and refund/cancellation tracking.
--
-- ends_at lets us detect time overlaps cheaply (starts_at < newEnd AND
-- ends_at > newStart). Refund columns record cancellations. Still test-mode.
alter table public.bookings
  add column if not exists ends_at       timestamptz,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  text,          -- 'driver' | 'host' | 'admin'
  add column if not exists refund_pence  integer,
  add column if not exists refund_status text;           -- refunded | partial | none

-- Backfill ends_at for any existing rows from starts_at + duration.
update public.bookings
   set ends_at = starts_at + make_interval(hours => coalesce(duration_hours, 1))
 where ends_at is null and starts_at is not null;

-- Overlap lookups per listing over an active window.
create index if not exists bookings_overlap_idx
  on public.bookings (listing_id, starts_at, ends_at)
  where status in ('pending', 'paid');
