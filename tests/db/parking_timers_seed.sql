-- Supabase's default privileges, which a bare test cluster does not have.
--
-- A hosted project grants every new public table to anon and authenticated, so
-- the migration's `revoke all` is what closes the door. Without this file that
-- revoke has nothing to revoke here, and the check asserting it worked passes
-- on a cluster where the grants never existed — while production ships a
-- timers table any anonymous caller can read and write.
alter default privileges in schema public grant all on tables to anon, authenticated;
