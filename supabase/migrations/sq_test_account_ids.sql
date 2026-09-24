-- c332 — batch variant of sq_is_test_account() for client-side stat code
-- (Rungles/Snibble/Yahdle compute MP W/L in the browser): returns the subset
-- of the given ids that are Test Accounts group members. Yes/no only per id
-- the caller already knows; never lists the group.
create or replace function public.sq_test_account_ids(uids uuid[])
returns uuid[] language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(u), '{}') from unnest(uids) u
   where public.user_in_group(u, 'test-accounts');
$$;
grant execute on function public.sq_test_account_ids(uuid[]) to authenticated;
