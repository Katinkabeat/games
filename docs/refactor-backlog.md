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

- [ ] **Wordy `GamePage.jsx` — round 2: extract `useGameMutations` hook** (~720 lines after round 1). Move `submitWord`, `passTurn`, `confirmExchange`, `forfeitGame` into a hook so the move/DB-write logic lives next to the data hook. Would also let `mutatingRef`, `placementsRef`, `localRackRef` become private to the hooks instead of crossing the component boundary as refs.
- [ ] **Wordy `GamePage.jsx` — round 3: lift `BlankTileModal` and `ForfeitModal`** out of GamePage.jsx into their own files under `components/game/modals/`. Small, low-risk follow-up.
- [ ] **Rungles `MultiGamePage.jsx`** (~22 KB) — same shape as Wordy's GamePage. Likely overlaps conceptually with `SoloGamePage.jsx` (~14 KB) — candidate for shared game-shell extraction inside Rungles.
- [ ] **Wordy `LobbyPage.jsx`** (485 lines after 2026-04-28 cleanup) — already partially split. Continue with the two items below from the same session.

## Next up — Tier 1.5: Wordy lobby leftovers (flagged 2026-04-28)

- [ ] **Extract `createGame` / `joinGame` to `wordy/src/lib/gameMutations.js`** — pure data ops sitting inside `LobbyPage.jsx` (~70 lines). Continues the LobbyPage cleanup arc.
- [ ] **Custom hook `useUnseenResults(user, navigate)`** — `loadUnseenResults` callback, `dismissResult`, `handleGameChange`'s finish-toast block, realtime sub wiring (~80 lines). Cleanly separates result-banner feature from lobby concerns.
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

## Someday / nice-to-have

- [ ] Full audit pass with Explore agent — duplication inside files, dead exports, prop-drilling, test coverage gaps.
- [ ] Rungles `SoloGamePage.jsx` (~14 KB) standalone cleanup if MultiGamePage extraction doesn't naturally absorb it.
- [ ] Hub `FriendsView.jsx` (~14 KB) — review for hook extraction once friends-related features stabilize.

---

## Done

_(move shipped items here with date + commit)_

- 2026-04-28: Lobby `GameRow` extracted to `LobbyGameRow.jsx`; `finalizeEndgame` extracted to `gameLogic.js` (commit dd00106).
- 2026-04-28: GamePage round 1 — extracted `useGameData` hook (state + `loadGame` + realtime + polling + visibility). `GamePage.jsx` 871 → 721 lines (-17%). New file `wordy/src/hooks/useGameData.js` (186 lines). Bundle size +0.17 kB gzipped (acceptable hook-indirection overhead). Verified locally: load, render, settings, dark mode all confirmed by Rae.
