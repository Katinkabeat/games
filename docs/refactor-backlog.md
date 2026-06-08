# SideQuest Refactor Backlog

Living list of refactor candidates across the SQ platform (hub + Wordy + Rungles, plus future games). Update as items ship or new ones surface.

**Seeded:** 2026-04-28 from file-size scan + session notes from `wordy/memory/wordy.md`. Not exhaustive — add items as you discover them. A deeper audit (duplication inside files, dead code, prop-drilling, test gaps) is a future task.

**Status legend:** `[ ]` not started · `[~]` in flight · `[x]` shipped (move to bottom or delete)

---

## In flight

_(none)_

## Candidates surfaced 2026-05-19 (c92 leaderboard rollout)

- [ ] **Shared SQ leaderboard component** — c92 shipped near-identical leaderboard UIs across Yahdle / Snibble / Rungles (segmented control Day/Week/Month/All-time + date stepper on Day). All three render a top-10 list with the "your rank #N" tail row. **Why not done in c92:** the three games' row shapes diverge enough (Snibble has word-expansion + percent vs puzzle, Rungles has multi-row-per-user per-game ranking, Yahdle is plain) that the abstraction would have been premature without three real implementations to compare. Revisit now that they exist — likely candidates: extract `SegmentedControl`, `DateStepper`, `formatIso`/`addDays`/`todayInHalifax` helpers into sq-ui. Row component probably stays per-game.
- [ ] **Halifax-tz date helpers** are now duplicated 3× (`todayInHalifax`, `formatIso`, `addDays` in each of Yahdle StatsPage, Snibble StatsModal, Rungles StatsModal). Trivial extraction into sq-ui.

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

_(none — Rungles shipped 2026-05-03, see Done)_

## Tier 1.5 — Wordy bundle trim (only if needed)

- [ ] **Trim shared `index.js` chunk** — still 355 kB (105 kB gzipped) after route split. Investigate with `vite-bundle-visualizer`. Likely culprits: `@supabase/supabase-js`, `react-router-dom`, unused tailwind. Only worth doing if Wordy still feels slow in practice.

## Tier 2: hub admin sprawl

- [x] **Lazy-load the entire admin bundle** — shipped 2026-05-05 (commit defefca). See Done.
- [x] **Shared admin primitives** — shipped 2026-05-05 (commit 050aa87). See Done.
- [ ] **Hub `LandingPage.jsx`** (~17 KB) and **`SettingsDropdown.jsx`** (~14 KB) — peel logic into hooks. **Lower priority** (2026-05-05): file works fine, no current pain when editing it. Revisit when the next hub feature feels gnarly to add. Risks (`useEffect` realtime+polling state machine, stale closures on `userId`) > current pain.
- [ ] **Per-row keyed search in AccessAdmin/GroupsAdmin** — left inline during the admin primitives shipped 2026-05-05. Sharing it would require extracting `<AccessAdminRow>` / `<GroupsAdminRow>` sub-components so each row can call `useUsernameSearch` directly. Do this if a 7th admin page wants per-row search; otherwise skip.

## Tier 3: cross-game extraction (audited 2026-05-05 — most are shipped or not worth doing)

- [~] **Shared lobby header** — only real remaining cross-game duplication. `RunglesHeader.jsx` + `SnibbleHeader.jsx` are nearly identical (sticky bar with avatar + title + 🏠 + ⚙️). `sq-ui` already ships `SQLobbyHeader` (Wordy uses it). Fix: extend `SQLobbyHeader` to accept `title` + dropdown slot props, migrate both games. ~40 lines saved per game; low-risk, ~1-2 hours.
- [✗] ~~Shared `@sq/game-core`~~ — **decided against 2026-05-05**. Three games are too different: Wordy is Scrabble (board placement), Rungles is linear ladder-climbing, Snibble is round-based puzzles. No shared game loop, turn shape, or state model. Forcing a shared core would be a bad abstraction.
- [✗] ~~Push-notification dedupe~~ — **already shipped** in Phase 8.5 (2026-04-24 unified push migration). Hub `pushNotifications.js` is canonical; per-game files were removed. The hub's `migrateToSideQuestPush()` even cleans up legacy `push_subscriptions` rows where `app IN ('wordy', 'rungles')`. Nothing left to consolidate.

## Notifications — settings UX (flagged 2026-05-02 → mostly shipped 2026-05-05)

- [x] **Per-game mute toggles + per-event toggles** — shipped 2026-05-05. NotificationsPanel + `_master` topic + 5-topic vocabulary (`your_turn`, `invite`, `nudge`, `opponent_joined`, `friend_request`). All 4 Edge Functions check `sq_notification_enabled()` before sending.
- [x] **First-tap onboarding (pre-permission primer)** — shipped 2026-05-05. Modal in NotificationsPanel that triggers when `Notification.permission === 'default'`; users can decline gracefully without burning the OS prompt.
- [x] **Bonus: invitability privacy setting** — shipped 2026-05-05. New `profiles.invitability` enum (`everyone | friends_only | nobody`) with UI dropdown in SettingsDropdown and DB-level enforcement via BEFORE INSERT triggers on all 3 game tables.
- [x] **Bonus: feature parity gaps** — shipped 2026-05-05. Snibble nudge (server + client button on match page) + Rungles `opponent_joined` push (DB trigger + edge function handler).
- [✗] ~~Quiet hours~~ — **decided against 2026-05-05**. iOS Focus / Android DND already solve this for most users. Server-side quiet hours adds a column, timezone migration, edge function check, and UI for a feature most users handle at the OS level. Add later if a user explicitly asks; the only honest case for it is server-side suppression preventing badge accumulation past the quiet window.

## Someday / nice-to-have

- [ ] **Drop orphaned Snibble testing-phase DB objects** (flagged 2026-06-07, c190). The settings-unification card removed the client code for Redo today / Allow redo / Reset leaderboard, leaving two now-unreferenced server-side objects in the shared project: the `sn_app_settings` row `key = 'redo_today_enabled'` and the RPC `sn_admin_reset_leaderboard`. Harmless dead weight; left in place deliberately. Drop via the dashboard SQL editor during the next refactor pass (destructive prod change → not auto-run).
- [ ] Full audit pass with Explore agent — duplication inside files, dead exports, prop-drilling, test coverage gaps.
- [ ] Rungles `SoloGamePage.jsx` (~14 KB) standalone cleanup if MultiGamePage extraction doesn't naturally absorb it.
- [ ] Hub `FriendsView.jsx` (~14 KB) — review for hook extraction once friends-related features stabilize.
- [ ] **Username snapshotting on past plays — revisit before public launch.** Currently all SQ games (Rungles confirmed, Wordy assumed) store only `user_id` on game/leaderboard rows and join `profiles.username` live at render time. So a rename updates every historical row everywhere — which is the right default for a friends-and-family circle (score stays linked to the person). When SQ opens to the public, reconsider: trolls/ban-evasion, screenshot integrity, moderation/dispute trails, and deleted-account "Unknown" rows all argue for snapshotting username (and maybe avatar_hue) onto the play row at insert time. Decision deferred until there's an actual public-launch plan; flagged 2026-04-30.

---

## Done

_(move shipped items here with date + commit)_

- 2026-05-05: **Notification preferences platform** shipped end-to-end across all 4 repos. Schema (`user_notification_prefs` + `_master` topic + `profiles.invitability` + `sq_notification_enabled` + `sq_check_invitable` + Wordy/Rungles/Snibble BEFORE INSERT triggers); all 4 edge functions route through `sendIfOptedIn(user, app, topic)` (deployed); new triggers (Snibble nudge RPC + button, Rungles `opponent_joined`); lazy-loaded NotificationsPanel UI (3.03 kB gzipped) with per-game master + per-event toggles + browser-push toggle + pre-permission primer; invitability dropdown in SettingsDropdown with everyone/friends_only/nobody.
  - Hub commits: 6b7792a (schema + opt-in), 64e12a7 (UI panel), 57a7a54 (invitability + DB enforcement), 45e3fde (primer)
  - Wordy: 3cf69d9 (opt-in check)
  - Rungles: 27f94e2 (opt-in check), f43105e (opponent_joined)
  - Snibble: 2d8dfc1 (opt-in check), 13262af (nudge server-side), 0b9cdd5 (nudge button UI)
  - Decided against quiet hours (OS-level DND solves it).
- 2026-05-05: Hub admin lazy-load shipped (commit defefca). `AdminPanel` swapped from static import to `React.lazy` + `<Suspense>` in `LandingPage.jsx`. Verified locally: clicking 🔐 Open lazily fetches AdminPanel + AnnouncementsAdmin + AccessAdmin + GroupsAdmin + ReportsAdmin + ClosedGamesAdmin + AdminsManagement on demand. Production build splits into `AdminPanel-*.js` chunk (30.84 kB / **7.85 kB gzipped**); main entry unchanged at 426 kB / 121 kB gzipped. Non-admin visitors no longer download the admin code.
- 2026-05-05: Shared admin primitives shipped. Three new shared files (`src/components/admin/AdminList.jsx`, `src/hooks/useAdminQuery.js`, `src/hooks/useUsernameSearch.js`). All 6 hub admin components migrated to use them: ClosedGamesAdmin, AnnouncementsAdmin, ReportsAdmin, AdminsManagement (uses all 3), AccessAdmin, GroupsAdmin. Net -81 lines in consumers, +94 lines in shared; future admin pages start with much less boilerplate. Per-row keyed search in AccessAdmin/GroupsAdmin left inline (would need row-component extraction to share). Lazy chunk grew to 7.97 kB gzipped (+0.12 kB).
- 2026-04-28: Lobby `GameRow` extracted to `LobbyGameRow.jsx`; `finalizeEndgame` extracted to `gameLogic.js` (commit dd00106).
- 2026-04-28: GamePage round 1 — extracted `useGameData` hook (state + `loadGame` + realtime + polling + visibility). `GamePage.jsx` 871 → 721 lines (-17%). New file `wordy/src/hooks/useGameData.js` (186 lines). Bundle size +0.17 kB gzipped (acceptable hook-indirection overhead). Verified locally: load, render, settings, dark mode all confirmed by Rae.
- 2026-05-03: Wordy Tier 1 confirmed shipped (extraction work landed earlier, backlog was stale):
  - `useGameMutations` hook — `wordy/src/hooks/useGameMutations.js` (240 lines), wired into `GamePage.jsx`. Final GamePage size: 473 lines (-34% from round-1 baseline).
  - `BlankTileModal` + `ForfeitModal` — lifted into `wordy/src/components/game/modals/`.
  - `createGame` / `joinGame` — extracted to `wordy/src/lib/gameMutations.js` (72 lines), used by `LobbyPage.jsx`.
  - `useUnseenResults` hook — `wordy/src/hooks/useUnseenResults.jsx` (131 lines), used by `LobbyPage.jsx`.
- 2026-05-03: Rungles Tier 1 shipped — extracted three shared pieces from `SoloGamePage` and `MultiGamePage` (commits d3b875c + f392900):
  - **Bonus bug fix first** — unified rack-reorder pattern: shared `lib/rackOrder.js` (`swapInOrder`/`shuffleOrder`), Solo and Multi both use a visual `rackOrder` permutation. Fixed Multi's silently-broken rack swap (was gated on `playable`, off-by-one math) and added localStorage persistence keyed by gameId. Solo state shape now includes `rackOrder` (backward-compatible load).
  - `hooks/useBoardDerived.js` — pure derivation from `selected`. Returns `filled, lastFilledSlot, hasGap, currentWord, usedRackIdxs, usedCarriedIdxs`. Used by both pages.
  - `components/BoardSlots.jsx` — the 7-slot play area. Optional `tileDisabled` (Multi gate) and `wrapperClassName` (Solo flash classes).
  - `components/CarriedTiles.jsx` — 304px carried-letter row with empty-state + label. Caller normalizes letters to `string[]`.
  - Final sizes: SoloGamePage 418 → 375 (-10%), MultiGamePage 610 → 582 (-5%); 126 new lines in shared files.
  - Deliberately NOT extracted: `handleSlotTap`/`handleSourceTap` — Solo's reducer pattern vs Multi's fragmented useState would require a bigger rewrite to unify; pure-presentation extraction sidesteps this.
