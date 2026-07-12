// Shared renderer for the PRIVATE #feedback Discord triage channel (c192).
//
// Both sq-feedback (initial post on insert) and sq-feedback-stamp (edit on
// status change) render the SAME message from a feedback row, so the channel
// stays a one-line-per-item status board: the original submission stays put and
// only the status stamp at the top changes as the item is triaged.
//
// The message content is derived ENTIRELY from the trusted DB row — never from
// caller-supplied text — so the stamp endpoint can be called without a shared
// secret: the worst a spoofed call can do is re-stamp a message to the state it
// already reflects in the database.

export interface FeedbackRow {
  username: string | null
  category: string | null
  message: string | null
  context: { page?: string | null; game?: string | null } | null
  status: string | null
  status_note?: string | null
}

const CATEGORY_EMOJI: Record<string, string> = {
  bug: '🐞',
  idea: '💡',
  other: '💬',
}

const GAME_LABEL: Record<string, string> = {
  wordy: 'Wordy',
  yahdle: 'Yahdle',
  rungles: 'Rungles',
  snibble: 'Snibble',
  oublex: 'Oublex',
}

// Trim + hard-cap so a huge submission can't flood the channel.
function clamp(v: unknown, max: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

// The status line at the top of the message. `status_note` carries the
// human detail: the short card id for carded (e.g. "c193"), the target for
// a duplicate ("c47"), or a short reason for a rejection.
function statusLine(status: string | null, note: string | null | undefined): string {
  const n = clamp(note, 120)
  switch (status) {
    case 'carded':
      return `✅ **Carded**${n ? ` · ${n}` : ''}`
    case 'rejected':
      return `🚫 **Rejected**${n ? ` · ${n}` : ''}`
    case 'duplicate':
      return `🔁 **Duplicate**${n ? ` of ${n}` : ''}`
    case 'resolved':
      return '✔️ **Resolved**'
    case 'read':
      return '👀 **Read**'
    case 'new':
    default:
      return '🆕 **New**'
  }
}

export function renderFeedbackMessage(row: FeedbackRow): string {
  const category = (row.category ?? 'other').toLowerCase()
  const catEmoji = CATEGORY_EMOJI[category] ?? '💬'
  const catLabel = category.charAt(0).toUpperCase() + category.slice(1)

  const game = row.context?.game ? (GAME_LABEL[row.context.game] ?? row.context.game) : null
  const page = row.context?.page ?? null
  const where = game ?? page // prefer the game name; fall back to a page slug

  const who = clamp(row.username, 60) || 'anonymous'

  const headerBits = [`${catEmoji} **${catLabel}**`, who]
  if (where) headerBits.push(clamp(where, 48))

  return [
    statusLine(row.status, row.status_note),
    headerBits.join(' · '),
    `> ${clamp(row.message, 1500)}`,
  ].join('\n')
}
