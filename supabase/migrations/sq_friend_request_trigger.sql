-- Re-apply this AFTER deploying the sq-friend-request-notification edge function
-- (see ../functions/sq-friend-request-notification/README.md for the deploy steps).
--
-- Wires a DB trigger that fires fire-and-forget HTTP POSTs to the edge function
-- on each new pending friendship row. Uses the pg_net extension (already installed).

CREATE OR REPLACE FUNCTION public.notify_friend_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/sq-friend-request-notification',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('record', row_to_json(NEW))
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friendships_notify_on_insert ON public.friendships;
CREATE TRIGGER friendships_notify_on_insert
  AFTER INSERT ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_friend_request();
