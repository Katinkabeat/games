# Rook — Voice Guide & Line Bank

Working voice doc for the SideQuest Discord bot **Rook** (build card c203). This is the single source of truth for his personality. It feeds the authored message strings the bot ships with (`messages.js` — line banks below).

> **Rook is fully authored. No LLM, no AI chat.** Every line he says is one we wrote, picked from the banks below. Deliberate call (Rae, 2026-06-08): a free-form LLM chat would add prompt-injection, abuse, cost, and moderation risks for no real benefit. A good host doesn't need to improvise.

> **First-pass copy.** Lines live in a separate strings file, so any wording here is cheap to change later: edit the string, restart the service, done. Redline freely.

---

## Who Rook is

Rook is the **game-host of SideQuest** — the one who runs the table. His name is a chess piece, so he carries himself like someone who knows the game cold: sharp, quick, a little wry, but on your side. He's the friendly regular at the game café who remembers your name and your best score, ribs you when you whiff an easy word, and is genuinely glad when you're on a run.

Not a mascot, not a cheerleader, not a customer-service bot. A **host with a personality** — warm underneath, gamey on the surface.

## Voice rules

- **Games-forward, not bird/nest.** Lean on game-table language: moves, plays, openings, gambits, tiles, racks, words, runs, quests, players, the board, the standings. Rook's name gives him chess idiom for free ("your move," "well played," "good opening").
- **Warm, lightly witty — never mean.** He teases, he doesn't mock. A newcomer or a struggling player gets encouragement, not a roast. Save the ribbing for people clearly in on the joke (streaks, leaderboard banter).
- **Short.** One or two lines. He's a host working the room, not giving a speech.
- **Confident and clued-in.** He knows the games, the standings, who's hot. Speaks with quiet authority, not hype.
- **Emoji: sparing.** A 🏆 on standings, an occasional ♟️ or 🎲. Not every line.
- **No em dashes or en dashes** (— –) in any published line. Use periods, commas, parentheses. (Same guard as the Quill bot.)
- **Inclusive, low-key.** "Folks," "everyone," "challengers." No edgelord humor, no put-downs, nothing that reads mean to a first-timer.

## Do / Don't

| Do | Don't |
|---|---|
| Welcome warmly, point people to the games | Gush or over-emoji |
| Celebrate wins and streaks | Mock losses or low scores |
| Tease players already in on the banter | Roast newcomers or quiet members |
| Use chess / word-game / quest idiom | Lean on bird/nest metaphors |
| Keep it to a line or two | Write paragraphs |
| Stay neutral and fair as a moderator | Get sarcastic when enforcing rules |

---

## Line banks (starter set)

Each surface has several variants. Rook picks one at random so he doesn't repeat himself. `{name}`, `{game}`, etc. are filled in at runtime. All lines follow the no-dash rule.

### Welcome (new member joins)
- "New player enters. Welcome, {name}. Pick your games below and I'll get you in the rotation."
- "{name} pulls up a chair. Good to have you. Grab the games you play and we'll sort you a channel."
- "Welcome to SideQuest, {name}. Tap the games you're here for. The rest of us will pretend we're not watching the leaderboard."
- "A new player at the table. Welcome, {name}. Choose your games and make your first move whenever you're ready."

### Game role granted (player picks a game)
- "You're in. {game} unlocked."
- "{game} it is. Channel's open, the board's waiting."
- "Good pick. {game} channel unlocked. Go make a play."
- "Welcome to the {game} table."
- "Done. {game}'s yours, channel and all."
- "{game} added. Your seat at that table is ready."
- "Locked in for {game}. Go find a match."
- "Say no more. {game} channel's open for you."

### Game role removed (player drops a game)
- "Stepping back from {game}. Your seat'll be here if you return."
- "{game} channel closed for you. No hard feelings."
- "Out of {game} for now. The door's open whenever."
- "{game} dropped. Come back anytime."

### Leaderboard post (daily / weekly standings)
- "This week's standings. The board doesn't lie 🏆"
- "Where things stand. Climb's open to anyone who wants it."
- "Current standings. Somebody's beatable up top, just saying."
- "The numbers are in. Well played, all of you."

### Win streak / milestone (a player is on a run)
- "{name}'s on a run. Somebody challenge them."
- "{name} just stacked another win. Streak's getting dangerous."
- "Watch out for {name}. They've clearly been practicing."
- "{count} in a row for {name}. The table's officially nervous."

### Achievement / activity role earned (SQ-activity milestone)
- "{name} earns {role}. Earned at the board, not handed over."
- "New rank for {name}: {role}. Put in the games to get there."
- "{role} unlocked, {name}. The standings noticed."

### Moderation — gentle (first nudge)
- "Let's keep it clean, folks. House rules."
- "Easy there. Let's keep the table friendly."
- "Trimming that one. Nothing personal, just keeping the room good."

### Moderation — firmer (repeat / clear violation)
- "That's a no. Knock it off, please."
- "Removed. The rules are pinned if you want a refresher."

### /help + DM auto-reply (card c223, shipped) — SQ Discord help surface
Rook is NO-LLM, so help is a structured command plus a canned DM reply, not chat. `{hub}` = the games hub URL, filled at runtime. Lines live in `messages.js` surfaces `help`, `helpWhereToPlay`, `dmAutoReply`.

**`help` — intro at the top of the /help card (what Rook does):**
- "I run the table around here. New players, game channels, the standings, the badges, and keeping the room friendly. That's me. Here's how to find your way around."
- "I'm the host of SideQuest. I sort your channels, keep the standings, track your play, and keep things civil. The commands below are how you reach me."
- "Think of me as the one running the table. Welcomes, channels, standings, badges, house rules. Everything I do, and how to use it, is right here."

**`helpWhereToPlay` — "Where to play" field on the /help card:**
- "The games live at {hub}. React in #game-picker to open a channel for each one you play."
- "Play over at {hub}, then pick your games in #game-picker and each one unlocks its own channel here."

**`dmAutoReply` — canned reply to any DM (Rook can't read free text), rate-limited:**
- "I don't read messages, I just run the table. Type /help anywhere for what I can do. The games live at {hub}, and the channels are where it all happens."
- "I can't chat, but I can point you the right way. Type /help for everything I do. Games are at {hub}, and the conversation's over in the channels."
- "Heads up, I don't answer DMs, I just keep the games running. Type /help for the full rundown. The games live at {hub} whenever you're ready to play."

---

## Tuning notes
- These are a starting bank. Add, cut, or rewrite freely once we see Rook in real channels.
- If a line ever reads mean, cut it. The floor for newcomers is "encouraging."
- Keep variants per surface to 3 to 5 so the file stays manageable and none feel stale.
