# SideQuest style spec

The visual source of truth for every SideQuest game (Wordy, Rungles,
Snibble, and any future game). Strict uniformity: every game uses the
same palette, fonts, shadows, shells, and primitives in both light and
dark mode. Per-game variation lives in *content*, not chrome.

For behavioral conventions (nudge feature, push notifications, admin
gating, multiplayer lobby rows, deploy workflow), see
[`sq-conventions.md`](./sq-conventions.md).

Reference implementation: **Wordy**. When this doc and Wordy disagree,
Wordy wins and this doc gets updated.

Last updated: 2026-04-28

---

## 1. Scope

This spec covers two of the three SideQuest page archetypes:

- **Lobby** — the per-game landing page (start a game, see active games,
  open settings). Every game has one.
- **Board** — the per-game play surface. Every game has one.

The third archetype, the **hub**, is `rae-side-quest/` itself — the
single landing page that lists all games. The hub follows this spec
visually but is a one-of-a-kind page and is not part of the template.

---

## 2. Design tokens

### Colors — purple/pink, no per-game variation

Defined in `tailwind.config.js` under `theme.extend.colors.wordy`:

| Step | Hex       | Use                                            |
|------|-----------|------------------------------------------------|
| 50   | `#faf5ff` | Page background (light mode)                   |
| 100  | `#f3e8ff` | Light surface, scrollbar track                 |
| 200  | `#e9d5ff` | Tile gradient stop, card border (light)        |
| 300  | `#d8b4fe` | Tile gradient stop                             |
| 400  | `#c084fc` | Tile border, secondary button border           |
| 500  | `#a855f7` | Mid accent                                     |
| 600  | `#9333ea` | Primary button gradient start                  |
| 700  | `#7e22ce` | Primary button gradient end, display text      |
| 800  | `#6b21a8` | Deep accent                                    |
| 900  | `#581c87` | Tile shadow, deepest accent                    |

**Pink accents** (selection / "active you" states):

- `#f472b6` — selection ring on tiles, current-player chip
- `#fb7185` — exchange / swap mode tint
- `#ec4899` — center-cell / hot accent

**Status colors** (used sparingly):

- Success green: `#4ade80` (text), `#166534` (border, dark)
- Error rose: `#f87171` (text), `#7f1d1d` (border, dark)
- Warning yellow: `#fde68a` (text), `#92400e` (border, dark)

No game introduces its own brand color. Game-specific accents (e.g.
Snibble's craving banner) use the same purple+pink palette in both
light and dark mode.

### Dark mode palette

Dark mode is **first class**, not an afterthought. Most users play in
dark mode. Build dark mode at the same time as light mode, never
after.

| Token            | Hex       | Use                                              |
|------------------|-----------|--------------------------------------------------|
| Page bg          | `#0f0a1e` | Body, page background                            |
| Surface 1        | `#1a1130` | Cards, panels (one step above page)              |
| Surface 2        | `#241640` | Floating overlays — dropdowns, modals, popovers  |
| Border           | `#2d1b55` | Card borders, dividers                           |
| Border (raised)  | `#6d28d9` | Floating overlay borders, dropdown edges         |
| Tile gradient    | `#2d1b55 → #1e1040` | Tile body                              |
| Tile border      | `#7c3aed` | Tile edge                                        |
| Text primary     | `#ede0ff` | Body text                                        |
| Text muted       | `#c4b5fd` | Secondary text, button labels                    |
| Header bg        | `#130c25` | Sticky header (slightly darker than page)        |

**Floating overlays** (dropdowns, popovers, modals) sit at Surface 2
(`#241640`) with a Border (raised) (`#6d28d9`) edge. This is what
makes them read as "above" the page rather than blending in.

**The `via-stop` gotcha**: Tailwind's `via-pink-50` etc. hardcode the
literal hex into `--tw-gradient-stops` and don't respect dark-mode
overrides. Any wrapper using `via-*` must add `dark:bg-[#0f0a1e]
dark:bg-none` to flatten the gradient in dark mode.

**The `!important` override gotcha**: `index.css` has rules like
`.dark .bg-white { #1a1130 !important }` that clobber arbitrary
`dark:bg-[…]` classes. Bypass with arbitrary classes for *both*
modes:

```jsx
// won't override in dark mode
className="bg-white dark:bg-[#241640]"
// works
className="bg-[#fff] dark:bg-[#241640]"
```

For card-based dropdowns, prefer the marker class `dropdown-surface`
and rely on the `.dark .dropdown-surface` rule.

### Typography

Two fonts, loaded from Google Fonts in `index.html`:

- **`font-display`** — Fredoka One (one weight). Used for: page titles,
  section headings, board player names, live scores, modal headings.
- **`font-body`** — Nunito, weights 400/500/600/700/800. Used for:
  everything else.

**Hierarchy:**

| Use                      | Class                                  |
|--------------------------|----------------------------------------|
| Lobby page title         | `font-display text-2xl text-wordy-700` |
| Board turn status        | `font-display text-base`               |
| Section heading          | `font-display text-lg`                 |
| Modal heading            | `font-display text-lg`                 |
| Button label             | `font-body font-bold text-sm`          |
| Body text                | `font-body text-sm`                    |
| Metadata / sub-text      | `font-body text-xs`                    |
| Tile letter              | `font-body font-bold` (size dynamic)   |
| Tile value               | `text-[9px]`                           |

### Shadows

Purple-tinted, never black. Three roles:

- **Tile rest**: `2px 3px 0px rgba(88,28,135,0.4)` — Tailwind `shadow-tile`
- **Tile hover**: `3px 4px 0px rgba(88,28,135,0.5)` — Tailwind `shadow-tile-hover`
- **Button shadow**: `0 3px 0 #581c87` (primary), `0 3px 0 #9f1239` (danger).
  Active state collapses with `translateY(2px)`.
- **Card shadow**: `shadow-md` (Tailwind default) in light, none in dark
  (rely on Surface 1 vs Page bg contrast).

In dark mode tiles use **inset glow** instead of drop shadow, so they
stay visible against the dark page.

### Radii

- `rounded-2xl` — cards, modals, overlays
- `rounded-xl` — buttons, chips, action bar items
- `rounded-lg` — tiles
- `rounded-full` — avatar circles, status dots

### Spacing

- Card internal: `p-4`
- Row internal: `px-3 py-2` or `px-4 py-2.5`
- Button internal: `py-2 px-4`
- Card gap inside main: `space-y-6`
- Flex gap between controls: `gap-3` (default), `gap-2`, `gap-1.5`

### Gradient direction

All gradients use **135deg** (buttons) or **145deg** (tiles). Never
horizontal, never vertical, never a custom angle.

---

## 3. Layout archetypes

### Lobby layout

Used by every game's landing page. **Mobile column, max-w-480px.**

```
┌────────────────────────────────────────┐  ← sticky lobby header
│ [avatar] Game Name           🏠  ⚙️    │
├────────────────────────────────────────┤
│                                        │
│  ┌──────────────────────────────────┐  │  ← card 1: New Game
│  │ 🌸 New Game                      │  │
│  │ [player count selector]          │  │
│  │ [Create button — btn-primary]    │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │  ← card 2: Active Games
│  │ 🎮 Multiplayer                   │  │     (or solo continue)
│  │ • game row 1                     │  │
│  │ • game row 2                     │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │  ← card 3: Completed
│  │ 🏁 Completed Games               │  │
│  │ • result row 1                   │  │
│  └──────────────────────────────────┘  │
│                                        │
└────────────────────────────────────────┘
```

- **Container**: `max-w-[480px] mx-auto px-4 py-6 space-y-6`
- **Background**: `bg-gradient-to-br from-wordy-50 via-pink-50 to-wordy-100 dark:bg-[#0f0a1e] dark:bg-none`
- **Sections are cards** (`.card` class). Headings use emoji prefix and
  `font-display text-lg`.
- **Empty states** live inside the relevant card, never as a standalone
  full-page state.

Every SideQuest lobby renders these cards, in order:

1. `installPrompt` — optional iOS install banner
2. `newGame` — required, the start/create card
3. `activeGames` — required, in-progress games (solo continue or
   multiplayer list)
4. **`completedGames` — required, uses `<SQCompletedGamesCard>`.** Every
   game ships with this card from day one, even solo games (Snibble can
   relabel it "🏁 Past Sanctuaries" or similar but the structure stays).
   See §5 for the component.
5. `extras` — anything else (rare; prefer adding more cards)

### Board layout

Used by every game's play surface. **Wider on desktop (max-w-6xl), full
width on mobile.**

```
┌────────────────────────────────────────────────────┐  ← board header (not sticky)
│ ← Lobby      ✨ Your turn!         🏠  🎒 N  ⚙️   │
├────────────────────────────────────────────────────┤
│                                                    │
│   ┌────────┐  ┌──────────────────┐  ┌────────┐    │
│   │ Score  │  │                  │  │spacer  │    │
│   │ panel  │  │   Play area      │  │(desktop│    │
│   │(desktop│  │  (board, etc.)   │  │ only)  │    │
│   │ only)  │  │                  │  │        │    │
│   └────────┘  └──────────────────┘  └────────┘    │
│                                                    │
├────────────────────────────────────────────────────┤  ← sticky bottom bar
│ [tile rack / control row]                          │
│ [shuffle]                       [score badge]      │
│ [Submit] [Recall] [Swap] [Pass]                    │
└────────────────────────────────────────────────────┘
```

- **Container**: `flex-1 flex flex-col lg:flex-row gap-3 max-w-6xl mx-auto w-full px-1 py-3 lg:p-3`
- **Background**: `bg-gradient-to-br from-wordy-50 to-pink-50 dark:bg-[#0f0a1e] dark:bg-none`
- **Score panel** (left): `lg:w-56 shrink-0`, hidden on mobile.
- **Right spacer**: invisible div mirroring the score panel width, so
  the play area centers visually.
- **Sticky bottom bar**: `sticky bottom-0 z-20 bg-white dark:bg-[#1a1130] border-t`
- **Modals** (`fixed inset-0 bg-black/40 flex items-center justify-center z-50`)
  with a `.card` inside.

The shell exposes slots:

1. `header` — required, board header component
2. `scorePanel` — optional, desktop-only sidebar
3. `playArea` — required, the game's actual surface
4. `actionBar` — required, sticky bottom controls
5. `modals` — optional, overlays

---

## 4. Two header components

Both headers share the same styling foundation (sticky-ish, white/dark
bg, border-b, shadow-sm, gap-3 right controls) but differ in slots,
density, and width. They are **separate components** sharing tokens,
not one configurable header.

**Lobby pages use one header** (`<SQLobbyHeader>`).
**Board pages stack both** — `<SQLobbyHeader>` on top for app-level
identity (avatar, game title, 🏠, ⚙️), `<SQBoardHeader>` directly
below for board context (back-to-lobby, turn status, game-specific
badges like Wordy's bag count). This means the user always has avatar
and settings access, even mid-game, and the back-to-lobby link sits
near the gameplay status it relates to.

### `<SQLobbyHeader>`

Used on every lobby page. Wider chrome, identity-forward.

```
[avatar]  Game Name                            🏠  ⚙️
```

- **Container**: `sticky top-0 bg-white dark:bg-[#130c25] border-b border-purple-100 dark:border-[#2d1b55] shadow-sm`
- **Inner**: `max-w-[480px] mx-auto px-4 py-3 flex items-center gap-3`
- **Left**: `<AvatarMenu>` (avatar circle, opens identity dropdown)
  + game title (`font-display text-2xl text-wordy-700 dark:text-wordy-300`)
- **Center**: empty
- **Right**: 🏠 link to `/games/` (back to hub) + ⚙️ cog button (settings dropdown)
- **No game logo glyph** — the avatar is the identity anchor.

### `<SQBoardHeader>`

Sits beneath `<SQLobbyHeader>` on every board page as a plain inline
row — **not** a banner. No bg, no border, no shadow. Inherits the
page gradient from the shell.

```
← Lobby      ✨ Your turn!                                🎒 N
```

- **Container**: `max-w-6xl mx-auto px-4 py-3 flex items-center gap-3`
  (no banner styling — that's the lobby header above's job)
- **Left**: back link `← Lobby` (`text-wordy-400 hover:text-wordy-700 font-bold text-sm`)
- **Center**: turn-status / game-state slot, `font-display text-base`,
  color shifts on `myTurn`
- **Right**: optional game-specific badge (Wordy: `🎒 N left`).
  No 🏠 / ⚙️ here — those live in the lobby header above.

Differences at a glance:

| Aspect           | Lobby header                | Board header                |
|------------------|------------------------------|-----------------------------|
| Width            | `max-w-[480px]`              | `max-w-6xl`                 |
| Sticky           | Yes                          | No                          |
| Identity         | Avatar + game title          | Back link to lobby          |
| Center slot      | Empty                        | Turn status                 |
| Right side       | 🏠 + ⚙️                       | 🏠 + game badge + ⚙️         |
| Vertical padding | `py-3`                       | `py-2`                      |

---

## 5. Component primitives

These ship from the shared `sq-ui` package (see §7) and every game uses
them as-is.

### `<SQCard>`

The default container for every section on lobby/board pages.

- Light: `bg-white border border-purple-100 rounded-2xl shadow-md p-4`
- Dark: `bg-[#1a1130] border border-[#2d1b55]` (no shadow)

### `<SQButton>`

Three primary variants:

- **`variant="primary"`**: Gradient `135deg #9333ea → #7e22ce`, white text,
  `shadow 0 3px 0 #581c87`, active `translateY(2px)`. CTAs.
- **`variant="secondary"`**: White bg / `border-2 border-purple-400` /
  purple text. Cancel, Recall, Keep Playing.
- **`variant="danger"`**: Rose-500 bg, `shadow 0 3px 0 #9f1239`. Forfeit, Logout.

Plus an **icon variant** for compact action-bar buttons (Submit / Recall
/ Swap / Pass): `min-width 56px`, `height 40px`, emoji 15px, label 9px,
flex-column.

All buttons: `py-2 px-4 rounded-xl font-bold`, `disabled:opacity-60`.

### `<SQTile>`

The shared "letter tile" primitive. Even games that don't use letter
tiles (Snibble, future games) should use this for any tile-shaped UI
to keep the family look.

- **Default**: gradient `145deg #f3e8ff → #e9d5ff`, `border 1.5px solid
  #c084fc`, `shadow-tile`, dark mode uses inset glow
- **Selected**: `ring-2 ring-pink-400`, `translateY(-3px)`,
  `shadow 0 0 0 3px #f472b6`
- **Placed / committed**: gradient `145deg #e9d5ff → #d8b4fe`, reduced shadow
- **Disabled**: `opacity-50 cursor-default`
- **Value**: `absolute bottom-right text-[9px] text-wordy-700`

Sizes:

- Rack tile: `w-10 h-11 rounded-lg`
- Board tile: dynamic (cellSize 20–38px), letter `0.48 * cellSize`,
  value `0.26 * cellSize`

### `<SQCompletedGamesCard>`

Required on every game's lobby. Owns the standard heading ("🏁 Completed
Games") and empty-state message; the children are the per-game finished-
game rows (whose content varies — Wordy shows winner banners, Snibble
will show graduated critters, etc.). Solo games can override `title` and
`emptyMessage` but should keep the card present.

### `<SQModal>`

Every overlay (confirm dialog, blank-tile picker, forfeit prompt) uses
the same shape:

- **Backdrop**: `fixed inset-0 bg-black/40 flex items-center justify-center z-50`
- **Body**: `<SQCard>` with `bg-[#fff] dark:bg-[#241640]`,
  `border-[#e9d5ff] dark:border-[#6d28d9]`, `rounded-2xl shadow-xl`
- **Heading**: `font-display text-lg`
- **Actions**: pair of `<SQButton>` (secondary cancel + primary/danger confirm)
- Dismissable: backdrop click + Escape key

### `<SQDropdown>` / `<SQSettingsMenu>`

Used for avatar dropdown (identity) and cog dropdown (settings).

- **Surface**: marker class `dropdown-surface` so the global
  `.dark .dropdown-surface` rule applies. Light: white +
  `border-purple-100`. Dark: `#241640` + `border-[#6d28d9]`.
- **Width**: `w-64`
- **Animation**: `settings-slide 0.12s ease-out` (already defined in `index.css`)
- **Rows**: `flex items-center justify-between px-4 py-2.5 text-sm
  font-bold border-t first:border-t-0`
- **Logout row**: rose / danger color in both modes.

Content (avatar vs cog) is governed by [`sq-conventions.md`](./sq-conventions.md#avatar-dropdown).

### Toasts

Library: `react-hot-toast`. Position: `top-center`. Defaults:

- Light bg: `#f3e8ff` for success, pink for error, white for default.
- Dark bg: `#1a1130` with text `#ede0ff`, border on all.
- Font: Nunito, `border-radius: 12px`.
- Duration: 15s for game-end events, default for everything else.

Wired once in `<App>` via `<Toaster>` with the merged config — every game
should copy Wordy's `<Toaster>` block verbatim.

### Scrollbar

```css
::-webkit-scrollbar          { width: 6px; height: 6px; }
::-webkit-scrollbar-track    { background: #f3e8ff; border-radius: 3px; }
::-webkit-scrollbar-thumb    { background: #c084fc; border-radius: 3px; }
.dark ::-webkit-scrollbar-track { background: #1a1130; }
.dark ::-webkit-scrollbar-thumb { background: #6d28d9; }
```

---

## 6. Iconography

- **Section headings use emoji prefixes** (🌸 New Game, 🎮 Multiplayer,
  🏁 Completed, 📊 Stats, 🎒 Bag).
- **Header right side** uses 🏠 (back to hub) and ⚙️ (settings).
- **Avatar** = colored circle with initials (no icon).
- No icon library — emoji + text is the platform convention.

---

## 7. Where this lives (planned package: `sq-ui`)

These tokens and components currently live duplicated across each game.
The next phase of work is to extract them into a shared package.

Planned structure:

```
rae-side-quest/
└── packages/
    └── sq-ui/
        ├── tokens.css           ← CSS variables (colors, shadows, radii)
        ├── tailwind-preset.js   ← Tailwind preset (palette, fonts, shadows)
        ├── globals.css          ← .card, .btn-*, .tile, .dropdown-surface, scrollbar
        └── components/
            ├── SQLobbyHeader.jsx
            ├── SQBoardHeader.jsx
            ├── SQLobbyShell.jsx
            ├── SQBoardShell.jsx
            ├── SQCard.jsx
            ├── SQButton.jsx
            ├── SQTile.jsx
            ├── SQModal.jsx
            ├── SQDropdown.jsx
            └── SQSettingsMenu.jsx
```

Each game's `tailwind.config.js` does:

```js
presets: [require('sq-ui/tailwind-preset')]
```

…and imports `sq-ui/globals.css` once at app boot.

A `templates/sq-game-starter/` directory will scaffold a new game with:

- `/` route → `<SQLobbyShell>` with placeholder slots
- `/play` (or `/play/:id`) route → `<SQBoardShell>` with placeholder slots
- PWA + service worker + cache-bust wiring already done
- README listing the 3–4 things to fill in (game name, hub allowlist
  entry, gameplay)

Migration order once the package exists:

1. Wordy → adopt `sq-ui` (no visual change; proves extraction is faithful)
2. Rungles → adopt `sq-ui`
3. Snibble → adopt `sq-ui`
4. Hub (`rae-side-quest`) → adopt tokens (still bespoke layout)

---

## 8. Quick checklist when building a new SQ page

- [ ] Wraps in `<SQLobbyShell>` or `<SQBoardShell>`
- [ ] Uses `<SQLobbyHeader>` or `<SQBoardHeader>`
- [ ] All sections are `<SQCard>`s
- [ ] All buttons are `<SQButton>` (no raw `<button>` with custom classes)
- [ ] All overlays are `<SQModal>` or `<SQDropdown>` / `<SQSettingsMenu>`
- [ ] Dark mode verified — page bg `#0f0a1e`, cards `#1a1130`,
      overlays `#241640`
- [ ] No black shadows (purple-tinted only)
- [ ] No new brand colors — purple + pink only
- [ ] Section headings use emoji prefix and `font-display`
- [ ] Toaster mounted with the standard config
- [ ] Tested under `npm run dev:all` at localhost:8080
