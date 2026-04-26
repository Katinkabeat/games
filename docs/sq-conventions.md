# SideQuest game conventions

The shared visual + structural conventions that every SQ game (Wordy,
Rungles, and any future game) follows. Use this as the starting point
when scaffolding a new game so it feels like part of the platform from
day one.

Last updated: 2026-04-26

---

## Layout

- **Max width: `480px`** for landing/lobby/menu pages (mobile-first column).
  - Tailwind: `max-w-[480px] mx-auto`
  - Plain CSS: `max-width: 480px; margin: 0 auto`
- **Exception:** in-game pages that need a wider surface (e.g. Wordy's
  board) may use a wider container (currently `max-w-6xl`).
- **Header bar** is sticky on mobile, opaque background, divider line at
  the bottom. Reference: Wordy's `LobbyPage.jsx` and Rungles' `.app-header`.

## Header anatomy (every page that has one)

Layout, left to right:

```
[avatar]  [Game Name]                     [🏠]  [⚙️]
```

- **Left side:** the user's avatar circle (clickable → opens the avatar
  dropdown), then the game name in the display font. **No `W` / `R` /
  glyph logo** — the avatar carries identity.
- **Right side:** a 🏠 link to `/games/` (back to hub) and a ⚙️ cog
  button (per-app settings dropdown).
- The hub itself follows the same pattern: avatar left of "Rae's Side
  Quest", bell + cog on the right.

## Floating overlays — dropdowns, popovers, modals, dialogs

Every floating surface (avatar dropdowns, cog dropdowns, bell dropdowns,
stats popups, confirm modals, full-screen dialogs) follows the same
"raised above the page" treatment in dark mode:

- **Background:** `#241640` — one shade lighter than the page surface
  (`#1a1130`) so the menu reads as floating, not blending into the
  page's cards.
- **Border:** `1px solid #6d28d9` — bright wordy-700 purple. Defines
  the menu edge clearly against the dark page.

In light mode keep the surface white (`#fff`) with a soft purple-100
border (`#e9d5ff`) — same shape, less aggressive contrast.

**Tailwind gotcha:** the projects' `index.css` files have
`.dark .bg-white { #1a1130 !important }` and
`.dark .border-purple-100 { #2d1b55 !important }` overrides that
clobber arbitrary `dark:bg-[…]` and `dark:border-[…]` classes. Route
around them by using arbitrary classes for the light-mode value too:

```jsx
// ❌ won't override in dark mode
className="bg-white dark:bg-[#241640] border border-purple-100 dark:border-[#6d28d9]"
// ✅ arbitrary classes bypass the !important global rules
className="bg-[#fff] dark:bg-[#241640] border border-[#e9d5ff] dark:border-[#6d28d9]"
```

For `.card`-based dropdowns (which `@apply bg-white border border-purple-100`
in CSS), add the marker class `dropdown-surface` and rely on the
`.dark .dropdown-surface` rule in `index.css` instead.

For Rungles `<dialog>` elements, the `html.dark dialog` rule in
`style.css` handles it.

## Avatar dropdown

The avatar dropdown is **identity** — what's *about you*, not about
this app:

- **In each game:** identity card (avatar + username + "Your profile")
  + 📊 Stats link (game-specific stats — per-game leaderboards, etc.).
  **No** colour picker, **no** name change, **no** password change.
- **In the hub:** identity card + colour picker + 📊 Stats link (cross-
  platform stats: account age, streak, games per game).

## Cog (settings) dropdown

App-specific behaviour:

- **In each game:** Theme toggle, Admin (gated, see below), Log out.
  Account-level settings (name change, password change) live ONLY on
  the hub. Logout uses the danger / rose colour everywhere.
- **In the hub:** Theme, Friends, Admin (gated), Log out, plus name +
  password change.

## Admin gating

Admin status comes from the `public.admins` table:

- RLS: each user can `SELECT` only their own row; only master admins
  can `INSERT`/`UPDATE`/`DELETE`.
- Apps query `admins.eq('user_id', user.id).maybeSingle()` and gate the
  Admin menu item with `{isAdmin && ...}`.
- Don't re-check admin status server-side from app code — RLS handles it.

## Multiplayer lobby — in-progress row template

When a multiplayer game is `active`, each lobby row should have:

1. A chip strip of player usernames; the **current player** is
   highlighted in the accent purple. Use Rungles' `.lobby-chip` /
   `.lobby-chip-current` or Wordy's `bg-wordy-500` / `bg-wordy-200` as
   reference.
2. A `(N/M)` count chip at the end.
3. For 4-player rows, force a row break after chip 2 (see Wordy
   `LobbyPage.jsx` `Fragment` + `basis-full h-0` divider) so chips wrap
   2-per-line and the count joins line 2.
4. A `🔔` nudge button inside the current player's chip when the user
   is allowed to nudge them — see "Nudge feature" below.
5. Below the chips: `{N} rungs · {timeAgo(turn_started_at)}`. Active
   rows show "X ago" since the last move. Waiting rows fall back to
   `created_at` and a status label like "⏳ Waiting for players".

## Nudge feature ("reminder notifications")

Every multiplayer game should ship with these from the start.

**DB schema** (per-game tables — names will vary):

```sql
ALTER TABLE games  -- or rg_games etc.
  ADD COLUMN turn_started_at timestamptz,
  ADD COLUMN last_nudged_at  timestamptz;
```

Stamp `turn_started_at = now()` on every turn advance (game start, turn
submitted, turn skipped). Backfill existing rows from the most-recent
move's `created_at`.

**RPC:** `<game>_nudge(p_game_id uuid)` — `SECURITY DEFINER`. Validates:

- Caller is authenticated and a player in this game.
- Caller is NOT the current player.
- `turn_started_at` is more than 12 h old.
- `last_nudged_at` is null OR more than 12 h old.

On success it sets `last_nudged_at = now()`.

**Edge function:** add a `nudge` payload branch alongside the existing
`turn_change` handler. Look up the current player and call
`sendPushToUser` with title "It's your turn!", body "{nudger_name} is
waiting…", `tag: <game>-nudge-<game_id>`.

**Client:** `canNudge` requires the game to be `active`, the user to be
in the game, NOT their turn, `turn_age > 12h`, `last_nudge_age > 12h`.
On click: call the RPC, then fire-and-forget POST to the edge function.

## Push notifications

- Single shared table: `public.push_subscriptions` (`user_id`, `app`,
  `endpoint`, `keys_p256dh`, `keys_auth`).
- Subscribers are managed centrally in the hub
  ([`pushNotifications.js`](../src/lib/pushNotifications.js)). New games
  do NOT add their own subscription UI; they inherit the hub's `sidequest`
  subscription.
- Edge functions look up subscriptions in the order
  `['sidequest', '<game>']` so a unified hub sub is preferred over a
  legacy per-game sub.
- Service worker shows the notification, falls back to opening
  `/<game>/?game=<id>` and posts a `NAVIGATE` message if a tab is
  already open.

## Solo / multiplayer scope

Unless explicitly told "only solo" or "only multi", every UX or
gameplay change should land in BOTH modes (e.g. Wordy doesn't have a
solo mode, but Rungles does). This avoids cross-platform drift.

## Deploy workflow

- Local dev env: `npm run dev:all` from `rae-side-quest` (all SQ apps
  under `localhost:8080`, sessions shared via localStorage).
- Test the change locally before pushing.
- Ask Rae before `git push`. GitHub Actions auto-deploys from `main`.
