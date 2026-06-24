# SideQuest Discord — Feature Options (scoping)

> ## ✅ FINAL DECISIONS (2026-06-08) — see cards c203 / c202
> One custom bot, **working name "Rook"** (gamey bird: corvid + chess piece; cozy "direction A" voice). Built by us, hosted on the rae VM (Dean OK'd it).
> **v1 (build card c203):** welcome · game/role channels · leaderboards · **SQ-activity** roles (gameplay, not Discord chat) · auto-moderation. *Daily-puzzle ping dropped* (players use SQ's own notifications).
> **Deferred to backlog (c202):** trivia + riddle "word nights", `/profile` card, polls, events/RSVP, Discord-presence roles, ticketing, match-found pings.
> **Build dependency:** a read-only Supabase edge fn for leaderboard/activity data so the bot holds no DB creds.
> **AI/LLM free-form chat is RULED OUT** (Rae, 2026-06-08) — security + not needed. Rook is fully authored; every line is hand-written. Voice is **games-forward** (game-host, chess/word-game idiom, not bird/nest) — see `docs/rook-voice.md`.
> The "Pip" name, the persona "Tier 2 conversational/LLM" option, and the daily-ping recommendation below are all superseded by the above.

Status: research/brainstorm for Raeban **c189** (done). This was the menu; the picks are locked above.
Companion card: **c192** (in-app feedback → Discord admin triage feed + feedback→Raeban-card agent) is already deep-scoped on its own; it is *referenced* here, not re-scoped.

## What already exists (so effort estimates are grounded)
- **Quill bot** — webhook poster to a `#updates` channel for player-facing changelogs. Scripts: `scripts/quill-post.sh` / `quill-edit.sh` / `quill-delete.sh` / `quill-lib.sh`. Webhook env: `SQ_DISCORD_UPDATES_WEBHOOK`. Voice guard already strips em/en dashes. History logged to `.quill-history.jsonl`.
- **In-app feedback** — `sq-feedback` edge fn + `feedback` table (bug/idea/other, status new/read/resolved, optional email forward). The cleaner data path than Discord (see c192).
- **Push infra that could fan out to Discord** — `sq-daily-reminder` (pg_cron every 30 min, per-user local-time slots, opt-in checked) and `sq-friend-request-notification` (DB trigger → edge fn). Both already POST to edge functions at scale; either could *also* POST to a Discord webhook.
- One webhook in use today. Adding features = mostly new webhooks + new channels + (for the persona bot) a real bot application, not just a webhook.

> **Webhook vs. bot — the one architectural fork.** Almost everything below except the persona bot can be done with **incoming webhooks** (what Quill uses): trivial, no hosting, post-only, can't read messages or respond. The persona bot needs a **real Discord bot application** (gateway connection, hosting, reads messages, replies). That's the single biggest effort cliff in this doc — call it out when choosing.

---

## Part 1 — The persona bot (our "Rick")

Dean built a witty agent named Rick. The idea here is **our own SQ-flavoured equivalent**: a Discord bot with SideQuest knowledge and a personality we design. Because Rae has aphantasia and reacts better to concrete options than abstractions, here are three distinct voice directions to pick between — not a single pre-baked choice.

### What it would *know* (same regardless of voice)
- The four games (Wordy, Rungles, Snibble, Yahdle) — rules, how to start, solo vs. multiplayer.
- Live-ish facts: today's daily puzzle is up, leaderboards, "is anyone in a lobby right now."
- FAQ / help answers (how do invites work, how to delete my account, where's my game).
- Light community banter in channels it's invited to.

### What it would *do* (pick a subset)
- Answer `/help`-style questions in-character instead of a dry FAQ.
- Welcome new members with personality.
- Daily-puzzle "it's live" banter, match-found shout-outs, leaderboard ribbing.
- Optional: free-form chat in a dedicated channel (this is the cost driver — needs LLM calls + message history + moderation).

### Three voice directions to react to

| Direction | Vibe | Sample line ("daily Wordy is up") | Risk |
|---|---|---|---|
| **A — Cozy host** ("Pip"/"Wren") | Warm, encouraging, gentle nest-keeper. Matches TSN/SQ cozy content surfaces. | "Morning, flock. Today's Wordy board just hatched — go stretch your wings. 🪺" | Can get saccharine; low comedic punch. |
| **B — Dry wit** ("Rick"-adjacent) | Sardonic, deadpan, roasts your bad plays affectionately. Closest to Dean's Rick. | "New Wordy's up. Try not to open with a three-letter word again. I'm watching." | Tone has to stay *affectionate* or it reads mean to newcomers. |
| **C — Overconfident game-master** ("The Quizmaster") | Theatrical, DnD-narrator energy, treats every match like an epic. Pairs great with Lexicon Quest (c93). | "A new challenge MANIFESTS. Today's Wordy grid awaits the worthy. Will it be you? (It is rarely you.)" | Can tire fast if it's *every* message; best as occasional flavour. |

My read: **B (dry wit)** is the most on-brand with "our own Rick" and the funniest, but the safe high-value v1 is a **post-only persona** (welcome + daily banter + FAQ answers via slash command) *before* committing to free-form LLM chat. Free-form chat is where hosting cost, moderation, and "bot says something weird" risk all live.

### Effort tiers for the persona bot
- **Tier 0 — Persona *voice* only, no bot app (XS):** give Quill a personality for the existing `#updates` posts. Zero new infra. Basically a copy/system-prompt change. Good toe-in-water.
- **Tier 1 — Slash-command FAQ + welcome bot (M):** real bot app, hosted (rae VM is the natural home — see `reference_rae_vm`), responds to `/help`, `/games`, `/today`; greets newcomers. No free-form chat. Answers can be templated or LLM-backed.
- **Tier 2 — Conversational persona (L):** free-form in-character chat in a dedicated channel, message-history memory, LLM per reply, rate-limit + moderation. This is the big one; defer until Tier 1 proves people use it.

---

## Part 2 — Other Discord additions

Each rated rough **value** (to players) and **effort**. Effort uses the board's XS/S/M/L.

| # | Feature | What it is | Value | Effort | Notes / dependency |
|---|---|---|---|---|---|
| 1 | **Onboarding / welcome flow** | Auto-DM or channel greet on join + a "start here" channel: which games exist, how to log in, link to hub. Optional rules quiz. | High | S (webhook+channel) / M (with bot DM) | Retention win per research. Plain version is a static "start here" + a join webhook; richer version needs the bot (overlaps persona Tier 1). |
| 2 | **Role & game-specific channels** | Self-assign roles (which games you play) → unlock per-game channels; reaction-roles. | Med | S | Mostly server config + a reaction-role bot (off-the-shelf) or our bot. Reduces channel noise. |
| 3 | **Changelog automation v2** | Extend Quill: post per-game (not just one #updates), thread discussion, react-to-subscribe. | Med | S–M | Builds directly on existing Quill scripts. Cheap incremental win. |
| 4 | **Daily-puzzle ping** | "Today's Wordy/Rungles/Snibble/Yahdle is live" auto-post each morning, per game. | High | S | `sq-daily-reminder` already runs on cron — add a Discord webhook POST. Strong habit-former, low effort. Best early win. |
| 5 | **Leaderboards in Discord** | Post daily/weekly leaderboard standings; optional XP/level via MEE6-style bot. | Med–High | M | Needs leaderboard data exposed to a poster job. Native (our data) beats a generic XP bot for *game* scores. |
| 6 | **Match-found / nudge notifications** | "It's your turn" or "someone's waiting in a lobby" pinged to Discord (opt-in). | Med | M | Overlaps existing push infra (`sq-friend-request-notification` pattern). Careful: don't double-notify (push + Discord). Per-user opt-in required. |
| 7 | **Self-serve FAQ / help** | Pinned FAQ + `/help` answers (static or persona-bot). | Med | XS (static) / M (bot) | Static pinned post is nearly free and covers 80%. Bot version = persona Tier 1. |
| 8 | **Bug-report template** | A `#bug-reports` form/template so reports are structured. | Low–Med | XS | Largely redundant — the in-app feedback form already captures structured reports better (c192). Skip unless players prefer Discord. |
| 9 | **Feedback triage feed** | Admin-only mirror of in-app feedback + agent→Raeban-card pipeline. | High (for us) | M | **Already its own card: c192.** Don't duplicate here. |

---

## Recommended sequence (my opinion)

1. **#4 Daily-puzzle ping** — highest value-to-effort; reuses the cron job; builds the daily habit. (S)
2. **#1 Onboarding "start here"** static version + join greet. (S)
3. **#3 Changelog v2** per-game extension of Quill. (S)
4. **Persona Tier 0** — give Quill a voice (pick direction A/B/C). (XS) — cheap personality without a bot app.
5. *Then* decide whether the **persona bot Tier 1** (real bot, hosted on rae VM) is worth it based on whether the community is active.
6. c192 (feedback agent) proceeds on its own track.

Everything from step 5 onward is the real cost cliff (bot app + hosting + LLM); steps 1–4 are all webhook-only and cheap.

## Open questions for Rae
- Persona voice: **A cozy / B dry-wit / C game-master** — or a blend?
- Persona bot: stop at **Tier 0 (voiced Quill)** for now, or commit to **Tier 1 (hosted slash-command bot)**?
- Which of #1–#7 do you actually want? (My pick: 4, 1, 3 first.)
- Hosting: assume the bot lives on the rae VM (Dean's infra) when we get to a real bot app?

---
*Sources consulted: CommunityOne best-bots & welcome-bot guides, Quickchat/Medium LLM-persona-bot writeups, MEE6/Engagerly gamification patterns (2026).*
