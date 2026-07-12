# SQ Game Starter

Scaffolds a new SideQuest game pre-wired with all the SQ chrome (sq-ui, dual-header,
Supabase auth bounce, theme-flash prevention, hub push-heal, GitHub Pages
deploy, dev tooling).

> Games are NOT installable PWAs and register no service worker (c272). Push is
> centralized at the hub: `installPushHeal()` (in `main.jsx`) keeps the shared
> `sidequest` subscription fresh, and the `<slug>-push-notification` edge function
> sends to it. The only installable SideQuest app is the hub.

## Layout

- `_template/` — source files with `{{slug}}`, `{{name}}`, `{{themeColor}}` etc.
  placeholders. The init script copies these into a new sibling folder and
  substitutes the values.
- `init.mjs` — the scaffolder. Run from the rae-side-quest repo root.

## Run it

```bash
node templates/sq-game-starter/init.mjs \
  --slug=mygame \
  --name="My Game" \
  --description="A cozy word game" \
  --color="#7c3aed" \
  --background="#fef3c7" \
  --port=5184
```

Creates `../mygame/` as a sibling to `rae-side-quest/`, runs `git init`, and
makes an initial commit. Does NOT create a GitHub repo or push — that's a
separate explicit step.

## What still needs to happen after scaffolding

1. Add the new game to `rae-side-quest`'s `dev:all` script
2. Add it to the SQ hub landing page game grid + post-login allowlist
3. **Stand up the solo daily** (if the game has one) — run
   `supabase/migrations/<slug>_solo_results.sql`, then
   `<slug>_solo_results_write_guard.sql`, then `<slug>_solo_leaderboards.sql`.
   Write results only through the guard RPC; never upsert the table directly.
   See "Solo results + leaderboard" below.
4. **Stand up multiplayer** — run `supabase/migrations/<slug>_multiplayer.sql`
   then `<slug>_nudge.sql` in the Supabase SQL editor, fill in the push-trigger
   `<PROJECT_REF>` / `<ANON_JWT>` placeholders, run `<slug>_admin_close_game.sql`,
   and deploy the `<slug>-push-notification` edge function (see "Multiplayer"
   below)
5. Wire it into the shared notification system (subscription side:
   `src/lib/pushNotifications.js` / the hub) — the edge function + DB triggers
   already ship
6. Update the theme-flash localStorage fallback list in OTHER games' `index.html`
   to include the new `<slug>-theme` key (so users mid-migration don't flash)
7. Build the actual game (replace the MP turn stub + play-area placeholder)
8. Patch the hub's `LandingPage.jsx` `hub-inbox` channel to subscribe to your
   tables (see "Multiplayer")
9. `gh repo create` + push when ready

## Multiplayer (baked in)

The scaffold ships a **complete N-player (2–4) multiplayer** engine ported
generically from Yahdle — you don't retrofit it, you just plug your gameplay
into the one stubbed seam. It includes:

- Open games **and** friend invites (single + multi-friend via
  `invited_user_ids uuid[]`), one open game per creator, auto-start when seats fill
- **Per-game invite enforcement** baked in (c200): a `<slug>_check_invitable`
  trigger honours each invitee's "who can invite me" preference for this game
  (anyone / friends only / nobody), falling back to their global setting.
  Automatic — no extra step. The game appears on the hub's **Invites** settings
  page as soon as you add it to `src/lib/notificationTopics.js` `APPS` (the same
  list that drives Notifications). Requires the hub's `sq_invite_prefs.sql` to
  have run on the project (it has).
- Modulo turn rotation `(idx + 1) % N` that skips forfeited seats
- **Top-score-group-wins** finalize (sole top = win; tied top = all win; ties
  are never recorded), forfeit-continue (others play on, last one standing
  wins), claim-inactive-win after 7 days, per-pair W/L matchups
- The 🔔 **nudge** feature (12h server-side cooldown) and all 6 push types
  (`game_invited` fan-out, `opponent_joined`, `turn_change`, `game_finished`
  fan-out, `nudge`, `game_closed`)
- **SQ invite-expiry policy** baked in (the c150/c151/c152 baseline): friend
  invites expire in 3 days (open games 7). At expiry a game is **never
  silently deleted** — if ≥2 players joined it drops the no-show invitee
  slots, shrinks to who's here and starts short-handed (no-shows render as
  greyed ✗ pills); if only the creator is seated it closes with
  `closed_reason='no_other_players'` (filed under Completed with an "invite
  expired" blurb, one `game_closed` push, no stats/matchups recorded)
- `<slug>_is_participant()` + N-player RLS, realtime publication, and
  `<slug>_pending_for(uid)` for the hub bell

**Files:**

- Backend: `supabase/migrations/<slug>_multiplayer.sql` (schema + RPCs + RLS +
  expiry + push triggers + realtime publication), `<slug>_nudge.sql`, and the
  `supabase/functions/<slug>-push-notification/` edge function.
- Frontend: `src/lib/multiplayerActions.js`, `src/hooks/useMultiplayerLobby.js`,
  `src/hooks/useFriends.js`, `src/components/lobby/MultiplayerCard.jsx` +
  `CreateGameSheet.jsx`, `src/components/game/MultiGamePage.jsx`.
  `LobbyPage.jsx` already wires `useMultiplayerLobby` and passes the buckets in.

**Setup after scaffolding:**

1. Run `<slug>_multiplayer.sql`, then `<slug>_nudge.sql`, then
   `<slug>_admin_close_game.sql` in the SQL editor. The first one adds both
   tables to the `supabase_realtime` publication and creates
   `<slug>_pending_for(uid)` — so there's no separate "enable realtime" step.
2. In `<slug>_multiplayer.sql` **section 20**, replace `<PROJECT_REF>` and
   `<ANON_JWT>` in the push triggers (the SQ shared project ref is
   `yyhewndblruwxsrqzart`). The edge function only needs a valid JWT to verify;
   it uses its own service-role key.
3. Deploy the edge function: `supabase functions deploy <slug>-push-notification`
   (reuses the shared `VAPID_*` secrets).
4. Patch the hub's `LandingPage.jsx` `hub-inbox` channel to subscribe to
   `<slug>_games` / `<slug>_players` — copy the existing `sn_matches` /
   `sn_match_round_plays` `.on(...)` lines and swap in your slug. (The hub's
   `sq_pending_for(uid)` already calls `<slug>_pending_for` automatically.)

**The ONLY game-specific seams (replace these with real gameplay):**

- `<slug>_submit_turn(p_game_id uuid, p_score int)` in the migration is a
  **STUB**: it verifies it's the caller's turn + the game is active, adds the
  passed-in integer to `total_score`, bumps `turns_taken`, and advances the
  turn. It exists so the engine is playable end-to-end (turns rotate, the game
  finishes, a winner is picked) before you build gameplay. Replace `p_score`
  with your real move payload + server-side validation + scoring.
- The **GAME-SPECIFIC PLAY AREA** block in `MultiGamePage.jsx` is a demo
  number-input + "Submit turn" button calling that stub. Replace it with your
  board / dice / cards. (Also replace the minimal `OpponentSheet` inspector.)
- `<slug>_total_turns()` (default `1`) defines how many turns each player takes
  before the game finalizes — bump it (Yahdle uses 12) once gameplay is defined,
  or rework the "everyone done" check in `<slug>_advance_turn` if your game ends
  differently.
- Add your own per-player columns to `<slug>_players` as your gameplay needs.

`src/hooks/useRealtimeChannel.js` (the connection-resilience wrapper) is shared
infra and is already wired into both the lobby hook and the game page.

See `docs/sq-conventions.md` for full SQ patterns.

## Stats page + extended leaderboards (c92 pattern)

The scaffold ships with a working **StatsPage** at `/stats` (linked from the
avatar menu) that includes the c92 extended-leaderboard pattern out of the box:
**Day / Week / Month / All-time** tabs with a date stepper on Day for scrolling
back through past days. Identical chrome to Yahdle / Snibble / Rungles.

It comes with three matching migrations:

- `supabase/migrations/<slug>_solo_results.sql` — minimal one-row-per-user-per-day
  table (`user_id`, `play_date`, `score`, `completed_at`). Apply this first.
  It grants **read-only** RLS on purpose (see next bullet).
- `supabase/migrations/<slug>_solo_results_write_guard.sql` — the SECURITY
  DEFINER `<slug>_record_solo_result(p_play_date, p_score)` RPC, the **only**
  writer of that table. It stamps `user_id` from `auth.uid()` and refuses any
  `play_date` that isn't the current Atlantic day. Apply it with the table.
- `supabase/migrations/<slug>_solo_leaderboards.sql` — the two RPCs
  (`<slug>_solo_leaderboard` and `<slug>_solo_my_rank`) the StatsPage calls.
  Default: **per-user SUM across the window** (each user appears once;
  Week = sum of daily scores, etc).

**To light it up:** apply all three, then call `<slug>_record_solo_result` when
a player finishes a session — use the `recordResult()` helper already wired into
`src/components/game/SoloGamePage.jsx`. The leaderboard fills in automatically.

**Do not** grant `insert_own` / `update_own` / `delete_own` on
`<slug>_solo_results` and do not upsert it straight from the client. A
client-chosen `play_date` lets a stale tab pad *yesterday's* board after
midnight, and delete-own lets a player wipe today's result to replay the daily.

**Never make the result write fire-and-forget.** `recordResult()` awaits the
RPC, calls `supabase.auth.refreshSession()` and retries on failure (a
backgrounded mobile tab's access token expires and 401s), and surfaces the true
save state — "Saving… / logged / Couldn't save, retry" — rather than always
claiming success. A silent failure loses the score, and if your game also
persists a resume snapshot it strands the player in a replay loop: they finish,
the write dies quietly, the snapshot survives, and every reopen puts them back
at the end of the run. That bug shipped in Oublex and cost a player three
re-runs of the same dungeon. See `feedback_sq_result_write_resilience`. The one
error you must **not** retry is the guard's non-today rejection — show "this
day has ended" instead.

**When to deviate from the default:**

- **Game allows many plays per day** (Rungles-style): swap the per-user SUM to
  per-user BEST single game. See `rungles/supabase/migration-015-leaderboard-per-user-best.sql`
  for the `DISTINCT ON (user_id) ORDER BY user_id, score DESC` pattern, and
  use `played_at timestamptz` instead of `play_date` for the window with
  `AT TIME ZONE 'America/Halifax'` math.
- **Play-to-see gate** (Snibble-style: caller must have submitted to view
  today): add a server-side check inside the day-tab branch — see
  `snibble/supabase/migrations/sn_extended_leaderboards.sql`. Past days and
  aggregate windows always stay open per the c92 decision.
- **Per-row extras** (word lists, breakdown columns): add columns to the RPC's
  RETURNS and the StatsPage's `LeaderboardRow`.

The card spec and rationale live on Raeban as c92.

## Admin close-game

The scaffold ships with a working **Close Games** admin panel out of the box
(reachable from the settings dropdown's "🔐 Admin panel" row when the signed-in
user has a row in the shared `public.admins` table with `close_games` in
`permissions`). The matching SQL lives at
`supabase/migrations/<slug>_admin_close_game.sql` and adds:

- `<slug>_games.closed_by_admin BOOLEAN NOT NULL DEFAULT FALSE`
- `<slug>_games.closed_by UUID` — which admin closed the game
- `<slug>_games.close_reason TEXT` — required reason supplied by the admin
- `<slug>_admin_close_game(uuid, text)` — soft-closes a game (status='finished',
  `closed_by_admin=true`, no winner attribution). **Reason is required** —
  passing empty/null raises an exception, so your admin UI must collect a
  reason before calling.
- `<slug>_admin_list_open_games()` — lists waiting/active games for the panel
- `<slug>_admin_list_closed_games()` — lists recently closed games with the
  closing admin's username + reason (for a "Recently Closed" history view)

**You must run this migration after you create your `<slug>_games` table** —
the scaffold doesn't emit the table schema itself (each game's data shape
differs). If your game uses a different table name (e.g. `<slug>_matches`),
find/replace `<slug>_games` in the migration before running.

When you wire the lobby's completed-games list and your end-game banner,
use the canonical 4-branch headline so admin-closed games render correctly
instead of falling back to "highest score wins":

```
closed_by_admin    → '🛑 Game closed by admin'
forfeit_user_id    → `🏳️ ${forfeiter} forfeited — ${winner} wins!`
winner is set      → `🏆 ${winner} wins!`
otherwise          → "🤝 It's a tie!"
```

Admin permissions are managed from the **SQ hub**, not per-game — adding/
removing admins or toggling permissions is a hub responsibility. Each game
just reads the shared table.
