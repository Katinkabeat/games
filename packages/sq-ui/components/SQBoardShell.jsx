// Board page shell — wraps the standard SQ in-game chrome.
// Header on top, flexible play area in the middle, sticky action bar at
// the bottom. Wider container (max-w-6xl) on desktop.
// Style spec: ../../../docs/sq-style-spec.md §3

export default function SQBoardShell({
  header,
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
          <aside className="lg:w-56 shrink-0 hidden lg:block">{scorePanel}</aside>
        ) : null}
        <div className="flex-1 min-w-0 flex items-center justify-center">
          {children}
        </div>
        {/* Spacer mirrors the score panel width so the play area centers visually. */}
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
