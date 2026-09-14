// Supabase Edge Function: sq-feedback-sweep (c291)
//
// Reconciliation sweep for the feedback pipeline — the layer push-on-failure
// reporting structurally can't provide. sq-feedback reports Discord-mirror
// failures it CATCHES; this sweep catches the ones it can't (function died
// mid-flight, pg_net drop, report itself failed) by checking reality against
// expectation: any feedback row still status 'new' with no discord_message_id
// after an hour is invisible at triage time, and someone should hear about it.
//
// Fired hourly by pg_cron (sq_feedback_sweep.sql) with the anon key as the
// gateway bearer, same trust model as sq-feedback-stamp: no request data is
// trusted, everything is read fresh with the service role.
//
// Deliberately re-reports every hour until the row is triaged — a status
// change (read/carded/…) is what silences it. Lost feedback should keep
// making noise until it's been seen.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { reportServerError } from '../_shared/errorlog.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  // The table is tiny (one index on created_at, a handful of rows), so a
  // failure here is the shared project's API gateway stalling (504 "Gateway
  // Timeout" seen ~25% of ticks, 2026-09-13), not the query. Retry with a
  // short backoff and only alert once every attempt has failed — a missed
  // tick costs nothing (the next hour re-checks the same rows), but a real
  // outage should still be loud.
  const query = () =>
    admin
      .from('feedback')
      .select('id, username, category, created_at')
      .eq('status', 'new')
      .is('discord_message_id', null)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(20)

  const BACKOFF_MS = [2000, 4000]
  let rows: { id: string; username: string | null; category: string; created_at: string }[] | null = null
  let lastError: string | null = null
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]))
    const { data, error } = await query()
    if (!error) {
      rows = data
      lastError = null
      break
    }
    lastError = error.message
    console.warn(`sq-feedback-sweep: query attempt ${attempt + 1} failed`, error.message)
  }

  if (lastError !== null) {
    console.error('sq-feedback-sweep: query failed', lastError)
    await reportServerError(
      'sq-feedback-sweep: query failed',
      `${lastError} (after ${BACKOFF_MS.length + 1} attempts)`
    )
    return json({ swept: false, reason: 'query failed' })
  }

  if (!rows || rows.length === 0) return json({ swept: true, orphans: 0 })

  const lines = rows.map(
    (r) => `• \`${r.id}\` [${r.category}] from ${r.username ?? '(no username)'} at ${r.created_at}`
  )
  await reportServerError(
    'sq-feedback-sweep: feedback missing from #feedback',
    `${rows.length} untriaged row(s) with no Discord mirror — visible only in the table:\n${lines.join('\n')}\n(re-alerts hourly until triaged)`
  )
  return json({ swept: true, orphans: rows.length })
})
