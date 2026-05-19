# SQ Game Starter

Scaffolds a new SideQuest game pre-wired with all the SQ chrome (sq-ui, dual-header,
Supabase auth bounce, theme-flash prevention, push-notification SW, GitHub Pages
deploy, manifest, dev tooling).

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
3. Wire it into the shared notification system (`src/lib/pushNotifications.js`,
   the edge function, any DB schema)
4. Update the theme-flash localStorage fallback list in OTHER games' `index.html`
   to include the new `<slug>-theme` key (so users mid-migration don't flash)
5. Build the actual game
6. Once your `<slug>_games` table exists, run
   `supabase/migrations/<slug>_admin_close_game.sql` to enable admin
   close-game support (see "Admin close-game" below)
7. **Enable realtime + hub inbox integration** (see "Realtime lobby" below)
8. `gh repo create` + push when ready

## Realtime lobby

Every SQ game's lobby and game view should auto-update when something changes
server-side (opponent joins, opponent submits, invite arrives). Without this,
users sit on stale screens until they manually refresh — which they won't,
because nothing tells them to. **This is not optional.** Snibble shipped without
it and Player 2 appeared "blocked" until Player 1 acted.

The scaffold ships with `src/hooks/useRealtimeChannel.js` already wired into the
multi-game page. The lobby's `MultiplayerCard.jsx` has a usage example in its
header comment — wire it up the same way.

After your tables exist, you must:

1. **Add tables to the realtime publication** (migration):

   ```sql
   alter publication supabase_realtime add table public.<slug>_games;
   alter publication supabase_realtime add table public.<slug>_players;
   ```

   Without this, `postgres_changes` subscriptions silently no-op.

2. **Add a `<slug>_pending_for(uid)` SQL function** so Snibble-style pending
   counts (your turn, invites) show up in the SQ hub's bell. Pattern:

   ```sql
   create or replace function public.<slug>_pending_for(uid uuid)
   returns table (count integer, label text, url text)
   language sql stable
   as $$
     select count(*)::int, 'Your turn'::text, '/<slug>/'::text
     from public.<slug>_games g
     -- ... your "owes a turn" query ...
     having count(*) > 0;
   $$;
   ```

   The hub's `sq_pending_for(uid)` RPC calls this automatically.

3. **Patch the hub's `LandingPage.jsx`** to subscribe to your tables in the
   `hub-inbox` channel — copy the existing `sn_matches` / `sn_match_round_plays`
   `.on(...)` lines and swap in your slug.

See `docs/sq-conventions.md` for full SQ patterns.

## Stats page + extended leaderboards (c92 pattern)

The scaffold ships with a working **StatsPage** at `/stats` (linked from the
avatar menu) that includes the c92 extended-leaderboard pattern out of the box:
**Day / Week / Month / All-time** tabs with a date stepper on Day for scrolling
back through past days. Identical chrome to Yahdle / Snibble / Rungles.

It comes with two matching migrations:

- `supabase/migrations/<slug>_solo_results.sql` — minimal one-row-per-user-per-day
  table (`user_id`, `play_date`, `score`, `completed_at`). Apply this first.
- `supabase/migrations/<slug>_solo_leaderboards.sql` — the two RPCs
  (`<slug>_solo_leaderboard` and `<slug>_solo_my_rank`) the StatsPage calls.
  Default: **per-user SUM across the window** (each user appears once;
  Week = sum of daily scores, etc).

**To light it up:** apply both migrations, then INSERT a row into
`<slug>_solo_results` whenever a player finishes a session. The leaderboard
fills in automatically.

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
