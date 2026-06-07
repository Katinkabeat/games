#!/usr/bin/env bash
# Quill 🪶 — edit a previously posted #updates message.
#
# Usage:
#   scripts/quill-edit.sh <message_id> "corrected blurb text"
#   echo "corrected blurb..." | scripts/quill-edit.sh <message_id>
#
# Find the message id in .quill-history.jsonl (logged by quill-post.sh), or via Discord:
# right-click the message → Copy Message ID (needs Developer Mode on). Only messages Quill
# posted through this webhook can be edited.
set -euo pipefail

cd "$(dirname "$0")/.."
source "$(dirname "$0")/quill-lib.sh"

if [[ $# -lt 1 ]]; then
  echo "usage: quill-edit.sh <message_id> \"new text\"   (or pipe the text on stdin)" >&2
  exit 1
fi
MID="$1"; shift

quill_load_webhook
quill_read_msg "$@"
quill_guard_dashes "$MSG"

PAYLOAD=$(mktemp)
trap 'rm -f "$PAYLOAD"' EXIT
python -c 'import json,sys; print(json.dumps({"content":sys.argv[1]}))' "$MSG" > "$PAYLOAD"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H "Content-Type: application/json" \
  --data-binary @"$PAYLOAD" "${WEBHOOK}/messages/${MID}")

if [[ "$CODE" == "200" ]]; then
  quill_log "edit" "$MID" "$MSG"
  echo "Quill message $MID edited (logged to $HISTORY_FILE)"
elif [[ "$CODE" == "404" ]]; then
  echo "error: message $MID not found (wrong id, or not posted by this webhook)" >&2
  exit 1
else
  echo "error: Discord returned HTTP $CODE" >&2
  exit 1
fi
