import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Email forwarding is optional: until these are set the function still records
// the row and just returns { emailed: false }.
const GMAIL_USER = Deno.env.get('GMAIL_USER')
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD')
const FEEDBACK_TO = Deno.env.get('FEEDBACK_TO') ?? GMAIL_USER

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CATEGORIES = new Set(['bug', 'idea', 'other'])

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!token) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401)
    const user = userData.user

    const body = await req.json().catch(() => ({}))
    const message = (body.message ?? '').toString().trim()
    let category = (body.category ?? 'other').toString()
    if (!CATEGORIES.has(category)) category = 'other'
    if (!message) return json({ error: 'message_required' }, 400)
    if (message.length > 4000) return json({ error: 'message_too_long' }, 400)

    const { data: profile } = await admin
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle()
    const username = profile?.username ?? null

    const context = {
      page: body.page ?? null,
      game: body.game ?? null,
      user_agent: req.headers.get('user-agent') ?? null,
    }

    const { data: row, error: insErr } = await admin
      .from('feedback')
      .insert({ user_id: user.id, username, category, message, context })
      .select('id')
      .single()
    if (insErr) throw insErr

    let emailed = false
    if (GMAIL_USER && GMAIL_APP_PASSWORD && FEEDBACK_TO) {
      try {
        const client = new SMTPClient({
          connection: {
            hostname: 'smtp.gmail.com',
            port: 465,
            tls: true,
            auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
          },
        })
        await client.send({
          from: GMAIL_USER,
          to: FEEDBACK_TO,
          subject: `SideQuest feedback [${category}] from ${username ?? user.email ?? 'a user'}`,
          content:
            `From: ${username ?? '(no username)'} <${user.email ?? 'no-email'}>\n` +
            `User ID: ${user.id}\n` +
            `Category: ${category}\n` +
            `Page: ${context.page ?? '-'}   Game: ${context.game ?? '-'}\n\n` +
            `${message}\n\n` +
            `(feedback id ${row.id})`,
        })
        await client.close()
        emailed = true
      } catch (mailErr) {
        // The row is saved; a broken mailer must not fail the user's submission.
        console.error('[sq-feedback] email send failed', mailErr)
      }
    }

    return json({ ok: true, id: row.id, emailed }, 200)
  } catch (err) {
    console.error('[sq-feedback] error', err)
    return json({ error: (err as Error).message }, 500)
  }
})
