-- ============================================================
-- SQ Hub Onboarding (c120)
--
-- 1. games_catalog.description — one-line blurb shown under each
--    game name on the hub landing page. Mode-based wording, no
--    trademarked game names.
-- 2. profiles.welcomed_at — first-run flag for the hub welcome
--    banner. NULL = never welcomed (new signup) => show the banner
--    once. Existing accounts are backfilled to now() so the banner
--    only ever appears for people who sign up after this ships.
-- ============================================================

-- 1. Game blurbs
alter table public.games_catalog
  add column if not exists description text;

update public.games_catalog set description = 'Word tile game · multiplayer'  where id = 'wordy';
update public.games_catalog set description = 'Word game · solo & multiplayer' where id = 'rungles';
update public.games_catalog set description = 'Cozy daily word game · 1v1'     where id = 'snibble';
update public.games_catalog set description = 'Letter-dice · daily & 1v1'      where id = 'yahdle';

-- 2. Welcome-banner first-run flag
alter table public.profiles
  add column if not exists welcomed_at timestamptz;

-- Backfill: the handle_new_user trigger doesn't set welcomed_at, so
-- new signups land with NULL and see the banner once. Everyone who
-- already has an account is stamped now() so they never see it.
update public.profiles set welcomed_at = now() where welcomed_at is null;
