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
// Layout note (2026-05-06): Shell is CSS Grid, not flex-col. Firefox has
// a known bug where `position: sticky` children inside a flex container
// aren't subtracted from flex layout (Mozilla bugs 1488080, 946235), so
// the main row would grow into the sticky action bar's space — board
// overflowed behind the action bar on Firefox Android even though Chrome
// handled it fine. Grid gives each child an explicit row, so the action
// bar's height is always reserved.
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
        className={`min-h-screen min-h-dvh grid grid-rows-[auto_minmax(0,1fr)_auto] bg-gradient-to-br from-wordy-50 to-pink-50 dark:bg-[#0f0a1e] dark:bg-none ${className}`.trim()}
      >
        {header}
        <div className="min-h-0 flex flex-col max-w-[480px] mx-auto w-full">
          {subHeader}
          <div className="flex-1 min-h-0 flex flex-col px-4 pb-3">
            {children}
          </div>
        </div>
        {actionBar ? (
          <div className="sticky bottom-0 z-20 bg-white dark:bg-[#1a1130] border-t border-purple-100 dark:border-[#2d1b55]">
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
      className={`min-h-screen min-h-dvh grid grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-gradient-to-br from-wordy-50 to-pink-50 dark:bg-[#0f0a1e] dark:bg-none ${className}`.trim()}
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
        <div className="sticky bottom-0 z-20 bg-white dark:bg-[#1a1130] border-t border-purple-100 dark:border-[#2d1b55]">
          {actionBar}
        </div>
      ) : null}
    </div>
  );
}
