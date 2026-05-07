# Supabase Advisor Triage — 2026-05-06

Snapshot pulled via Management API. **237 total** (170 security + 67 perf).

Most warnings are duplicates of the same root issue. Real distinct work items: **6**.

---

## FIX

### 1. SECDEF function hardening — clears 165 of 170 security warnings
~55 SECURITY DEFINER functions trip three lints each:
- `function_search_path_mutable` — no `SET search_path`
- `anon_security_definer_function_executable` — granted to anon
- `authenticated_security_definer_function_executable` — granted to authenticated

**Approach:** one migration that, for every `public.*` SECURITY DEFINER function:
1. Adds `SET search_path = public, pg_temp` (matches the recursion-fix migration's style).
2. Revokes EXECUTE from `public` and `anon`.
3. Re-grants EXECUTE to `authenticated` only for functions called from app code.
4. Revokes EXECUTE from both for trigger-only functions (`set_turn_started_at`, `notify_*`, `*_invite_check_trigger`, `sq_notification_default`, `user_notif_prefs_set_updated_at`, etc. — triggers run as the function owner so caller grants don't matter).

**Risk:** medium. Wrong grant on a function called by the UI = "permission denied" at runtime. Need to audit callsites.

**Detail:** [§Plan below](#plan-secdef-hardening).

---

### 2. `rls_policy_always_true` on `player_matchups` "matchups: upsert"
Real bug. Policy is `USING (true) WITH CHECK (true)` — anyone can upsert any matchup row.

**Fix:** rewrite to `USING ((SELECT auth.uid()) = player_id) WITH CHECK ((SELECT auth.uid()) = player_id)`.
**Risk:** low. Should match what the existing "matchups: read own" SELECT policy already enforces.

---

### 3. `auth_leaked_password_protection` (HIBP)
One toggle in dashboard → Authentication → Providers → Email → "Leaked password protection". Free, no migration needed.
**Risk:** zero.

---

### 4. `multiple_permissive_policies` — 31 warnings on 11 tables
Tables with both a `FOR ALL` policy and per-action policies. Each request evaluates both.

Worst offenders (6 warnings each = many redundant policies):
- `public.admins`
- `public.player_matchups`
- `public.sn_matches`
- `public.user_notification_prefs`

**Approach:** for each table, drop the `FOR ALL` policy and keep the explicit per-action ones (or vice versa, whichever covers the use cases).
**Risk:** medium. Wrong consolidation = breakage. Per-table review needed.
**Defer until:** SECDEF migration (#1) is shipped and verified.

---

## DEFER (real but low impact)

### 5. `unindexed_foreign_keys` — 22 FKs missing covering indexes
Most are admin/audit columns rarely used in queries (`closed_by_fkey`, `forfeit_user_id_fkey`, `added_by_fkey`, `reviewed_by_fkey`). Skip those.

**Add indexes only for hot-path FKs:**
- `game_moves_game_id_fkey` — game_moves is heavy-write; this matters
- `games_created_by_fkey` — used by lobby filters
- `rg_games_created_by_fkey` — same for Rungles
- `sn_matches_winner_id_fkey` — leaderboard joins
- `rg_racks_user_id_fkey` — tile rack lookups
- `sn_progress_pet_id_fkey`, `sn_daily_feeds_pet_id_fkey` — pet stats

Use `CREATE INDEX CONCURRENTLY` so no table lock.
**Risk:** zero (CONCURRENTLY is safe).

---

## IGNORE / KEEP AS-IS

### 6. `rls_enabled_no_policy` on `heartbeat`, `rate_limits`, `rg_game_secrets`
These are intentionally sealed — only writable via SECDEF functions, never accessed directly. RLS-on + no-policy = "deny all direct access" which is the desired state. Mark as expected.

### 7. `unused_index` — 14 indexes
Several are recent (post-RLS-rewrite indexes for the new lobby filters; usage stats reset on `pg_stat_reset()`). Drop only after a few weeks of confirmed zero usage AND confirming they're not used by upcoming code paths. Low priority.

---

# Plan: SECDEF hardening

## What it changes
For each SECURITY DEFINER function in `public`:
- `ALTER FUNCTION ... SET search_path = public, pg_temp;` — locks schema resolution. Anything that did `SELECT * FROM games` (unqualified) keeps working as long as the table is in `public`. Anything that depended on `pg_temp` or another schema being in path breaks.
- `REVOKE EXECUTE ... FROM public, anon;` — strips broad grants.
- `GRANT EXECUTE ... TO authenticated;` — re-grants to logged-in users only, for functions the UI calls. Trigger-only functions get nothing (they don't need it).

## How it could break things
1. **Anonymous flows.** I checked: `handle_new_user()` is a trigger fired by Postgres on `auth.users` INSERT — it runs as the trigger owner regardless of who triggered it, so revoking from anon is safe. No other functions appear to be called pre-login.
2. **Wrong call-site classification.** If I mark a function "trigger only" but it's actually called from JS via `supabase.rpc()`, that flow will get `permission denied`. The way to catch this: grep all `.rpc(` and `from('rpc/` callsites in `wordy/`, `rungles/`, `snibble/`, and `rae-side-quest/` and cross-reference against the function list. I'll do that before writing the migration.
3. **`search_path` surprises.** Functions that reference tables in `auth` or `extensions` schema by short name would break. None of the SECDEF functions I've seen so far do this — they all qualify cross-schema refs (e.g. `auth.users`, `pg_catalog.now()`).
4. **Realtime triggers.** A few `notify_*` functions invoke `pg_notify` and call `net.http_post` (push). These run as trigger owner; grants don't affect them. Safe.

## Rollback
Migration is idempotent and reversible:
- Re-add `GRANT EXECUTE ... TO anon;` to undo a permission revoke.
- `ALTER FUNCTION ... RESET search_path;` to undo the search_path lock.
No data is touched. Worst case: revert the migration in <5 min.

## Verification before shipping
1. `supabase db query --linked` to apply the migration to the shared project.
2. Re-fetch `/advisors/security` — should drop from 170 → ~5.
3. **Smoke test in local dev:** load SQ hub, create a game in Wordy, take a turn in Rungles, claim a daily feed in Snibble. Each exercises a different set of SECDEF functions.
4. If anything breaks, the error will be `function ... permission denied` — easy to find which function needs `authenticated` re-granted.

## Order of operations
1. Audit step (read all `.rpc(` calls in the four SQ projects) → produces a definitive "called-from-UI" list.
2. Write `supabase/migrations/2026_05_06_secdef_hardening.sql` based on that list.
3. Apply to shared project.
4. Re-fetch advisors, confirm ~165 cleared.
5. Smoke test.
6. Commit + push (no app code change, so no GitHub Pages redeploy).

Estimated time: ~45 min for audit + migration write, ~10 min apply + verify.
