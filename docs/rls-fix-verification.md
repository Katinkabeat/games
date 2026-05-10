# RLS Fix Verification Checklist

**Context:** On 2026-05-06 we rewrote 67 RLS policies across the shared Supabase
project to fix the "Auth RLS Initialization Plan" warnings that were burning
through the Nano-tier IO budget. Logic was preserved exactly — every
`auth.uid()` / `auth.role()` / `auth.jwt()` was wrapped in `(SELECT ...)` so
Postgres caches it once per query instead of evaluating per row. Migration:
[wordy/fix-rls-initplan.sql](../../wordy/fix-rls-initplan.sql).

This list is for spot-checking that nothing broke. Tick items as you confirm.
**What "broken" looks like:** empty list where there should be data, "permission
denied" in console, or 403 on a Supabase REST call in network tab.

---

## Wordy
- [x] Lobby loads — your games + open public games visible *(2026-05-06)*
- [x] Open a game — board renders, your rack shows, opponent's last move visible *(2026-05-06, opened a game where it wasn't her turn)*
- [x] Create a game with friend invite — game appears in lobby, creator stays on lobby, invitee shows in invited list *(2026-05-06, fixed RLS recursion + removed auto-navigate)*
- [x] Play a turn (placement → submit) end-to-end *(2026-05-06)*
- [x] Stats page loads on first tap *(2026-05-06, after revert to original query shape + try/finally guard)*
- [x] Push: opponent's-turn notifications fire (got pinged when snuggie played) *(2026-05-06)*

## Rungles
- [x] Solo game starts and saves rack *(2026-05-06)*
- [x] Multi lobby shows your games *(2026-05-06)*
- [x] Joining + playing a multi game works *(2026-05-06)*

## Snibble
- [x] Daily critter feed loads *(2026-05-06)*
- [x] Match mode: lobby visible, can join an open match, can submit a play *(2026-05-06)*

## SQ Hub (games portal)
- [x] Sign in works *(confirmed 2026-05-06)*
- [x] Game tiles render, links work *(2026-05-06)*
- [x] Notification preferences page loads + saves *(2026-05-06)*

## Cross-cutting
- [x] Friends list visible, can block/unblock a user *(2026-05-06, unblock works but doesn't re-add as friend — expected)*
- [ ] Report flow gating *(deferred — will test with a new game to avoid disrupting active players)*
- [x] Admin pages (master admin login): announcements, user management *(2026-05-06)*

---

## Tables touched by the migration
For reference if something breaks and you need to know what to look at:

**Wordy:** `games`, `game_players`, `game_moves`, `player_matchups`, `push_subscriptions`
**Rungles:** `rg_games`, `rg_racks`, `rg_solo_games`
**Snibble:** `sn_app_settings`, `sn_daily_feeds`, `sn_match_round_plays`, `sn_match_rounds`, `sn_matches`, `sn_progress`
**SQ shared:** `profiles`, `friendships`, `admins`, `announcements`, `reports`, `games_catalog`, `sq_events`, `user_blocks`, `user_game_access`, `user_group_members`, `user_groups`, `user_notification_prefs`

## How to report a regression to Claude
Send: table name + what you were doing + the error (console message or network 4xx). I can patch the specific policy without touching the others.
