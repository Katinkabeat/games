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
7. `gh repo create` + push when ready

See `docs/sq-conventions.md` for full SQ patterns.

## Admin close-game

The scaffold ships with a working **Close Games** admin panel out of the box
(reachable from the settings dropdown's "🔐 Admin panel" row when the signed-in
user has a row in the shared `public.admins` table with `close_games` in
`permissions`). The matching SQL lives at
`supabase/migrations/<slug>_admin_close_game.sql` and adds:

- `<slug>_games.closed_by_admin BOOLEAN NOT NULL DEFAULT FALSE`
- `<slug>_admin_close_game(uuid)` — soft-closes a game (status='finished',
  `closed_by_admin=true`, no winner attribution)
- `<slug>_admin_list_open_games()` — lists waiting/active games for the panel

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
