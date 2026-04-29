// Board sub-header — sits beneath the SQLobbyHeader on game pages.
// Not a banner: no bg, no border, no shadow — just an inline row that
// inherits the page gradient. Back link left, board-context status
// center, optional badges right.
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
    <div
      className={`px-4 py-1.5 flex items-center gap-3 ${className}`.trim()}
    >
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
  );
}
