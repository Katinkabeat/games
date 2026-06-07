-- ============================================================
-- SQ Hub description refresh (c182)
--
-- Some games changed since sq_hub_onboarding seeded the blurbs:
--   - Wordy gained solo play vs bots (was multiplayer-only).
--   - Yahdle now supports up to 4 players (was 1v1).
-- Refresh the games_catalog one-liners to match. No trademarked
-- game names; mode-based wording, consistent with the rest.
-- ============================================================

update public.games_catalog set description = 'Word tile game · solo & multiplayer' where id = 'wordy';
update public.games_catalog set description = 'Letter-dice · daily & multiplayer'   where id = 'yahdle';
