// Shared helpers for Rook's Supabase edge functions (card c229 refactor).
//
// Every Rook function used the same boilerplate: a JSON responder, the request
// guard (method + shared-secret), and a service-role client. That was copy-pasted
// into each function; it now lives here once. Functions starting with `_` are not
// deployed as their own function — the CLI bundles this file into each importer
// at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { timingSafeEqual } from 'https://deno.land/std@0.177.0/crypto/timing_safe_equal.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ROOK_SECRET = Deno.env.get('ROOK_STATS_SECRET') ?? ''

// No CORS headers: these functions are called server-side by the bot with a
// shared secret, never from a browser. Advertising no Access-Control-Allow-Origin
// means a web page can't invoke a write-capable, service-role endpoint
// (security review L3). The bot's fetch isn't subject to CORS, so this is free.
export const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

// Constant-time shared-secret compare (security review M1). A plain `!==`
// short-circuits on the first differing byte, leaking a timing oracle on the one
// credential that gates every write path. Reject empty/mismatched-length first,
// then timingSafeEqual on equal-length buffers.
const secretOk = (secret: string) => {
  if (!ROOK_SECRET) return false // fail closed when unset
  const enc = new TextEncoder()
  const a = enc.encode(secret)
  const b = enc.encode(ROOK_SECRET)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

// Request guard: enforce POST (security review L4 — defense-in-depth) then the
// shared secret. Returns a Response to short-circuit (405 / 401), else null.
export const guard = (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!secretOk(req.headers.get('x-rook-secret') ?? '')) {
    return json({ error: 'unauthorized' }, 401)
  }
  return null
}

// Service-role client (server-side only; the bot never holds DB credentials).
export const serviceClient = () => createClient(SUPABASE_URL, SERVICE_KEY)

// Standardized 500 for a DB/RPC failure. Logs the real Postgres error server-side
// (journald captures it) but returns a GENERIC message, so schema details — table
// and function names in error.message — never reach the bot's logs (card c229).
// `extra` lets a caller keep its response shape, e.g. dbError(ctx, err, { ok: false }).
export const dbError = (
  context: string,
  error: { message?: string } | null,
  extra: Record<string, unknown> = {}
) => {
  console.error(`[rook] ${context}:`, error?.message ?? error)
  return json({ error: 'internal_error', ...extra }, 500)
}
