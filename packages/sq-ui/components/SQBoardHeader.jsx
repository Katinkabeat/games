// Board header — used on every game's play surface.
// Not sticky, max-w-6xl, compact (back link left, status center, controls right).
// Style spec: ../../../docs/sq-style-spec.md §4
//
// Back action: pass `onBackClick` for SPA navigation (preferred), or `backHref`
// for plain link navigation. If both are provided, onBackClick wins and
// backHref becomes the link's href (so cmd-click / right-click still work).

export default function SQBoardHeader({
  backHref = '#',
  backLabel = '← Lobby',
  onBackClick,
  centerSlot = null,
  rightSlot = null,
  className = '',
}) {
  const handleBackClick = onBackClick
    ? (e) => { e.preventDefault(); onBackClick(e); }
    : undefined;

  return (
    <header
      className={`bg-[#fff] dark:bg-[#130c25] border-b border-[#e9d5ff] dark:border-[#2d1b55] shadow-sm ${className}`.trim()}
    >
      <div className="max-w-6xl mx-auto px-3 py-2 flex items-center gap-3">
        <a
          href={backHref}
          onClick={handleBackClick}
          className="text-wordy-400 hover:text-wordy-700 font-bold text-sm shrink-0"
        >
          {backLabel}
        </a>
        <div className="flex-1 min-w-0 text-center">{centerSlot}</div>
        <div className="flex items-center gap-3 shrink-0">{rightSlot}</div>
      </div>
    </header>
  );
}
