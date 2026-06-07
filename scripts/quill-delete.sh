#!/usr/bin/env bash
# Quill 🪶 — delete a previously posted #updates message.
#
# Usage:
#   scripts/quill-delete.sh <message_id>
#
# Find the message id in .quill-history.jsonl (logged by quill-post.sh), or via Discord:
# right-click the message → Copy Message ID (needs Developer Mode on). Only messages Quill
# posted through this webhook can be deleted.
set -euo pipefail

cd "$(dirname "$0")/.."
source "$(dirname "$0")/quill-lib.sh"

if [[ $# -lt 1 ]]; then
  echo "usage: quill-delete.sh <message_id>" >&2
  exit 1
fi
MID="$1"

quill_load_webhook

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${WEBHOOK}/messages/${MID}")

if [[ "$CODE" == "204" ]]; then
  quill_log "delete" "$MID" ""
  echo "Quill message $MID deleted (logged to $HISTORY_FILE)"
elif [[ "$CODE" == "404" ]]; then
  echo "error: message $MID not found (wrong id, or not posted by this webhook)" >&2
  exit 1
else
  echo "error: Discord returned HTTP $CODE" >&2
  exit 1
fi
