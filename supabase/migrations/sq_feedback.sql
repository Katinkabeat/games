-- User feedback / support channel (Raeban c119).
-- Inserts flow only through the sq-feedback edge function (service role, which
-- bypasses RLS) so the verified user id + username snapshot are attached
-- server-side and the path can be rate-limited later (c118).

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  username   text,        -- snapshot; survives profile rename/deletion (mirrors reports)
  category   text not null default 'other' check (category in ('bug','idea','other')),
  message    text not null check (char_length(message) between 1 and 4000),
  context    jsonb,       -- optional { page, game, user_agent }
  status     text not null default 'new' check (status in ('new','read','resolved')),
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- No authenticated insert policy by design: the edge function is the single
-- entry point. Dashboard reads use the service role and bypass RLS; this policy
-- is for a future in-app admin triage view.
drop policy if exists feedback_admin_select on public.feedback;
create policy feedback_admin_select on public.feedback
  for select
  using (exists (select 1 from public.admins a where a.user_id = (select auth.uid())));

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
