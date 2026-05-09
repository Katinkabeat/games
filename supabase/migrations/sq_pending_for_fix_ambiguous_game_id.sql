-- Fix ambiguous `game_id` reference in sq_pending_for.
-- The PL/pgSQL variable `game_row.id` (referenced as `game_id` via the
-- catalog loop) collided with the `user_game_access.game_id` column when
-- the first requires_access game (Yahdle) was added to the catalog.
-- Wraps the column reference with the table alias to disambiguate.

create or replace function public.sq_pending_for(uid uuid)
returns table(game_id text, count integer, label text, url text)
language plpgsql stable set search_path to 'public', 'pg_temp' as $$
declare
  game_row record;
begin
  for game_row in
    select id, requires_access from public.games_catalog
    where is_published = true order by sort_order
  loop
    if game_row.requires_access then
      if not exists (
        select 1 from public.user_game_access uga
        where uga.user_id = uid
          and uga.game_id = game_row.id
          and uga.status = 'allowed'
      ) then continue; end if;
    end if;
    begin
      return query execute format(
        'select %L::text as game_id, count, label, url from public.%I($1)',
        game_row.id,
        replace(game_row.id, '-', '_') || '_pending_for'
      ) using uid;
    exception when undefined_function then continue;
    end;
  end loop;
end;
$$;
