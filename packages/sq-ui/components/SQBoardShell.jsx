// Board page shell — wraps the standard SQ in-game chrome.
// Top banner header, optional inline sub-header (back link + status +
// game-specific badges), flexible play area, sticky action bar.
//
// Two width modes:
//   width="wide"   (default) — Wordy's pattern. max-w-6xl, lg:flex-row
//                  with optional score sidebar + invisible spacer for
//                  visual centering. Use for games with a wide play
//                  surface (Scrabble board, etc.).
//   width="narrow" — Rungles / Snibble pattern. max-w-[480px], single
//                  column, no sidebar. Use for column-stacked games.
//
// subHeader placement is responsive (in wide mode only):
//   - Mobile (flex-col): rendered above the score panel + board.
//   - Desktop (flex-row): rendered inside the play column, above the
//     board, so it tracks the board's left/right edges.
// In narrow mode, subHeader always sits between top banner and content.
//
// Layout note (2026-05-06): Shell is CSS Grid (rows = header,
// optional sub-header, main 1fr, action bar), height EXACTLY h-dvh
// (not min-h-dvh) with overflow hidden so the grid can't grow past
// the viewport and push the action bar off-screen. Action bar is
// plain `position: static` (not sticky). Firefox has a known bug
// (Mozilla 1585254) where `position: sticky bottom: 0` inside flex
// OR grid containers hides content / fails to reserve space — grid
// rows give us the bottom-pinned action bar without needing sticky
// at all. The board is sized to the measured main-row height by
// GamePage's ResizeObserver, so the board never overflows it.
//
// Style spec: ../../../docs/sq-style-spec.md §3

export default function SQBoardShell({
  header,
  subHeader = null,
  scorePanel = null,
  actionBar = null,
  width = 'wide',
  children,
  className = '',
}) {
  const isNarrow = width === 'narrow';

  if (isNarrow) {
    // Narrow column layout — no sidebar, no responsive sub-header
    // duplication. Sub-header sits flush with the max-w-[480px] container
    // so its own px-4 aligns with the avatar/cog above (matches Wordy's
    // wide-mode alignment). Children get their own px-4 inset.
    return (
      <div
        className={`h-screen h-dvh overflow-hidden grid grid-rows-[auto_minmax(0,1fr)_auto] bg-gradient-to-br from-wordy-50 to-pink-50 dark:bg-[#0f0a1e] dark:bg-none ${className}`.trim()}
      >
        {header}
        <div className="min-h-0 flex flex-col max-w-[480px] mx-auto w-full">
          {subHeader}
          <div className="flex-1 min-h-0 flex flex-col px-4 pb-3">
            {children}
          </div>
        </div>
        {actionBar ? (
          <div className="z-20 bg-white dark:bg-[#1a1130] border-t border-purple-100 dark:border-[#2d1b55]">
            {actionBar}
          </div>
        ) : null}
      </div>
    );
  }

  // Wide layout — Wordy's pattern. max-w-6xl with optional score sidebar.
  // 4 grid rows: header, mobile sub-header (always rendered, may be empty —
  // empty divs collapse to 0 in `auto`), main content, action bar.
  return (
    <div
      className={`h-screen h-dvh overflow-hidden grid grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-gradient-to-br from-wordy-50 to-pink-50 dark:bg-[#0f0a1e] dark:bg-none ${className}`.trim()}
    >
      {header}

      {/* Mobile sub-header: above the score strip + board. Always
          rendered as a grid-row placeholder so the row count stays
          consistent; collapses to 0 when subHeader is null. */}
      <div className="lg:hidden max-w-6xl mx-auto w-full">
        {subHeader}
      </div>

      <div className="min-h-0 flex flex-col lg:flex-row gap-2 lg:gap-3 max-w-6xl mx-auto w-full px-1 py-2 lg:p-3">
        {scorePanel ? (
          <aside className="lg:w-56 shrink-0">{scorePanel}</aside>
        ) : null}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {/* Desktop sub-header: inside the play column. */}
          {subHeader ? (
            <div className="hidden lg:block">{subHeader}</div>
          ) : null}
          <div className="flex-1 min-h-0 flex items-center justify-center">
            {children}
          </div>
        </div>
        {scorePanel ? (
          <div className="lg:w-56 shrink-0 hidden lg:block" aria-hidden="true" />
        ) : null}
      </div>

      {actionBar ? (
        <div className="z-20 bg-white dark:bg-[#1a1130] border-t border-purple-100 dark:border-[#2d1b55]">
          {actionBar}
        </div>
      ) : null}
    </div>
  );
}
