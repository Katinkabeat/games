// Shared #error-log reporter (c265/c266 pattern, extracted for c291).
//
// Posts a short Rook message to the private #error-log Discord channel when a
// server-side side-effect fails in a way the user never sees. Best-effort by
// design: a failed report must never mask or block the original operation.
//
// The 8 push functions still carry their own inlined copies of this helper;
// folding them onto this module is refactor-backlog work (each needs a
// redeploy to pick it up).

const ERRORLOG_WEBHOOK = Deno.env.get('SQ_DISCORD_ERRORLOG_WEBHOOK') ?? ''

export async function reportServerError(topic: string, detail: string) {
  if (!ERRORLOG_WEBHOOK) return
  try {
    await fetch(ERRORLOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Rook',
        content: `**SideQuest** — server error\n\`${topic}\`\ndetail: ${String(detail ?? '').slice(0, 500)}`,
        allowed_mentions: { parse: [] },
      }),
    })
  } catch (_e) {
    // best-effort: a failed report must never mask the original error
  }
}
