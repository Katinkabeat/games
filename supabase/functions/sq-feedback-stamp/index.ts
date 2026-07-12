// Supabase Edge Function: sq-feedback-stamp (c192)
//
// Fires from a DB trigger on public.feedback whenever a row's `status` changes.
// It EDITs the row's original #feedback Discord message in place (PATCH
// /webhooks/{id}/{token}/messages/{message_id}) so the channel stays a
// one-line-per-item status board instead of piling up reply comments.
//
// Trust model: the message content is re-rendered ENTIRELY from the trusted DB
// row (read here with the service role), never from the request body — the
// caller only names WHICH feedback id to re-stamp. So this needs no shared
// secret. It is deployed with JWT verification ON; the DB trigger presents the
// project anon key (public.sq_anon_key()) as the gateway bearer, which sheds
// header-less scanners for free.
//
// Best-effort: always answers 200 (except a shape reject) so a Discord hiccup
// never turns into a failed DB transaction upstream.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderFeedbackMessage } from '../_shared/feedbackMessage.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FEEDBACK_WEBHOOK = Deno.env.get('SQ_DISCORD_FEEDBACK_WEBHOOK')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let payload: any
  try { payload = await req.json() } catch { return json({ error: 'bad json' }, 400) }

  // The trigger sends { record: <NEW row> }; accept a bare { id } too.
  const id = payload?.record?.id ?? payload?.id
  if (!id) return json({ error: 'id required' }, 400)

  if (!FEEDBACK_WEBHOOK) {
    console.error('sq-feedback-stamp: SQ_DISCORD_FEEDBACK_WEBHOOK not set')
    return json({ skipped: 'no webhook configured' })
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: row, error } = await admin
    .from('feedback')
    .select('username, category, message, context, status, status_note, discord_message_id')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('sq-feedback-stamp: row read failed', error.message)
    return json({ stamped: false, reason: 'row read failed' })
  }
  if (!row) return json({ skipped: 'no such row' })
  if (!row.discord_message_id) return json({ skipped: 'no discord message to edit' })

  try {
    const res = await fetch(`${FEEDBACK_WEBHOOK}/messages/${row.discord_message_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: renderFeedbackMessage(row),
        allowed_mentions: { parse: [] },
      }),
    })
    if (!res.ok) {
      console.error('sq-feedback-stamp: webhook PATCH returned', res.status)
      return json({ stamped: false, reason: `webhook http ${res.status}` })
    }
    return json({ stamped: true, status: row.status })
  } catch (err: any) {
    console.error('sq-feedback-stamp: webhook PATCH failed', err?.message)
    return json({ stamped: false, reason: 'webhook error' })
  }
})
