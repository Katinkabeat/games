// Board page shell — wraps the standard SQ in-game chrome.
// Top banner header, optional inline sub-header above the play area,
// flexible play area in the middle, sticky action bar at the bottom.
// Wider container (max-w-6xl) on desktop.
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
      <div className="flex-1 flex flex-col lg:flex-row gap-3 max-w-6xl mx-auto w-full px-1 py-3 lg:p-3">
        {scorePanel ? (
          // Visible on both mobile (top bar via flex-col) and desktop (left
          // sidebar via lg:flex-row). Hiding on mobile would erase the score
          // strip players rely on at-a-glance.
          <aside className="lg:w-56 shrink-0">{scorePanel}</aside>
        ) : null}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Sub-header sits at the top of the play column so it spans the
              same width as the board (offset by the score sidebar on desktop,
              full width on mobile). */}
          {subHeader}
          <div className="flex-1 flex items-center justify-center">
            {children}
          </div>
        </div>
        {/* Invisible spacer mirrors the score panel width on desktop only so
            the play area centers visually. Hidden on mobile (no sidebar
            there to balance against). */}
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
