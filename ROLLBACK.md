# Rae's Side Quest — Rollback playbook

Quick-reference commands to recover from a failed phase. For the full plan and rationale, see [`SQ_PHASED_PLAN.md`](SQ_PHASED_PLAN.md).

## Recovery order of operations

Try these in order. Stop as soon as the hub is working again.

1. **Flip the feature flag off.** If the phase has one (Phases 3, 5, 6, etc.), set it to `false` in `.env` and redeploy the hub. ~2–3 min.
2. **Revert the hub commit.** `git revert <merge-sha>` on the hub repo, push, wait for GitHub Actions. ~5 min.
3. **Roll back the database schema.** Only needed for destructive migrations, which the plan deliberately avoids. See [`snapshots/README.md`](snapshots/README.md) for the restore command.
4. **Tell users.** Post to the announcements table once Phase 3 ships. Until then, message the group chat.
5. **Log the incident.** Add a short entry under the relevant phase in this file: what broke, what you did, what needs to change before re-attempting.

---

## Pre-phase safety checklist

Before starting any phase:

```bash
# 1. Tag all three repos
cd ~/OneDrive/Claude/rae-side-quest && git tag -a pre-sq-phase-<N> -m "Before SQ phase <N>"
cd ~/OneDrive/Claude/wordy         && git tag -a pre-sq-phase-<N> -m "Before SQ phase <N>"
cd ~/OneDrive/Claude/rungles       && git tag -a pre-sq-phase-<N> -m "Before SQ phase <N>"

# 2. Push the tags (once you're comfortable — these are cheap to delete locally but remote pushes are visible)
cd ~/OneDrive/Claude/rae-side-quest && git push --tags
cd ~/OneDrive/Claude/wordy         && git push --tags
cd ~/OneDrive/Claude/rungles       && git push --tags

# 3. Snapshot the database (see snapshots/README.md for full command)
supabase db dump --db-url "$SUPABASE_DB_URL" > "snapshots/pre-phase-<N>-$(date +%F).sql"

# 4. Save the edge function inventory
supabase functions list > "snapshots/pre-phase-<N>-functions-$(date +%F).txt"
```

---

## Per-phase rollback

### Phase 0 — Backup & safety net
Nothing to roll back. If the snapshot or tags didn't take, just re-run the commands above.

### Phase 1 — Supabase heartbeat cron
Shipped via in-DB pg_cron. Full reversal in SQL editor:
```sql
SELECT cron.unschedule('sq-heartbeat');
DROP TABLE IF EXISTS public.heartbeat;
-- Leave pg_cron extension enabled — it's useful for future phases.
```

### Phase 2 — Shared events telemetry
Shipped via table + RLS + pg_cron retention. Full reversal in SQL editor:
```sql
SELECT cron.unschedule('sq-events-retention');
DROP TABLE IF EXISTS public.sq_events CASCADE;
```
Plus in code:
- Revert the single `logEvent('app_opened')` call in `rae-side-quest/src/components/LandingPage.jsx` and remove the `import { logEvent }` line.
- Delete `wordy/src/lib/telemetry.js`, `rungles/js/telemetry.js`, `rae-side-quest/src/lib/telemetry.js` (none of them have wired call sites in wordy/rungles yet, so no other code changes needed).

### Phase 3 — Announcements banner
Quick disable (UI only, table stays):
```bash
# In rae-side-quest/.env
VITE_SQ_ANNOUNCEMENTS=false
```
Redeploy. Banner disappears for everyone; admin form still visible to master admins so they can manage existing rows.

Full reversal (drop the feature):
```sql
DROP TABLE IF EXISTS public.announcements CASCADE;
```
Plus: in `rae-side-quest`, remove the `<AnnouncementBanner />` render in `LandingPage.jsx`, the `<AnnouncementsAdmin />` render in `AdminPanel.jsx`, and delete `AnnouncementBanner.jsx` and `AnnouncementsAdmin.jsx`.

### Phase 4 — Realtime inbox updates
Frontend-only change (no DB migration). Revert the inbox useEffect in
`rae-side-quest/src/components/LandingPage.jsx` back to mount-only fetch:
```bash
cd ~/OneDrive/Claude/rae-side-quest
git revert <phase-4-merge-sha>
git push
```
Or flip a feature flag (none wired yet — if added later, set
`VITE_SQ_REALTIME_INBOX=false` and the channel subscription will be skipped).
No DB rollback needed — the realtime publication and RLS policies remain
as they were.

### Phase 5 — Games catalog table
Quick disable (frontend flag):
```bash
# In rae-side-quest/.env
VITE_SQ_USE_CATALOG=false
```
Redeploy. Hub returns to the hardcoded `FALLBACK_GAMES` array in `LandingPage.jsx`. No DB change needed — the table and seeded rows stay in place.

Full reversal (drop the table):
```sql
DROP TABLE IF EXISTS public.games_catalog;
```
Plus in code: restore the `GAMES` constant name (or keep `FALLBACK_GAMES` — same effect), remove `USE_CATALOG`, `games` state, `loadCatalog()`, and the `Promise.all([loadProfileAndAdmin(), loadCatalog()])` call (change back to just `await loadProfileAndAdmin()`), and change `games.map` back to the hardcoded constant name.

### Phase 6 — Unified pending-actions RPC
Quick disable (frontend flag):
```bash
# In rae-side-quest/.env
VITE_SQ_USE_RPC=false
```
Redeploy. The hub will call `recountInboxLegacy()` (the original per-game `from('game_players')` and `from('rg_players')` queries) instead. The legacy fallback stays in code indefinitely — there's no plan to remove it.

Full reversal (drop the SQL functions):
```sql
DROP FUNCTION IF EXISTS public.sq_pending_for(uuid);
DROP FUNCTION IF EXISTS public.wordy_pending_for(uuid);
DROP FUNCTION IF EXISTS public.rungles_pending_for(uuid);
```
With the flag still on, the RPC call will fail and the hub will fall back to legacy queries automatically — no extra UI rollback needed.

### Phase 7 — `user_game_access` (beta gating)
Quick disable (open every gated game without dropping the table):
```sql
UPDATE public.games_catalog SET requires_access = false;
```
Everyone sees every published game again. Access rows persist; flipping `requires_access` back to true re-enables gating.

Full reversal (drop the table + revert hub):
```sql
-- Restore original sq_pending_for (no access check) — see git history for the version without the requires_access branch
DROP TABLE IF EXISTS public.user_game_access CASCADE;
```
Plus in code: revert the `loadCatalog` Promise.all to a single catalog fetch, remove `_access` handling in the game grid render, remove `<AccessAdmin />` from `AdminPanel.jsx`, and delete `src/components/AccessAdmin.jsx`.

### Phase 7.5 — User groups
Drop both tables and the helper. user_game_access rows previously
inserted via the bulk-grant button stay in place (groups only
convenience-write to that table; they never gate access at read time):
```sql
DROP FUNCTION IF EXISTS public.user_in_group(uuid, text);
DROP TABLE IF EXISTS public.user_groups CASCADE;  -- cascades user_group_members
```
Plus in code: remove `<GroupsAdmin />` from `AdminPanel.jsx`, delete `GroupsAdmin.jsx`, and revert the bulk-grant block in `AccessAdmin.jsx` (the per-user search still works without it).

### Phase 8 — Hub-level friendships
**Friend-request notification (live since 2026-04-25):** edge function deployed via Supabase CLI 2.90.0 (installed via Scoop). DB trigger `friendships_notify_on_insert` is wired.

Quick disable of just the notification (keeps friendships working):
```sql
DROP TRIGGER IF EXISTS friendships_notify_on_insert ON public.friendships;
DROP FUNCTION IF EXISTS public.notify_friend_request();
```
The edge function can be left deployed — without the trigger, it just sits idle. Re-enable later by running `supabase/migrations/sq_friend_request_trigger.sql`.

Quick disable of the friends UI (frontend only — table can stay):
- Remove `<FriendsView />` render block in `LandingPage.jsx`.
- Remove the "Friends 👥" entry in `SettingsDropdown.jsx`.
- Drop the `onOpenFriends` prop from LandingPage's SettingsDropdown call.

Full reversal (drop the table + RPCs):
```sql
DROP FUNCTION IF EXISTS public.are_friends(uuid, uuid);
DROP FUNCTION IF EXISTS public.request_friendship(uuid);
DROP FUNCTION IF EXISTS public.accept_friendship(uuid);
DROP FUNCTION IF EXISTS public.remove_friendship(uuid);
DROP TABLE IF EXISTS public.friendships;
```
Wordy/Rungles invite flows aren't using `are_friends` yet, so dropping has no game-side impact. To remove the edge function too:
```bash
# Via Supabase dashboard: Functions → sq-friend-request-notification → Delete
# Or via Management API:
curl -X DELETE -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/yyhewndblruwxsrqzart/functions/sq-friend-request-notification"
```
```bash
# In rae-side-quest/.env
VITE_SQ_FRIENDS=false
```
Redeploy. The friends section in settings disappears. Games keep using their own invite lists — this phase never changed them.

### Phase 9 — Reports + block list
```bash
# In rae-side-quest/.env
VITE_SQ_REPORTS=false
```
Redeploy. The report button vanishes; invite dropdowns stop filtering blocked users. Tables persist — re-enable later.

### Phase 10 — Rate limits
Remove the `check_and_bump_rate_limit` calls from the affected edge functions and redeploy them:
```bash
supabase functions deploy <function-name>
```
Logging table stays for future tuning.

---

## Full schema restore (last resort)

Only if a destructive migration corrupted the hub schema:

```bash
psql "$SUPABASE_DB_URL" -f snapshots/pre-phase-<N>-YYYY-MM-DD.sql
```

This replays the entire saved schema. Game data in Wordy (`games`, `game_players`, `game_moves`) and Rungles (`rg_games`, `rg_players`, etc.) is never touched by hub phases, so a hub-schema restore is safe to run without affecting active games.

---

## Incident log

Record any rollback events here. Template:

```
### YYYY-MM-DD — Phase <N> rollback
- What broke:
- What I did:
- What to change before re-attempting:
```
