CREATE OR REPLACE FUNCTION public.create_game_with_bots(p_board jsonb, p_tile_bag text[], p_layout_version integer, p_players jsonb, p_current_player_idx integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_creator   UUID := auth.uid();
  v_game_id   UUID;
  v_player    JSONB;
  v_count     INT;
  v_first_uid UUID;
  v_first_bot BOOLEAN;
BEGIN
  IF v_creator IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_count := jsonb_array_length(p_players);
  IF v_count < 2 OR v_count > 4 THEN RAISE EXCEPTION 'Invalid player count'; END IF;

  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    IF (v_player->>'player_index')::int = 0 THEN
      IF (v_player->>'user_id')::uuid <> v_creator THEN RAISE EXCEPTION 'Seat 0 must be the creator'; END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = (v_player->>'user_id')::uuid AND is_bot) THEN
      RAISE EXCEPTION 'Non-creator seats must be computer players';
    END IF;
  END LOOP;

  INSERT INTO public.games (status, max_players, current_player_idx, board, tile_bag, board_layout_version, created_by)
  VALUES ('active', v_count, p_current_player_idx, p_board, p_tile_bag, p_layout_version, v_creator)
  RETURNING id INTO v_game_id;

  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    INSERT INTO public.game_players (game_id, user_id, player_index, rack)
    VALUES (v_game_id, (v_player->>'user_id')::uuid, (v_player->>'player_index')::int,
            ARRAY(SELECT jsonb_array_elements_text(v_player->'rack')));
  END LOOP;

  -- Kick off the first move if a bot is first (INSERT doesn't fire on_bot_turn,
  -- which is AFTER UPDATE). Subsequent turns use the normal trigger.
  SELECT gp.user_id INTO v_first_uid FROM public.game_players gp
    WHERE gp.game_id = v_game_id AND gp.player_index = p_current_player_idx;
  SELECT is_bot INTO v_first_bot FROM public.profiles WHERE id = v_first_uid;
  IF v_first_bot IS TRUE THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/bot-move',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
        ),
        body := jsonb_build_object('record', (SELECT row_to_json(g) FROM public.games g WHERE g.id = v_game_id))
      );
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'bot kickoff failed: %', SQLERRM; END;
  END IF;

  RETURN v_game_id;
END $function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.notify_bot_move()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_is_bot BOOLEAN;
BEGIN
  SELECT pr.is_bot INTO v_is_bot
  FROM public.game_players gp
  JOIN public.profiles pr ON pr.id = gp.user_id
  WHERE gp.game_id = NEW.id AND gp.player_index = NEW.current_player_idx;

  IF v_is_bot IS TRUE THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/bot-move',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
        ),
        body := jsonb_build_object('record', row_to_json(NEW))
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'bot-move trigger failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.notify_feedback_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.status is distinct from OLD.status and NEW.discord_message_id is not null then
    perform net.http_post(
      url := public.sq_functions_base_url() || '/sq-feedback-stamp',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.sq_anon_key()
      ),
      body := jsonb_build_object('record', row_to_json(NEW))
    );
  end if;
  return NEW;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.notify_friend_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM net.http_post(
      url := public.sq_functions_base_url() || '/sq-friend-request-notification',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('record', row_to_json(NEW))
    );
  END IF;
  RETURN NEW;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.notify_game_finished()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'game_finished',
        'record', row_to_json(NEW)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Game-end push trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.notify_turn_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Push notification trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.rg_decline_invite(p_game_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_invited uuid;
  v_status  text;
  v_creator uuid;
BEGIN
  SELECT invited_user_id, status, created_by INTO v_invited, v_status, v_creator
  FROM public.rg_games WHERE id = p_game_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;
  IF v_status <> 'waiting' THEN
    RAISE EXCEPTION 'Game has already started or closed';
  END IF;
  IF v_invited IS NULL OR v_invited <> v_uid THEN
    RAISE EXCEPTION 'You were not invited to this game';
  END IF;

  UPDATE public.rg_games
  SET status       = 'cancelled',
      cancelled_at = now(),
      finished_at  = now(),
      close_reason = 'Invite declined'
  WHERE id = p_game_id;

  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'invite_declined',
        'game_id', p_game_id,
        'creator_id', v_creator,
        'decliner_id', v_uid
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Rungles invite_declined push failed: %', SQLERRM;
  END;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.rg_expire_stale_games()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  g       RECORD;
  v_count int := 0;
BEGIN
  FOR g IN
    SELECT id, created_by FROM public.rg_games
     WHERE status = 'waiting'
       AND expires_at IS NOT NULL
       AND expires_at < now()
     FOR UPDATE
  LOOP
    UPDATE public.rg_games
       SET status = 'expired',
           close_reason = 'no_other_players',
           finished_at = now()
     WHERE id = g.id;

    -- One push to the creator (the only notification in this flow).
    BEGIN
      PERFORM net.http_post(
        url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
        ),
        body := jsonb_build_object(
          'type', 'game_closed',
          'record', jsonb_build_object(
            'id', g.id,
            'created_by', g.created_by,
            'close_reason', 'no_other_players'
          )
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Rungles game_closed push failed: %', SQLERRM;
    END;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.rg_notify_game_finished()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'game_finished',
        'record', row_to_json(NEW)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Rungles game-end push trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.rg_notify_game_invited()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'game_invited',
        'record', row_to_json(NEW)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Rungles game_invited push trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.rg_notify_opponent_joined()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_creator_id uuid;
BEGIN
  -- Skip the creator's own auto-insert when they create a game.
  SELECT created_by INTO v_creator_id
    FROM public.rg_games
   WHERE id = NEW.game_id;

  IF v_creator_id IS NULL OR v_creator_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type',       'opponent_joined',
        'game_id',    NEW.game_id,
        'joiner_id',  NEW.user_id,
        'creator_id', v_creator_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Rungles opponent_joined trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.rg_notify_turn_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Rungles push trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.sn_decline_invite(p_match_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invited uuid;
  v_status  text;
  v_creator uuid;
  v_uid     uuid := auth.uid();
begin
  select invited_user_id, status, creator_id into v_invited, v_status, v_creator
  from public.sn_matches where id = p_match_id for update;

  if not found then
    raise exception 'Match not found';
  end if;
  if v_status <> 'open' then
    raise exception 'Match has already started or closed';
  end if;
  if v_invited is null or v_invited <> v_uid then
    raise exception 'You were not invited to this match';
  end if;

  update public.sn_matches
  set status = 'cancelled',
      cancelled_at = now(),
      close_reason = 'Invite declined',
      last_activity_at = now()
  where id = p_match_id;

  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/snibble-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'invite_declined',
        'match_id', p_match_id,
        'creator_id', v_creator,
        'decliner_id', v_uid
      )
    );
  exception when others then
    raise warning 'Snibble invite_declined push failed: %', SQLERRM;
  end;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.sn_expire_stale_matches()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m       record;
  v_count int := 0;
begin
  for m in
    select id, creator_id from public.sn_matches
     where status = 'open'
       and expires_at is not null
       and expires_at < now()
     for update
  loop
    update public.sn_matches
       set status = 'expired',
           close_reason = 'no_other_players',
           last_activity_at = now()
     where id = m.id;

    -- One push to the creator (the only notification in this flow).
    begin
      perform net.http_post(
        url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/snibble-push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
        ),
        body := jsonb_build_object(
          'type', 'game_closed',
          'record', jsonb_build_object(
            'id', m.id,
            'creator_id', m.creator_id,
            'close_reason', 'no_other_players'
          )
        )
      );
    exception when others then
      raise warning 'Snibble game_closed push failed: %', SQLERRM;
    end;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.sn_notify_match_ended()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/snibble-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'game_finished',
        'record', row_to_json(NEW)
      )
    );
  exception when others then
    raise warning 'Snibble match-ended push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.sn_notify_match_invited()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/snibble-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'match_invited',
        'record', row_to_json(NEW)
      )
    );
  exception when others then
    raise warning 'Snibble match_invited push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.sn_notify_opponent_joined()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/snibble-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'opponent_joined',
        'record', row_to_json(NEW)
      )
    );
  exception when others then
    raise warning 'Snibble opponent_joined push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.sn_notify_round_submitted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/snibble-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'round_submitted',
        'record', row_to_json(NEW)
      )
    );
  exception when others then
    raise warning 'Snibble round_submitted push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.wordy_auto_start_or_cancel_stale()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_game RECORD;
  v_count int := 0;
  v_player_count int;
  v_first_player int;
BEGIN
  FOR v_game IN
    SELECT id, max_players, created_by FROM public.games
    WHERE status = 'waiting'
      AND expires_at IS NOT NULL
      AND expires_at < now()
  LOOP
    SELECT count(*) INTO v_player_count FROM public.game_players WHERE game_id = v_game.id;

    IF v_player_count >= 2 THEN
      -- Playable short-handed. Rotation is client-side over the joined
      -- players, so a partial table is fine; the no-show invitees stay in
      -- invited_user_ids for the greyed ✗ pills.
      v_first_player := floor(random() * v_player_count)::int;
      UPDATE public.games
      SET status = 'active',
          current_player_idx = v_first_player
      WHERE id = v_game.id;
    ELSE
      -- Only the creator — unplayable. Close with a reason instead of
      -- cancelling into the void. No finish_game() → no stats. No push
      -- trigger fires (those require status='active').
      UPDATE public.games
      SET status = 'finished',
          close_reason = 'no_other_players',
          finished_at = now()
      WHERE id = v_game.id;

      -- One push to the lone creator (the only notification in this flow).
      BEGIN
        PERFORM net.http_post(
          url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/push-notification',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
          ),
          body := jsonb_build_object(
            'type', 'game_closed',
            'record', jsonb_build_object(
              'id', v_game.id,
              'created_by', v_game.created_by,
              'close_reason', 'no_other_players'
            )
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Wordy game_closed push failed: %', SQLERRM;
      END;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.wordy_decline_invite(p_game_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid                uuid := auth.uid();
  v_game               record;
  v_joined             int;
  v_remaining_invitees int;
BEGIN
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;
  IF v_game.status <> 'waiting' THEN
    RAISE EXCEPTION 'Game has already started or closed';
  END IF;
  IF v_game.invited_user_ids IS NULL OR NOT (v_uid = ANY(v_game.invited_user_ids)) THEN
    RAISE EXCEPTION 'You were not invited to this game';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.game_players
    WHERE game_id = p_game_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'You have already joined this game';
  END IF;

  -- Remove me from the invite list.
  UPDATE public.games
  SET invited_user_ids = array_remove(invited_user_ids, v_uid)
  WHERE id = p_game_id;

  -- Recompute viability: joined players + remaining pending invitees.
  SELECT count(*) INTO v_joined
  FROM public.game_players WHERE game_id = p_game_id;

  SELECT count(*) INTO v_remaining_invitees
  FROM unnest(
    COALESCE((SELECT invited_user_ids FROM public.games WHERE id = p_game_id), '{}'::uuid[])
  ) AS i(id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.game_players gp
    WHERE gp.game_id = p_game_id AND gp.user_id = i.id
  );

  -- Only the creator remains and every invited friend has bailed → close
  -- it with a reason, and notify the creator (gated per-pref in edge fn).
  IF v_joined < 2 AND v_remaining_invitees = 0 THEN
    UPDATE public.games
    SET status       = 'cancelled',
        cancelled_at = now(),
        finished_at  = now(),
        close_reason = 'Invite declined'
    WHERE id = p_game_id;

    BEGIN
      PERFORM net.http_post(
        url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/push-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
        ),
        body := jsonb_build_object(
          'type', 'invite_declined',
          'game_id', p_game_id,
          'creator_id', v_game.created_by,
          'decliner_id', v_uid
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Wordy invite_declined push failed: %', SQLERRM;
    END;
  END IF;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.wordy_notify_game_invited()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.invited_user_ids IS NULL OR cardinality(NEW.invited_user_ids) = 0 THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object('type', 'game_invited', 'record', row_to_json(NEW))
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Wordy game_invited push trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.yahdle_decline_invite(p_game_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_creator uuid;
begin
  delete from public.yahdle_games
  where id = p_game_id
    and status = 'waiting'
    and invited_user_id = v_uid
  returning created_by into v_creator;

  if not found then raise exception 'Invite not found'; end if;

  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/yahdle-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'invite_declined',
        'game_id', p_game_id,
        'creator_id', v_creator,
        'decliner_id', v_uid
      )
    );
  exception when others then
    raise warning 'Yahdle invite_declined push failed: %', SQLERRM;
  end;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.yahdle_expire_stale_invites()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  g        record;
  v_joined int;
  n        int := 0;
begin
  -- No "opponent joined" pushes for the auto-starts below (txn-local).
  perform set_config('yahdle.suppress_join_push', '1', true);

  for g in
    select * from public.yahdle_games
     where status = 'waiting' and expires_at < now()
     for update
  loop
    select count(*) into v_joined
      from public.yahdle_players where game_id = g.id;

    if v_joined >= 2 then
      -- Playable: drop no-show slots (kept in invited_user_ids for the
      -- greyed ✗ pills), shrink to who's here, and start. Joined players
      -- always hold contiguous player_index 0..v_joined-1.
      update public.yahdle_games
         set max_players        = v_joined,
             status             = 'active',
             joined_at          = now(),
             current_player_idx = floor(random() * v_joined)::int,
             current_turn       = 1,
             last_activity_at   = now()
       where id = g.id;
    else
      -- Only the creator — unplayable. Close (not delete), file under
      -- Completed with a reason, and skip finalize so it never touches
      -- matchups / stats.
      update public.yahdle_games
         set status           = 'finished',
             finished_at      = now(),
             closed_reason    = 'no_other_players',
             winner_user_id   = null,
             is_tie           = false,
             last_activity_at = now()
       where id = g.id;

      -- One push to the lone creator (the only notification in this flow).
      begin
        perform net.http_post(
          url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/yahdle-push-notification',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
          ),
          body := jsonb_build_object(
            'type', 'game_closed',
            'record', jsonb_build_object(
              'id', g.id,
              'created_by', g.created_by,
              'closed_reason', 'no_other_players'
            )
          )
        );
      exception when others then
        raise warning 'Yahdle game_closed push failed: %', SQLERRM;
      end;
    end if;

    n := n + 1;
  end loop;

  return n;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.yahdle_notify_game_finished()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/yahdle-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'game_finished',
        'record', row_to_json(NEW)
      )
    );
  exception when others then
    raise warning 'Yahdle game_finished push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.yahdle_notify_game_invited()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if NEW.invited_user_id is null then
    return NEW;
  end if;
  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/yahdle-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'game_invited',
        'record', row_to_json(NEW)
      )
    );
  exception when others then
    raise warning 'Yahdle game_invited push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.yahdle_notify_opponent_joined()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if coalesce(current_setting('yahdle.suppress_join_push', true), '') = '1' then
    return NEW;
  end if;
  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/yahdle-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'opponent_joined',
        'record', row_to_json(NEW)
      )
    );
  exception when others then
    raise warning 'Yahdle opponent_joined push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$function$


-- --------------------------------

CREATE OR REPLACE FUNCTION public.yahdle_notify_turn_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/yahdle-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'turn_change',
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  exception when others then
    raise warning 'Yahdle turn_change push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$function$

