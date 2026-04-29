// Board page shell — wraps the standard SQ in-game chrome.
// Top banner header, optional inline sub-header (back link + status +
// game-specific badges), flexible play area, sticky action bar.
//
// subHeader placement is responsive:
//   - Mobile (flex-col): rendered above the score panel + board.
//   - Desktop (flex-row): rendered inside the play column, above the
//     board, so it tracks the board's left/right edges (offset from the
//     score sidebar).
// This is implemented with two render slots gated by Tailwind responsive
// classes so the same JSX appears in the right place at each breakpoint.
//
// Style spec: ../../../docs/sq-style-spec.md §3

export default function SQBoardShell({
  header,
  subHeader = null,
  scorePanel = null,
  actionBar = null,
  children,
  className = '',
}) {
  return (
    <div
      className={`min-h-screen flex flex-col bg-gradient-to-br from-wordy-50 to-pink-50 dark:bg-[#0f0a1e] dark:bg-none ${className}`.trim()}
    >
      {header}

      {/* Mobile sub-header: above the score strip + board. */}
      {subHeader ? (
        <div className="lg:hidden max-w-6xl mx-auto w-full">{subHeader}</div>
      ) : null}

      <div className="flex-1 flex flex-col lg:flex-row gap-3 max-w-6xl mx-auto w-full px-1 py-3 lg:p-3">
        {scorePanel ? (
          <aside className="lg:w-56 shrink-0">{scorePanel}</aside>
        ) : null}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Desktop sub-header: inside the play column so it spans the
              same width as the board (offset by the score sidebar). */}
          {subHeader ? (
            <div className="hidden lg:block">{subHeader}</div>
          ) : null}
          <div className="flex-1 flex items-center justify-center">
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
