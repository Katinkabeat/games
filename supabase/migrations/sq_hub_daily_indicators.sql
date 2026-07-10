-- ============================================================
-- SQ hub — daily indicators (card c253)
--
-- 1. Turn on the daily indicator for Rungles + Oublex now that each
--    ships a <game>_played_daily(uid, ymd) fn. sq_unplayed_dailies
--    picks them up automatically. Yahdle/Snibble already true.
-- 2. Repoint games_catalog.description at each game's how-to opener —
--    the hub now shows this as the tile's info (ⓘ) blurb, not a
--    subtitle, so it wants a real one-line description of the game.
-- ============================================================

update public.games_catalog set has_daily = true
  where id in ('rungles', 'oublex');

update public.games_catalog set description =
  'Build words on the board from the tiles in your rack and rack up the highest score.'
  where id = 'wordy';

update public.games_catalog set description =
  'Build a ladder of connected words, each one a rung — 7 solo, 10 in multiplayer.'
  where id = 'rungles';

update public.games_catalog set description =
  'A cozy daily word pet. Each day it has one craving — a rule your words must follow.'
  where id = 'snibble';

update public.games_catalog set description =
  'Roll six letter dice, spell a word, and score it into one of 12 categories.'
  where id = 'yahdle';

update public.games_catalog set description =
  'A new dungeon takes shape each day. You get one run — spell your way through, or you don’t come back up.'
  where id = 'oublex';
