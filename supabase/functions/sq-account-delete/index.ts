import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

// Account deletion, email-confirmed, with a 30-day grace window.
//
//   action: 'request'  (auth'd)  -> create a one-time token, email the signed-in
//                                   user a confirmation link. Nothing is scheduled yet.
//   action: 'confirm'  (token)   -> validate the token, set the account to
//                                   deactivated + delete_after = now()+30d. The nightly
//                                   sweep (sweep_account_deletions) erases it after that.
//
// Erase itself (forfeit games, purge personal data, anonymize profile, scrub+lock the
// auth row) lives in the DB function _erase_account and runs via pg_cron — see
// migration sq_account_lifecycle.sql.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GMAIL_USER = Deno.env.get('GMAIL_USER')
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD')
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://katinkabeat.github.io/games/'

const GRACE_DAYS = 30
const TOKEN_TTL_MIN = 60

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function makeToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const body = await req.json().catch(() => ({}))
    const action = (body.action ?? '').toString()

    // ---- CONFIRM: token is the proof of intent/ownership; no login required ----
    if (action === 'confirm') {
      const token = (body.token ?? '').toString()
      if (!token) return json({ error: 'token_required' }, 400)

      const { data: tok } = await admin
        .from('account_deletion_tokens')
        .select('user_id, expires_at')
        .eq('token', token)
        .maybeSingle()

      if (!tok) return json({ error: 'invalid_token' }, 400)
      if (new Date(tok.expires_at).getTime() < Date.now()) {
        await admin.from('account_deletion_tokens').delete().eq('token', token)
        return json({ error: 'expired_token' }, 400)
      }

      const deleteAfter = new Date(Date.now() + GRACE_DAYS * 86400_000).toISOString()
      const { error: updErr } = await admin
        .from('profiles')
        .update({ deactivated_at: new Date().toISOString(), delete_after: deleteAfter })
        .eq('id', tok.user_id)
        .eq('is_anonymized', false)
      if (updErr) throw updErr

      await admin.from('account_deletion_tokens').delete().eq('user_id', tok.user_id)
      return json({ ok: true, deleteAfter }, 200)
    }

    // ---- REQUEST: must be the signed-in user; emails a confirmation link ----
    if (action === 'request') {
      const authToken = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
      if (!authToken) return json({ error: 'unauthorized' }, 401)

      const { data: userData, error: userErr } = await admin.auth.getUser(authToken)
      if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401)
      const user = userData.user
      if (!user.email) return json({ error: 'no_email_on_account' }, 400)

      const { data: profile } = await admin
        .from('profiles')
        .select('username, is_anonymized')
        .eq('id', user.id)
        .maybeSingle()
      if (profile?.is_anonymized) return json({ error: 'already_deleted' }, 400)

      // Fresh token: clear any prior pending tokens for this user first.
      await admin.from('account_deletion_tokens').delete().eq('user_id', user.id)
      const token = makeToken()
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60_000).toISOString()
      const { error: insErr } = await admin
        .from('account_deletion_tokens')
        .insert({ token, user_id: user.id, expires_at: expiresAt })
      if (insErr) throw insErr

      const base = SITE_URL.endsWith('/') ? SITE_URL : SITE_URL + '/'
      const link = `${base}?delete_confirm=${token}`

      if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
        // Misconfigured mailer must not silently "succeed".
        console.error('[sq-account-delete] mailer not configured')
        return json({ error: 'mailer_unavailable' }, 500)
      }

      let emailed = false
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
          to: user.email,
          subject: 'Confirm your account deletion',
          content:
            `Hi ${profile?.username ?? 'there'},\n\n` +
            `We received a request to delete your Rae's Side Quest account.\n\n` +
            `To confirm, open this link:\n${link}\n\n` +
            `Once confirmed, your account is locked immediately and permanently deleted ` +
            `after ${GRACE_DAYS} days. You can cancel any time before then by simply logging back in.\n\n` +
            `Your scores stay on the leaderboards but are anonymized (shown as a "Deleted player").\n\n` +
            `If you didn't request this, you can ignore this email. The link expires in ` +
            `${TOKEN_TTL_MIN} minutes.\n`,
        })
        emailed = true
        // denomailer can throw while tearing down the SMTP connection *after*
        // Gmail has already accepted the message, so a close() error must never
        // fail the request — the email has been sent.
        try { await client.close() } catch (_) { /* ignore teardown error */ }
      } catch (mailErr) {
        // Even a send() throw frequently happens post-delivery with this client
        // (matches the resilient sq-feedback pattern). Log it, keep the token so
        // the emailed link still works, and report success rather than blocking
        // the user on a teardown hiccup.
        console.error('[sq-account-delete] mailer threw (message may still have sent)', mailErr)
      }

      return json({ ok: true, emailed }, 200)
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (err) {
    console.error('[sq-account-delete] error', err)
    return json({ error: (err as Error).message }, 500)
  }
})
