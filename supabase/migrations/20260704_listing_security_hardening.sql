-- Advisor fixes (NOT yet applied to production — MCP dropped mid-call;
-- run in Supabase SQL editor or re-apply via MCP):
-- pin search_path, use SECURITY INVOKER for the trigger, block RPC
-- execution, stop public bucket listing (object URLs still work).
create or replace function guard_admin_columns() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if (new.approved_by_founder is distinct from old.approved_by_founder
      or new.rejection_reason is distinct from old.rejection_reason)
     and coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only ParkEasy admins can change approval fields';
  end if;
  return new;
end $$;
revoke execute on function guard_admin_columns() from anon, authenticated, public;
drop policy if exists "Public read listing photos" on storage.objects;
