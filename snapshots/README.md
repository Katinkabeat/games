# Supabase snapshots

This folder holds timestamped Supabase schema + data dumps taken before each SQ plan phase.

**Everything in here is gitignored** except this README. Dumps never get committed — they may contain secrets, user data, or just be too big. Keep them on local disk (and optionally back one up to Dropbox or a USB drive, but never the repo).

## How to take a snapshot

From the `rae-side-quest/` root:

```bash
# Requires the Supabase CLI and a DB URL with service-role creds.
# Get the URL from Supabase dashboard → Settings → Database → Connection string (URI).
export SUPABASE_DB_URL="postgresql://postgres:...@db.yyhewndblruwxsrqzart.supabase.co:5432/postgres"

supabase db dump --db-url "$SUPABASE_DB_URL" > "snapshots/pre-phase-N-$(date +%F).sql"
```

Replace `N` with the phase number you're about to start (e.g. `pre-phase-1-2026-04-24.sql`).

## How to restore (emergency only)

Hub-only phases never touch Wordy or Rungles game tables, so a full restore is almost never needed. If schema corruption happens:

```bash
# Restore just the schema — NOT the data — into a fresh connection.
# Only do this if a hub migration went sideways and you need to roll schema back.
psql "$SUPABASE_DB_URL" -f snapshots/pre-phase-N-YYYY-MM-DD.sql
```

**Warning:** a raw replay overwrites existing tables. Before restoring, read `ROLLBACK.md` in the repo root — for most phases, flipping a feature flag or reverting the hub commit is enough, and no database restore is needed.
