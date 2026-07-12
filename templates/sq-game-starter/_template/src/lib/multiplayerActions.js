import { supabase } from './supabase.js'
// Imported from the utils module rather than sq-ui's index so this non-React
// lib file doesn't pull the package's JSX components into its chunk.
import { postNudge, nudgeFailureMessage } from '../../../rae-side-quest/packages/sq-ui/utils/nudge.js'

// Thin wrappers around the {{name}} multiplayer RPCs (see
// supabase/migrations/{{slug}}_multiplayer.sql + {{slug}}_nudge.sql).
// All game-state mutations go server-side (SECURITY DEFINER) — this file
// just relays. This is the GENERIC multiplayer surface; the only
// game-specific call here is submitTurn (the stub turn RPC).

// Create a multiplayer game. invitedUserIds empty => an OPEN game any
// user can join (server caps one open game per creator). maxPlayers is
// 2–4; reserved invitee seats + open seats fill to that count.
export async function createGame({ invitedUserIds = [], maxPlayers = 2 } = {}) {
  const { data, error } = await supabase.rpc('{{slug}}_create_game', {
    p_invited_user_ids: invitedUserIds.length ? invitedUserIds : null,
    p_max_players: maxPlayers,
  })
  if (error) throw error
  return { gameId: data }
}

export async function acceptInvite(gameId) {
  const { error } = await supabase.rpc('{{slug}}_accept_invite', { p_game_id: gameId })
  if (error) throw error
}

// Join any waiting game with a free seat (open or one you're invited to).
// Server assigns the next player_index and auto-starts when full.
export async function joinGame(gameId) {
  const { error } = await supabase.rpc('{{slug}}_join_game', { p_game_id: gameId })
  if (error) throw error
}

// Back-compat alias — the join path is unified server-side.
export async function joinOpenGame(gameId) {
  const { error } = await supabase.rpc('{{slug}}_join_open_game', { p_game_id: gameId })
  if (error) throw error
}

export async function listOpenGames() {
  const { data, error } = await supabase.rpc('{{slug}}_list_open_games')
  if (error) throw error
  return data ?? []
}

export async function declineInvite(gameId) {
  const { error } = await supabase.rpc('{{slug}}_decline_invite', { p_game_id: gameId })
  if (error) throw error
}

export async function cancelInvite(gameId) {
  const { error } = await supabase.rpc('{{slug}}_cancel_invite', { p_game_id: gameId })
  if (error) throw error
}

// ── GAME-SPECIFIC: submit a turn ──────────────────────────────
// Calls the STUB {{slug}}_submit_turn(p_game_id, p_score) RPC, which just
// adds an integer to the caller's total_score + advances the turn. Replace
// this with your real move RPC (and its real payload) once you build
// gameplay — see the big comment on {{slug}}_submit_turn in the migration.
export async function submitTurn(gameId, score) {
  const { error } = await supabase.rpc('{{slug}}_submit_turn', {
    p_game_id: gameId,
    p_score: score,
  })
  if (error) throw error
}

export async function forfeitGame(gameId) {
  const { error } = await supabase.rpc('{{slug}}_forfeit_game', { p_game_id: gameId })
  if (error) throw error
}

export async function claimInactiveWin(gameId) {
  const { error } = await supabase.rpc('{{slug}}_claim_inactive_win', { p_game_id: gameId })
  if (error) throw error
}

// Nudge the current player that it's their turn. {{slug}}_nudge validates the
// caller is a waiting participant + checks the 12h cooldown; {{slug}}_mark_nudged
// stamps the cooldown only AFTER the push lands (see the migration).
export async function sendNudge(gameId, nudgerName) {
  const { error } = await supabase.rpc('{{slug}}_nudge', { p_game_id: gameId })
  if (error) throw error
  // The push IS the nudge, so (unlike a fire-and-forget ping) we await it and
  // report failure — otherwise the nudger gets a false "sent" toast when
  // delivery silently dropped (c239). postNudge also reads the 200 body: the
  // edge fn answers { sent: false } for an opted-out or unsubscribed recipient,
  // and res.ok alone can't tell those apart (c259).
  const { delivered, reason } = await postNudge({
    url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/{{slug}}-push-notification`,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    reportUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sq-report-client-error`,
    game: '{{slug}}',
    body: { type: 'nudge', game_id: gameId, nudger_name: nudgerName },
  })
  if (!delivered) throw new Error(nudgeFailureMessage(reason))
  // Start the 12h cooldown only now that the push actually landed. {{slug}}_nudge
  // no longer stamps up-front, so a failed send above never locks the game (c264).
  // supabase.rpc() returns a thenable, not a Promise — it has no .catch(), so
  // chaining one throws a TypeError *after* the push has gone out, surfacing as
  // a false "couldn't send" toast (c261). Await and warn instead: the push
  // landing is what "sent" means, and a missed stamp must never report failure.
  const { error: markErr } = await supabase.rpc('{{slug}}_mark_nudged', { p_game_id: gameId })
  if (markErr) console.warn('[nudge] cooldown stamp failed:', markErr)
}

export async function rematch(prevGameId) {
  const { data, error } = await supabase.rpc('{{slug}}_rematch', { p_game_id: prevGameId })
  if (error) throw error
  return { gameId: data }
}

// Admin-only — gated by the shared `public.admins` table's `close_games`
// permission (RPCs in {{slug}}_admin_close_game.sql). The RPC raises if
// the caller lacks it.
export async function adminListOpenGames() {
  const { data, error } = await supabase.rpc('{{slug}}_admin_list_open_games')
  if (error) throw error
  return data ?? []
}

export async function adminCloseGame(gameId, reason) {
  const { error } = await supabase.rpc('{{slug}}_admin_close_game', {
    p_game_id: gameId,
    p_reason: reason,
  })
  if (error) throw error
}

// Read-side helpers ────────────────────────────────────────────

export async function loadGame(gameId) {
  const { data, error } = await supabase
    .from('{{slug}}_games')
    .select('*')
    .eq('id', gameId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function loadPlayers(gameId) {
  const { data, error } = await supabase
    .from('{{slug}}_players')
    .select('*')
    .eq('game_id', gameId)
    .order('player_index')
  if (error) throw error
  return data ?? []
}
