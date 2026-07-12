-- Feedback → Discord triage mirror + agent-to-Raeban pipeline plumbing (c192).
--
-- Additive to sq_feedback.sql:
--   * extend the status vocabulary with the triage outcomes,
--   * record the mirrored Discord message id, a linked Raeban card, and a
--     short human note for the status stamp,
--   * fire the sq-feedback-stamp edge function on ANY status change so the
--     Discord message is edited in place — this ONE path catches both manual
--     dashboard marks and the triage agent, so the channel never drifts.
--
-- Apply AFTER sq_functions_base_url.sql (the trigger calls those helpers) and
-- AFTER deploying the sq-feedback-stamp edge function.

-- 1. Triage outcomes join the existing lifecycle values.
alter table public.feedback drop constraint if exists feedback_status_check;
alter table public.feedback add constraint feedback_status_check
  check (status in ('new','read','resolved','carded','rejected','duplicate'));

-- 2. New columns (all nullable; existing rows unaffected).
alter table public.feedback add column if not exists discord_message_id text;
alter table public.feedback add column if not exists raeban_card_id      text;
alter table public.feedback add column if not exists status_note         text; -- stamp detail: card short-id, dup target, or reject reason

-- 3. Stamp the Discord message whenever status changes. Fire-and-forget via
--    pg_net; the edge function re-renders from the trusted row, so we only need
--    to name the id. Skip when there's no mirrored message to edit yet.
create or replace function public.notify_feedback_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

drop trigger if exists feedback_stamp_on_status_change on public.feedback;
create trigger feedback_stamp_on_status_change
  after update of status on public.feedback
  for each row
  execute function public.notify_feedback_status();
