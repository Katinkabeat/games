# SideQuest Refactor Backlog

Living list of refactor candidates across the SQ platform (hub + Wordy + Rungles, plus future games). Update as items ship or new ones surface.

**Seeded:** 2026-04-28 from file-size scan + session notes from `wordy/memory/wordy.md`. Not exhaustive — add items as you discover them. A deeper audit (duplication inside files, dead code, prop-drilling, test gaps) is a future task.

**Status legend:** `[ ]` not started · `[~]` in flight · `[x]` shipped (move to bottom or delete)

---

## In flight

_(none)_

## Shipped — sq-ui shared design system rollout (2026-04-28 → 2026-04-29)

- [x] Extract design tokens, layouts, and primitives into `packages/sq-ui/`
  (Tailwind preset, globals.css, SQCard/SQButton/SQTile/SQModal/SQDropdown/
  SQLobbyHeader/SQBoardHeader/SQLobbyShell/SQBoardShell/SQCompletedGamesCard
  + shared SQAvatarButton/SQAvatarDropdown/SQAvatarMenuItem so the
  per-game avatar dropdowns can't drift)
- [x] Hub uses the package + serves a `/styleguide` demo route
- [x] Wordy lobby + board migrated; Rungles lobby + solo + multi migrated;
  Snibble lobby + GameView migrated. Each game's CI clones rae-side-quest
  as a sibling so the relative imports resolve.
- [x] Self-hosted fonts at `/games/fonts/` (Fredoka One + Nunito) — eliminates
  Google Fonts FOUT
- [x] Spec docs (`sq-style-spec.md`, `sq-conventions.md`) capture the
  finalized dual-header pattern (SQLobbyHeader on top + plain SQBoardHeader
  inline row on board pages), the score panel responsive behavior, and
  the rule that whose-turn lives in the score panel not the sub-header.
- [x] Tile letter font, value position, and tile size unified across all
  three games. Carried tiles align with play area's first slot in Rungles.

## Next up — Tier 1: large single-file components

- [ ] **Rungles `MultiGamePage.jsx`** (610 lines) — same shape as Wordy's GamePage. Likely overlaps conceptually with `SoloGamePage.jsx` (417 lines) — candidate for shared game-shell extraction inside Rungles.

## Tier 1.5 — Wordy bundle trim (only if needed)

- [ ] **Trim shared `index.js` chunk** — still 355 kB (105 kB gzipped) after route split. Investigate with `vite-bundle-visualizer`. Likely culprits: `@supabase/supabase-js`, `react-router-dom`, unused tailwind. Only worth doing if Wordy still feels slow in practice.

## Tier 2: hub admin sprawl

5 admin components totaling ~50 KB on the hub:
- [AccessAdmin](../src/components/AccessAdmin.jsx) (~12 KB)
- [GroupsAdmin](../src/components/GroupsAdmin.jsx) (~10 KB)
- [AdminPanel](../src/components/AdminPanel.jsx) (~8 KB)
- [ReportsAdmin](../src/components/ReportsAdmin.jsx) (~6 KB)
- [AnnouncementsAdmin](../src/components/AnnouncementsAdmin.jsx) (~6 KB)

- [ ] **Lazy-load the entire admin bundle** — non-admins should never download this code. Matches the React perf rule (`feedback_react_perf_codesplit`).
- [ ] **Shared admin table/list primitive** — these 5 components likely share table/CRUD UI patterns. Extract once, reuse 5x.
- [ ] **Hub `LandingPage.jsx`** (~17 KB) and **`SettingsDropdown.jsx`** (~14 KB) — peel logic into hooks.

## Tier 3: cross-game extraction (highest leverage, highest risk)

**Defer until after Snibble ships** — designing shared abstractions from 2 examples is premature; 3 clarifies the shape.

- [ ] **Shared `@sq/game-core`** — Wordy's `gameLogic.js` + Rungles' `lobbyService.js` / `matchService.js` likely have overlapping primitives (turn state, move validation shells, game lifecycle).
- [ ] **Push-notification dedupe** — hub `pushNotifications.js` + per-game registration code. Unified notifications shipped 2026-04-24, so this is now consolidatable.
- [ ] **Shared game shell** — game-page chrome (header, settings menu, end-game banner) is duplicated across Wordy + Rungles + soon Snibble. House style is locked (`feedback_word_game_style`); extract once.

## Notifications — settings UX (flagged 2026-05-02)

The hub-as-broker push model scales fine technically (one permission prompt, one subscription per device, per-game topic tags), but at 5+ games the user-facing controls need to exist. Surfaced while reviewing why Snibble has no per-game SW: it piggybacks on the hub's subscription with topic tags `['sidequest', 'snibble']`, and that pattern works as long as users can mute granularly.

- [ ] **Per-game mute toggles in hub settings** — list every SQ game the user has access to, with an on/off switch per game. Backed by the topic-tag system already in `push_subscriptions` (just remove/add the game's tag).
- [ ] **Topic-level mute** — beyond per-game on/off, allow muting specific event types (e.g., "your turn" vs. "opponent joined" vs. "match completed"). Requires Edge Functions to send a `topic` field in payloads and the hub to filter on subscribe.
- [ ] **Quiet hours** — user-set window (e.g., 10pm–8am local) where pushes are suppressed. Cleanest spot is server-side: store quiet-hours window on the user's profile/subscription row, Edge Functions skip sending if "now" falls inside it. Client-side suppression in the SW is a fallback but doesn't save the wake-up battery cost.
- [ ] **First-tap onboarding** — when a user first opts into hub notifications, show a one-time sheet explaining "you'll get pings for any game you play; manage in Settings." Reduces the "why am I getting Snibble pings" surprise.

## Someday / nice-to-have

- [ ] Full audit pass with Explore agent — duplication inside files, dead exports, prop-drilling, test coverage gaps.
- [ ] Rungles `SoloGamePage.jsx` (~14 KB) standalone cleanup if MultiGamePage extraction doesn't naturally absorb it.
- [ ] Hub `FriendsView.jsx` (~14 KB) — review for hook extraction once friends-related features stabilize.
- [ ] **Username snapshotting on past plays — revisit before public launch.** Currently all SQ games (Rungles confirmed, Wordy assumed) store only `user_id` on game/leaderboard rows and join `profiles.username` live at render time. So a rename updates every historical row everywhere — which is the right default for a friends-and-family circle (score stays linked to the person). When SQ opens to the public, reconsider: trolls/ban-evasion, screenshot integrity, moderation/dispute trails, and deleted-account "Unknown" rows all argue for snapshotting username (and maybe avatar_hue) onto the play row at insert time. Decision deferred until there's an actual public-launch plan; flagged 2026-04-30.

---

## Done

_(move shipped items here with date + commit)_

- 2026-04-28: Lobby `GameRow` extracted to `LobbyGameRow.jsx`; `finalizeEndgame` extracted to `gameLogic.js` (commit dd00106).
- 2026-04-28: GamePage round 1 — extracted `useGameData` hook (state + `loadGame` + realtime + polling + visibility). `GamePage.jsx` 871 → 721 lines (-17%). New file `wordy/src/hooks/useGameData.js` (186 lines). Bundle size +0.17 kB gzipped (acceptable hook-indirection overhead). Verified locally: load, render, settings, dark mode all confirmed by Rae.
- 2026-05-03: Wordy Tier 1 confirmed shipped (extraction work landed earlier, backlog was stale):
  - `useGameMutations` hook — `wordy/src/hooks/useGameMutations.js` (240 lines), wired into `GamePage.jsx`. Final GamePage size: 473 lines (-34% from round-1 baseline).
  - `BlankTileModal` + `ForfeitModal` — lifted into `wordy/src/components/game/modals/`.
  - `createGame` / `joinGame` — extracted to `wordy/src/lib/gameMutations.js` (72 lines), used by `LobbyPage.jsx`.
  - `useUnseenResults` hook — `wordy/src/hooks/useUnseenResults.jsx` (131 lines), used by `LobbyPage.jsx`.
