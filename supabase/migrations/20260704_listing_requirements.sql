-- Mandatory listing requirements (APPLIED to production 2026-07-04 via MCP).
-- Kept here for version control. Publish-gated; drafts may be incomplete.
alter table rental_listings
  add column if not exists host_type text not null default 'residential',
  add column if not exists instructions text,
  add column if not exists availability text,
  add column if not exists org_name text,
  add column if not exists org_type text,
  add column if not exists org_registration text,
  add column if not exists access_contact_name text,
  add column if not exists access_contact_phone text,
  add column if not exists access_method text,
  add column if not exists approved_by_founder boolean not null default false,
  add column if not exists needs_update boolean not null default false,
  add column if not exists rejection_reason text,
  add column if not exists published_at timestamptz;

alter table rental_listings
  add constraint host_type_valid check (host_type in ('residential','organization')),
  add constraint status_valid check (status in ('draft','active','pending_approval','rejected','hidden')),
  add constraint availability_valid check (availability is null or availability in ('Event dates only','Weekdays','Weekends','Always')),
  add constraint org_type_valid check (org_type is null or org_type in ('school','church','sports club','business','community centre','other')),
  add constraint capacity_range check (spaces between 1 and 200),
  add constraint publish_instructions check (status <> 'active' or char_length(coalesce(instructions,'')) >= 30),
  add constraint publish_photos check (status <> 'active' or cardinality(coalesce(photos,'{}')) >= case when host_type = 'organization' then 5 else 3 end),
  add constraint publish_coords check (status <> 'active' or (lat is not null and lng is not null)),
  add constraint publish_phone check (status <> 'active' or coalesce(contact_phone,'') <> ''),
  add constraint publish_availability check (status <> 'active' or availability is not null),
  add constraint publish_price check (status <> 'active' or coalesce(price_per_hour, price_per_day, price_per_month) is not null),
  add constraint publish_org_fields check (
    status <> 'active' or host_type <> 'organization' or (
      coalesce(org_name,'') <> '' and org_type is not null and coalesce(org_registration,'') <> ''
      and coalesce(access_contact_name,'') <> '' and coalesce(access_contact_phone,'') <> ''
      and char_length(coalesce(access_method,'')) >= 30
      and approved_by_founder = true
    )
  );

create or replace function guard_admin_columns() returns trigger
language plpgsql security definer as $$
begin
  if (new.approved_by_founder is distinct from old.approved_by_founder
      or new.rejection_reason is distinct from old.rejection_reason)
     and coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only ParkEasy admins can change approval fields';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_admin_columns on rental_listings;
create trigger trg_guard_admin_columns before update on rental_listings
  for each row execute function guard_admin_columns();

drop policy if exists "Users can list their own spaces" on rental_listings;
create policy "Users can list their own spaces" on rental_listings
  for insert with check (auth.uid() = owner_id);
drop policy if exists "Users can manage their own listings" on rental_listings;
create policy "Users can manage their own listings" on rental_listings
  for update using (auth.uid() = owner_id);
create policy "Hosts read their own listings" on rental_listings
  for select using (auth.uid() = owner_id);
create policy "Hosts delete their own listings" on rental_listings
  for delete using (auth.uid() = owner_id);

insert into storage.buckets (id, name, public) values ('listing-photos','listing-photos', true)
  on conflict (id) do nothing;
create policy "Public read listing photos" on storage.objects
  for select using (bucket_id = 'listing-photos');
create policy "Hosts upload own listing photos" on storage.objects
  for insert with check (bucket_id = 'listing-photos' and auth.role() = 'authenticated' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Hosts update own listing photos" on storage.objects
  for update using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Hosts delete own listing photos" on storage.objects
  for delete using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
