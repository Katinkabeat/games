# Rae's Side Quest — Phased Build Plan

A staged roadmap for growing the hub from "friends only" to "ready to open up," while keeping Wordy and Rungles stable and staying within Supabase's free tier.

## Ordering principle

Earliest phases are purely additive — new tables and hub-only code that don't touch Wordy or Rungles. Risk grows as phases start replacing hardcoded behavior or crossing into existing game data. Public-launch safety nets (reports, rate limits) are last so they're in place right before opening up.

| # | Phase | Touches games? | Reversible? |
|---|---|---|---|
| 0 | Backup & safety net | No | N/A — prep only |
| 1 | Supabase heartbeat cron | No | Yes, drop function |
| 2 | Shared events telemetry | No | Yes, drop table |
| 3 | Announcements banner | Hub only | Yes, hide component |
| 4 | Realtime inbox updates | Hub only | Yes, remove listener |
| 5 | Games catalog table | Hub only | Yes, fallback array |
| 6 | Unified pending-actions RPC | Read-only queries | Yes, feature flag |
| 7 | `user_game_access` (beta gating) | Hub read only | Yes, skip the check |
| 7.5 | User groups | Hub only | Yes, drop tables |
| 8 | Hub-level friendships | Additive to games | Yes, dead-table no-op |
| 9 | Reports + block list | Optional reads | Yes, tables persist |
| 10 | Rate limits (public prep) | Edge functions | Yes, remove check |

---

## Global backup strategy

Before **any** phase starts:

1. **Tag all three repos** at the current commit:
   ```bash
   git tag -a pre-sq-phase-<n> -m "Before SQ phase <n>"
   git push --tags
   ```
   Repos: `rae-side-quest`, `wordy`, `rungles`.

2. **Supabase schema + data snapshot** (free tier has no PITR):
   ```bash
   supabase db dump --db-url "$SUPABASE_DB_URL" > snapshots/pre-phase-<n>-$(date +%F).sql
   ```
   Store in a separate private location (Dropbox, USB, not the repo).

3. **Record the current edge-function versions** — `supabase functions list` output saved alongside the snapshot.

4. **Feature-flag any hub UI change** using an env var (e.g. `VITE_SQ_USE_CATALOG=false`) so a single deploy can flip behavior back.

If a phase goes sideways, the rollback is always:
- Revert the hub repo to its `pre-sq-phase-<n>` tag and redeploy.
- Replay the schema snapshot only if a destructive migration was run (almost never needed — additive-only is the rule).
- Notify the 3–4 people playing via the announcement banner or group chat.

---

## Phase 0 — Backup & safety net

**Goal:** Establish the rollback muscle memory before making any change.

**What to build:**
- `snapshots/` folder (gitignored) with today's schema dump.
- `pre-sq-plan` tag on all three repos.
- A one-page `ROLLBACK.md` in this repo listing the exact revert commands per phase.

**Risks:** None — this is prep only.

**Backup plan:** N/A. This *is* the backup plan.

---

## Phase 1 — Supabase heartbeat cron

**Goal:** Prevent the 7-day auto-pause on quiet weeks. Memory already flags this as the biggest free-tier risk.

**What to build:** (shipped 2026-04-24 using in-DB pg_cron instead of an edge function — same effect, fewer moving parts)
- `public.heartbeat(id, created_at)` table with RLS enabled (no policies = service-role only).
- pg_cron extension enabled.
- pg_cron job `sq-heartbeat` scheduled at `0 12 * * *` (noon UTC daily).
- Job inserts a row then deletes anything older than 30 days.

**Risks:**
| Type | Detail | Workaround |
|---|---|---|
| Game interruption | None — function touches a hub-only table. | — |
| Data loss | None. | — |
| User conflict | None. | — |
| Operational | Cron could fail silently; project pauses anyway. | Add a Sunday manual check until confident; log last run timestamp to a "status" page in the admin panel. |

**Backup plan:** Drop the function and table. No side effects.

---

## Phase 2 — Shared events telemetry table

**Goal:** Start collecting "which game gets played, when, by whom" so future decisions are data-driven rather than guesses.

**What to build:** (shipped 2026-04-24)
- `public.sq_events(id, user_id, game, event, payload jsonb, created_at)` table with two indexes.
- RLS: `sq_events_insert_self` (user can insert own rows), `sq_events_select_admin` (admins read).
- Retention: pg_cron job `sq-events-retention` at `0 2 * * *` UTC, deletes rows > 90 days old.
- `logEvent(event, payload)` helper in all three repos:
  - `wordy/src/lib/telemetry.js` — available, no call sites wired yet
  - `rungles/js/telemetry.js` — available, no call sites wired yet
  - `rae-side-quest/src/lib/telemetry.js` — wired: `logEvent('app_opened')` fires on LandingPage mount

**Risks:**
| Type | Detail | Workaround |
|---|---|---|
| Game interruption | Games could hang if logging awaits network. | Never `await` the insert — fire-and-forget. |
| Data loss | Telemetry rows lost if the table is dropped — but they're not game data. | Accept as non-critical. |
| User conflict | Privacy — don't log message contents, usernames in payloads, or anything personal. | Write a short "what can I log" note in this doc; review payloads during PR. |
| Free-tier | 500 MB ceiling if events explode. | 90-day retention + nightly cleanup; monitor table size in Supabase dashboard. |

**Backup plan:** Remove the `logEvent` calls from each game (one-line removals), drop the table. Games keep working.

---

## Phase 3 — Announcements banner

**Goal:** Give yourself a way to post "Rungles got X" or "Supabase is down, sorry!" without editing code.

**What to build:** (shipped 2026-04-24)
- `public.announcements` table with `id, body, severity, published_at, expires_at, dismissible, created_by, created_at`.
- RLS: any authenticated user reads active rows (`published_at <= now() < expires_at`); master admins read/insert/update/delete all.
- `AnnouncementBanner.jsx` renders the latest active announcement above the game grid; severity-styled (info/warning/success); dismissible state in `localStorage`.
- `AnnouncementsAdmin.jsx` (master-admin only, embedded in AdminPanel): textarea + severity picker + datetime expiry + dismissible toggle, plus a list of recent announcements with delete.
- Feature flag: `VITE_SQ_ANNOUNCEMENTS=false` hides the banner.

**Risks:**
| Type | Detail | Workaround |
|---|---|---|
| Game interruption | If the banner component throws, it could blank the hub. | Wrap in an error boundary; fail silently on fetch error. |
| Data loss | None. | — |
| User conflict | Confusing or stale announcements. | Always set `expires_at`; enforce in the query. |

**Backup plan:** Hide the banner component with a feature flag (`VITE_SQ_ANNOUNCEMENTS=false`). Table can stay.

---

## Phase 4 — Realtime inbox updates

**Goal:** The bell badge updates live while the user is on the hub, instead of only on page load.

**What to build:** (shipped 2026-04-24)
- LandingPage's inbox useEffect refactored: profile/admin loaded once, inbox counts recomputed by a `recountInbox()` function callable from realtime events.
- Supabase Realtime channel `hub-inbox` listens for changes on `games`, `rg_games`, `game_players`, and `rg_players` (filtered to this user where applicable). All four tables are already in the `supabase_realtime` publication.
- Each event triggers `scheduleRecount`, a 300ms debounce that batches rapid updates into a single recount.
- If the channel errors or closes (CHANNEL_ERROR / TIMED_OUT / CLOSED), a 60s polling fallback kicks in until the channel resubscribes.

**Risks:**
| Type | Detail | Workaround |
|---|---|---|
| Game interruption | None — this is read-only on the hub. | — |
| Data loss | None. | — |
| User conflict | Stale or flickering counts if subscriptions lag. | Debounce; show a subtle "refreshing" state, not a hard reload. |
| Free-tier | 200 concurrent realtime connections cap. Each hub user is ~1 connection. | More than fine for friends; revisit at ~150 concurrent users. |

**Backup plan:** Remove the `useEffect` that creates the channel subscription. Hub falls back to mount-only fetch (today's behavior).

---

## Phase 5 — Games catalog table

**Goal:** Replace the hardcoded `GAMES` array in `LandingPage.jsx:8` with a database row per game, so adding game #3 is a row insert, not a hub redeploy.

**What to build:** (shipped 2026-04-24)
- `public.games_catalog(id text pk, name, url, initial, gradient, is_published, sort_order, requires_access, created_at, updated_at)` with partial index on `sort_order` for published rows.
- RLS: authenticated users read `is_published=true` rows; master admins read all, insert, and update. No DELETE policy — soft-hide via `is_published=false`.
- Seeded with `wordy` and `rungles` using the exact values from the hardcoded array (sort_order 1 and 2).
- LandingPage fetches catalog on mount (alongside profile/admin loading) and renders from it; if the fetch errors or returns empty, the hardcoded `FALLBACK_GAMES` array takes over.
- Feature flag: `VITE_SQ_USE_CATALOG=false` skips the fetch entirely, forcing the fallback.

**Risks:**
| Type | Detail | Workaround |
|---|---|---|
| Game interruption | If catalog query fails and fallback isn't wired up, no game cards render. | Fallback array + error boundary around the grid. |
| Data loss | Accidentally deleting a catalog row "hides" a game. | Never `DELETE` — always `update is_published = false`. Enforce with an RLS policy blocking deletes. |
| User conflict | Wrong URL in a row sends users to a broken page. | Admin-only write access; staging row added first, then flipped to `is_published`. |

**Backup plan:** Feature flag `VITE_SQ_USE_CATALOG=false` → hub reverts to hardcoded array. Table stays in place, no harm done.

---

## Phase 6 — Unified pending-actions RPC

**Goal:** Collapse the per-game bespoke queries in `LandingPage.jsx:64-93` into one RPC the hub calls. Every new game only has to write one Postgres function.

**What to build:** (shipped 2026-04-24)
- Per-game functions in Postgres: `public.wordy_pending_for(uid uuid)` and `public.rungles_pending_for(uid uuid)`, both returning `(count int, label text, url text)` rows when count > 0. SECURITY INVOKER so RLS still applies.
- Hub-level wrapper `public.sq_pending_for(uid uuid)` returning `(game_id text, count int, label text, url text)`. plpgsql function that iterates over `games_catalog WHERE is_published=true ORDER BY sort_order` and dynamically calls `<id>_pending_for(uid)` for each (with `replace(id, '-', '_')` for safe identifier names). Skips silently if the per-game function is undefined.
- LandingPage's `recountInbox` calls `supabase.rpc('sq_pending_for', { uid })` first; on error or with `VITE_SQ_USE_RPC=false`, falls back to `recountInboxLegacy()` which runs the original per-game queries and constructs the same `(game_id, count, label, url)` shape.
- Single inbox state `inboxItems` replaces the three game-specific states; bell badge + dropdown are now data-driven and look up game visuals (initial, gradient, name) from the games_catalog state.
- Adding a new game's inbox = define one `<id>_pending_for(uid)` Postgres function. Zero hub code changes.

**Risks:**
| Type | Detail | Workaround |
|---|---|---|
| Game interruption | None — read-only. | — |
| Data loss | None. | — |
| User conflict | Wrong inbox counts — user misses a turn or chases a phantom one. | Shadow-run + mismatch log before cutover; feature flag on the client. |
| Performance | Unioning across 2+ games could be slower than bespoke queries. | Add appropriate indexes; set a 500ms client-side timeout; fall back to bespoke on timeout. |

**Backup plan:** Feature flag `VITE_SQ_USE_RPC=false` → hub uses the old per-game queries. Keep those queries in the codebase until the RPC has been stable for a month.

---

## Phase 7 — `user_game_access` (beta gating)

**Goal:** Enable closed-beta launches for new games (game #3 onward) and, later, per-game bans. Connects to the "Test groups" stub in `AdminPanel.jsx:121`.

**What to build:** (shipped 2026-04-24)
- `public.user_game_access(user_id, game_id, status check 'allowed'|'blocked', added_by, created_at)` with PK `(user_id, game_id)` and CASCADE deletes on the user and game refs.
- RLS: users see their own rows; any admin can read/insert/update/delete.
- Hub's `loadCatalog()` now also fetches `user_game_access` for the current user and tags each catalog row with `_access`: 'allowed' (open game OR user explicitly allowed), 'blocked' (filtered out), 'gated' (requires_access true and no allow row).
- Game grid renders gated games as a faded "Coming soon" card (no link, opacity-60, cursor-not-allowed).
- `sq_pending_for(uid)` now skips gated games where the user lacks access — no inbox notifications for games they can't open.
- New `AccessAdmin.jsx` (master-admin only, lives in AdminPanel): per game, shows requires_access state and the list of allowed users, with username search to add and per-row remove.
- **Crucial default preserved:** Wordy and Rungles seeded with `requires_access = false`. The gating logic is opt-in per game.

**Risks:**
| Type | Detail | Workaround |
|---|---|---|
| Game interruption | A misconfigured policy could hide a game from everyone. | `requires_access` stays false on all currently-launched games; only flipped on true for new betas. |
| Data loss | None. | — |
| User conflict | User doesn't understand why a game is hidden. | Show a "coming soon" card instead of nothing when `requires_access=true` and no access row; include a "request access" mailto. |

**Backup plan:** Drop the `requires_access` check from the hub query. Table can stay.

---

## Phase 7.5 — User groups

**Goal:** Named buckets of users so future ad-tier subscriptions, beta cohorts, and similar bulk-treatments don't require touching individual rows. Inserted between Phase 7 and Phase 8 once Rae flagged that a paid ad-free tier was a likely future direction.

**What was built:** (shipped 2026-04-24)
- `public.user_groups(id, name, description, created_by, created_at)` with id CHECK constraint enforcing `^[a-z][a-z0-9-]{1,49}$` for safe identifiers.
- `public.user_group_members(group_id, user_id, added_by, expires_at, created_at)` with PK `(group_id, user_id)` and CASCADE on both refs. `expires_at` (nullable) supports paid-tier memberships that lapse without scripting.
- `public.user_in_group(uid uuid, gid text) returns boolean` SQL function — takes expiry into account. Future ad-rendering / paywall code should call this rather than touching the tables directly.
- RLS: any admin reads groups; users read their own memberships; only master admins create/edit/delete groups or memberships.
- New `GroupsAdmin.jsx` (master-only): create groups (id + name + description), list all groups with member counts, per-group username search to add, per-row remove.
- `AccessAdmin.jsx` extended: each gated game now has a "Bulk grant: pick a group → Grant" control that upserts allowed access for every member in one shot.

**Risks / mitigation:**
| Type | Detail | Workaround |
|---|---|---|
| Game interruption | None — purely admin-side. | — |
| Data loss | Deleting a group cascades member rows away. | Confirmation dialog in the UI; no automatic group deletion anywhere. |
| User conflict | Bulk grant could give the wrong group access to a sensitive game. | Master-admin-only UI; explicit Group → Game pick before grant. |

**Backup plan:** Drop both tables (`DROP TABLE user_groups CASCADE` cascades members) — `user_game_access` is unaffected since groups never gate it directly, only convenience-bulk-write to it. UI components can be removed without other code changes.

---

## Phase 8 — Hub-level friendships

**Goal:** Let connections carry across games — invite someone in Wordy and they're in your Rungles invite dropdown too.

**What to build:**
- `friendships(user_a, user_b, status, created_at)` with `status in ('pending','accepted','blocked')`.
- Rule: `user_a < user_b` enforced via a check constraint so each pair is one row.
- RPC `are_friends(uid1, uid2)` for games to call.
- Hub UI: "Friends" section in settings dropdown — search, request, accept, remove.
- **Don't touch existing game invite flows yet.** This phase is additive: hub has a friends list, games optionally read it later.

**Risks:**
| Type | Detail | Workaround |
|---|---|---|
| Game interruption | None this phase — games still use their current invite logic. | — |
| Data loss | Existing "I've played with this person" implicit history isn't migrated. | Offer a one-time "add recent players as friends" button on first visit to the friends UI. |
| User conflict | Unwanted friend requests, spam. | Rate-limit requests per user per day; requests require mutual accept; blocking is one-sided and silent. |
| Schema | Users could insert malformed pairs (both IDs equal, wrong order). | Check constraints + RLS policies enforce validity. |

**Backup plan:** Dead-table — if the friends UI breaks, hide it with a feature flag. Games keep using their own invite lists. No game data affected.

---

## Phase 9 — Reports + block list

**Goal:** The infrastructure needed *before* opening to the public. Small friend group doesn't need it today, but it's painful to retrofit.

**What to build:**
- `reports(id, reporter, reported, game, reason, created_at, status)` — status starts as `'open'`, moves to `'reviewed'` by admin.
- `user_blocks(blocker, blocked, created_at)` — blocks are one-sided and silent.
- Admin panel: open-reports queue, with a "view profile" and "take action" flow.
- In-game "Report player" button becomes a shared hub component each game mounts.
- Invite dropdowns in games filter out blocked users.

**Risks:**
| Type | Detail | Workaround |
|---|---|---|
| Game interruption | Filtering invite dropdowns could surprise users ("where did X go?"). | Only filter for the blocker; blocked users see no change. Add tooltip on filtered list. |
| Data loss | Reports must survive even after a user is deleted. | Store `reported_username` snapshot on the report row; use `ON DELETE SET NULL` for the FK. |
| User conflict | Retaliatory reports, false flags. | Admin review before any action; cooldown of 1 report per reporter per target per 24h. |

**Backup plan:** UI can be hidden; tables persist (they're small). Re-enable when ready.

---

## Phase 10 — Rate limits (public-launch prep)

**Goal:** Protect the free tier from a single bad actor the day you open signups.

**What to build:**
- `rate_limits(user_id, action, window_start, count)` table.
- Postgres function `check_and_bump_rate_limit(uid, action, limit_per_hour)` that atomically increments and returns whether the user is over the limit.
- Call it in high-risk edge functions: push subscriptions, invite creation, report submission, profile updates.
- Start with generous limits (e.g. 100 invites/hour) and tighten based on real data from `sq_events`.

**Risks:**
| Type | Detail | Workaround |
|---|---|---|
| Game interruption | Legit power user gets rate-limited mid-game. | Start in log-only mode (record but don't enforce) for two weeks; review the top-hitting users; tune before enforcing. |
| Data loss | None. | — |
| User conflict | Generic "try again later" is frustrating. | Error message includes the exact reset time; admin panel has an "unlock" button for specific users. |

**Backup plan:** Remove the `check_and_bump_rate_limit` call sites (they're centralized in edge functions). Table keeps the log data for later tuning.

---

## Per-phase go/no-go checklist

Before marking a phase "done":

- [ ] New tables have RLS policies and at least one deny-by-default test.
- [ ] Feature flag (where applicable) has been flipped on and off once in staging.
- [ ] `pre-sq-phase-<n+1>` git tag created on all affected repos.
- [ ] Fresh schema snapshot saved.
- [ ] Announcement posted if users will see a visible change.
- [ ] One week of observation before starting the next phase.

---

## If a phase breaks production

1. **Flip the feature flag off** (if one exists) and redeploy the hub. 2–3 minute recovery.
2. **If no flag:** `git revert` the hub merge commit, redeploy. ~5 minutes.
3. **If the database itself is wrong:** restore schema from the latest snapshot in `snapshots/`. Game data (Wordy's `games`, Rungles's `rg_games`) is never touched by hub phases, so a hub-schema-only rollback is safe.
4. **Notify users:** post to the announcements table (or group chat if the hub itself is down).
5. **Write a short note** in `ROLLBACK.md` under that phase's section: what broke, what was done, what to fix before re-attempting.
