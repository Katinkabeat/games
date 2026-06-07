#!/usr/bin/env bash
# Quill 🪶 — post a player-facing blurb to the SideQuest Discord #updates changelog.
#
# Usage:
#   scripts/quill-post.sh "🎮 New game: Yahdle is live! Roll the dice and fill your scorecard."
#   echo "multi-line blurb..." | scripts/quill-post.sh
#
# Reads the webhook URL from .env.supabase (SQ_DISCORD_UPDATES_WEBHOOK), which is gitignored.
# Posts as username "Quill". Curated-at-ship-time: only call this for player-facing SQ changes
# (new game / new feature / a bug players actually felt) — not internal refactors or version bumps.
#
# Posts with ?wait=true so Discord returns the message object; the message id is logged to
# .quill-history.jsonl so the post can later be edited (quill-edit.sh) or removed (quill-delete.sh).
set -euo pipefail

cd "$(dirname "$0")/.."
source "$(dirname "$0")/quill-lib.sh"

quill_load_webhook
quill_read_msg "$@"
quill_guard_dashes "$MSG"

# Build JSON safely via python (handles quoting/newlines/unicode), post from a temp file.
PAYLOAD=$(mktemp)
trap 'rm -f "$PAYLOAD"' EXIT
python -c 'import json,sys; print(json.dumps({"username":"Quill","content":sys.argv[1]}))' "$MSG" > "$PAYLOAD"

# ?wait=true makes Discord return the created message (with its id) instead of an empty 204.
RESP=$(curl -s -w "\n%{http_code}" -H "Content-Type: application/json" \
  --data-binary @"$PAYLOAD" "${WEBHOOK}?wait=true")
CODE=$(printf '%s' "$RESP" | tail -n1)
BODY=$(printf '%s' "$RESP" | sed '$d')

if [[ "$CODE" == "200" || "$CODE" == "204" ]]; then
  MID=$(printf '%s' "$BODY" | python -c 'import json,sys
try:
    print(json.load(sys.stdin).get("id",""))
except Exception:
    print("")' 2>/dev/null || true)
  if [[ -n "$MID" ]]; then
    quill_log "post" "$MID" "$MSG"
    echo "Quill posted to #updates (id $MID, logged to $HISTORY_FILE)"
  else
    echo "Quill posted to #updates (HTTP $CODE) but no message id returned — not logged, won't be editable"
  fi
else
  echo "error: Discord returned HTTP $CODE" >&2
  exit 1
fi
