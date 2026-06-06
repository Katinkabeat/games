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
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.supabase"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found (run from the rae-side-quest repo)" >&2
  exit 1
fi

WEBHOOK=$(grep '^SQ_DISCORD_UPDATES_WEBHOOK=' "$ENV_FILE" | tr -d '\r' | cut -d'=' -f2-)
if [[ -z "${WEBHOOK:-}" ]]; then
  echo "error: SQ_DISCORD_UPDATES_WEBHOOK not set in $ENV_FILE" >&2
  exit 1
fi

# Message from $1 or stdin.
if [[ $# -ge 1 ]]; then
  MSG="$1"
else
  MSG="$(cat)"
fi
if [[ -z "${MSG// /}" ]]; then
  echo "error: empty message" >&2
  exit 1
fi

# Build JSON safely via python (handles quoting/newlines/unicode), post from a temp file.
PAYLOAD=$(mktemp)
trap 'rm -f "$PAYLOAD"' EXIT
python -c 'import json,sys; print(json.dumps({"username":"Quill","content":sys.argv[1]}))' "$MSG" > "$PAYLOAD"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Content-Type: application/json" --data-binary @"$PAYLOAD" "$WEBHOOK")
if [[ "$CODE" == "204" ]]; then
  echo "Quill posted to #updates (HTTP 204)"
else
  echo "error: Discord returned HTTP $CODE" >&2
  exit 1
fi
