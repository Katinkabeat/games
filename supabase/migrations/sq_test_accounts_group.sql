-- c332 — "Test Accounts" group. Members are excluded from every leaderboard /
-- stat / win-loss surface (an MP game with a member in it is skipped for BOTH
-- players) and may replay dailies (a replay overwrites the day's result).
-- Membership is managed in the hub admin Groups panel like any other group.
-- Also renames the display name of beta-testers "Testies" → "Besties" (id unchanged).

update public.user_groups set name = 'Besties' where id = 'beta-testers' and name = 'Testies';

insert into public.user_groups (id, name, description)
values ('test-accounts', 'Test Accounts',
        'Excluded from all leaderboards and stats; can replay dailies. Games vs a member do not count for either player.')
on conflict (id) do nothing;

insert into public.user_group_members (group_id, user_id)
values ('test-accounts', '81aac26d-0b21-435e-8f25-f61c8ed21e92')  -- "Test"
on conflict do nothing;

-- SECDEF wrapper around user_in_group(): user_group_members is admin-only
-- under RLS, so SECURITY INVOKER leaderboard fns and the client couldn't see
-- membership. Answers a yes/no only; never exposes the member list.
create or replace function public.sq_is_test_account(uid uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.user_in_group(uid, 'test-accounts');
$$;
grant execute on function public.sq_is_test_account(uuid) to anon, authenticated;
