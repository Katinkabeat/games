# Quill 🪶 shared helpers — sourced by quill-post.sh / quill-edit.sh / quill-delete.sh.
# Not executable on its own.

HISTORY_FILE=".quill-history.jsonl"

# Loads the Discord webhook URL from .env.supabase into $WEBHOOK. Exits on failure.
quill_load_webhook() {
  local env_file=".env.supabase"
  if [[ ! -f "$env_file" ]]; then
    echo "error: $env_file not found (run from the rae-side-quest repo)" >&2
    exit 1
  fi
  WEBHOOK=$(grep '^SQ_DISCORD_UPDATES_WEBHOOK=' "$env_file" | tr -d '\r' | cut -d'=' -f2-)
  if [[ -z "${WEBHOOK:-}" ]]; then
    echo "error: SQ_DISCORD_UPDATES_WEBHOOK not set in $env_file" >&2
    exit 1
  fi
}

# Reads the message from $1 or stdin into $MSG, erroring on empty.
quill_read_msg() {
  if [[ $# -ge 1 ]]; then
    MSG="$1"
  else
    MSG="$(cat)"
  fi
  if [[ -z "${MSG// /}" ]]; then
    echo "error: empty message" >&2
    exit 1
  fi
}

# Voice guard: Quill posts are published, player-facing copy, so the no-em-dash
# rule applies (feedback_writing_style). Block em (—) and en (–) dashes outright
# rather than auto-substituting — a wrong replacement reads worse than a reject.
quill_guard_dashes() {
  python -c '
import sys
msg = sys.argv[1]
bad = {"—": "em dash (—)", "–": "en dash (–)"}
hits = [name for ch, name in bad.items() if ch in msg]
if hits:
    sys.stderr.write("error: blurb contains " + ", ".join(hits) +
                     ". Published copy must use periods, commas, or parentheses instead.\n")
    sys.exit(1)
' "$1"
}

# Appends an action record (action, id, content) to the gitignored history log.
# Writes the file directly in UTF-8 (not via stdout) so emoji in blurbs don't trip
# Windows' cp1252 console. Never fatal: a logging hiccup must not make a sent post
# look like a failure, so it warns and returns success.
quill_log() {
  local action="$1" mid="$2" content="$3"
  python -c '
import json, sys, datetime
ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
rec = {"ts": ts, "action": sys.argv[1], "id": sys.argv[2], "content": sys.argv[3]}
with open(sys.argv[4], "a", encoding="utf-8") as f:
    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
' "$action" "$mid" "$content" "$HISTORY_FILE" \
    || echo "warn: posted ok but failed to log id $mid to $HISTORY_FILE" >&2
}
