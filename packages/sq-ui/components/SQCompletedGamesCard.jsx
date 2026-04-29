// Completed Games card — every SideQuest game lobby ships with one.
// Owns the standard heading and empty state; children are the per-game
// finished-game rows (whose content varies by game).
//
// Solo games can rebadge the title (e.g. "🏁 Past Sanctuaries" for
// Snibble) but the card structure stays the same.
// Style spec: ../../../docs/sq-style-spec.md §3, §5

import SQCard from './SQCard.jsx';

export default function SQCompletedGamesCard({
  title = '🏁 Completed Games',
  emptyMessage = 'Past games will appear here.',
  children,
}) {
  const hasContent =
    Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <SQCard>
      <h2 className="font-display text-xl text-wordy-700 mb-3">{title}</h2>
      {hasContent ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <p className="text-sm opacity-70">{emptyMessage}</p>
      )}
    </SQCard>
  );
}
