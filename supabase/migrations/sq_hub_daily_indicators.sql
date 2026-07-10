-- ============================================================
-- SQ hub — daily indicators (card c253)
--
-- 1. Turn on the daily indicator for Rungles + Oublex now that each
--    ships a <game>_played_daily(uid, ymd) fn. sq_unplayed_dailies
--    picks them up automatically. Yahdle/Snibble already true.
-- 2. Repoint games_catalog.description at each game's how-to opener.
--    The hub now shows this as the tile's info (i) blurb, not a
--    subtitle, so it wants a real one-line description of the game.
-- ============================================================

update public.games_catalog set has_daily = true
  where id in ('rungles', 'oublex');

update public.games_catalog set description =
  'Build words on a board from tiles in your rack and gather the most points. 1 - 4 players.'
  where id = 'wordy';

update public.games_catalog set description =
  'Build a ladder of connected words, each one a rung. Solo is 7 rungs, multiplayer is 10. Daily and 1 vs 1.'
  where id = 'rungles';

update public.games_catalog set description =
  'A cozy daily game where you feed your pet words. New word rules each day. Daily and 1 vs 1.'
  where id = 'snibble';

update public.games_catalog set description =
  'Roll six letter dice, spell a word, and score it into one of 12 categories. Daily and 2-4 players.'
  where id = 'yahdle';

update public.games_catalog set description =
  'A new dungeon takes shape each day. You get one run; spell your way through, or you don’t come back up. Daily and Multiplayer coming soon.'
  where id = 'oublex';
