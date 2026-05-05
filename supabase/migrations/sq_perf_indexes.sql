-- SQ platform — perf indexes (2026-05-04).
--
-- Adds indexes on columns that get queried by user_id frequently from
-- the lobbies, stats RPCs, and streak calculations. At current data
-- size all of these queries already run sub-100ms via full table scans,
-- but scan cost grows linearly with table size. Adding the indexes now
-- so we don't hit a wall later.
--
-- Composite (user_id, created_at) indexes match the streak query
-- pattern in sq_get_stats: filter by user, then sort/distinct by date.
-- Postgres can use the leading column alone too, so a single composite
-- index covers both "all my rows" and "my rows by date" queries.
--
-- IF NOT EXISTS makes this safe to re-run. CREATE INDEX without
-- CONCURRENTLY is fine here — tables are small enough that the brief
-- write lock isn't observable.

create index if not exists game_players_user_id_idx
  on public.game_players(user_id);

create index if not exists rg_players_user_id_idx
  on public.rg_players(user_id);

create index if not exists rg_solo_games_user_id_idx
  on public.rg_solo_games(user_id);

create index if not exists game_moves_user_created_idx
  on public.game_moves(user_id, created_at);

create index if not exists rg_rungs_player_created_idx
  on public.rg_rungs(player_user_id, created_at);
