import { SQCompletedGamesCard } from '../../../../rae-side-quest/packages/sq-ui'

// Bottom lobby card — last 10 completed games (most recent first). Always
// renders so users have a consistent place to find old games even when
// nothing's recent. Each row is dismissable; once dismissed it shouldn't
// reappear in the list (data layer's job, not UI's).
//
// TODO wire up:
//   - games array (last 10 non-dismissed finished games for the current user).
//     Each item should expose `headline` + optional `subtitle`. Compute
//     the headline in the data layer using all four branches; never fall
//     back to "highest score wins" because that mislabels admin-closed
//     games and ties.
//
//     Canonical 4-branch headline (replace the field names with your
//     game's columns):
//
//       const headline = g.closed_by_admin
//         ? '🛑 Game closed by admin'
//         : g.forfeit_user_id
//           ? `🏳️ ${forfeiterName} forfeited — ${winnerName} wins!`
//           : g.winner_id
//             ? `🏆 ${winnerName} wins!`
//             : "🤝 It's a tie!"
//
//   - onDismiss(gameId) — flip the dismissed flag in the DB
//   - onView(gameId) — navigate to the game's final-board view
const MAX_RENDERED = 10

export default function CompletedGamesSection({
  games = [],
  onDismiss,
  onView,
}) {
  const visible = games.slice(0, MAX_RENDERED)

  return (
    <SQCompletedGamesCard>
      {visible.length === 0 ? (
        <p className="text-sm opacity-60 text-center py-2">
          No finished games yet.
        </p>
      ) : (
        visible.map((g) => (
          <div
            key={g.id}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 bg-gradient-to-r from-purple-100 to-pink-50 border border-purple-200 dark:from-purple-900/40 dark:to-purple-900/30 dark:border-purple-700"
          >
            <button
              type="button"
              onClick={() => onView?.(g.id)}
              className="flex-1 min-w-0 text-left"
            >
              <div className="font-display text-sm truncate">
                {g.headline ?? '🏆 Game finished'}
              </div>
              {g.subtitle && (
                <div className="text-xs opacity-70 truncate">{g.subtitle}</div>
              )}
            </button>
            <button
              type="button"
              onClick={() => onDismiss?.(g.id)}
              className="text-xs opacity-60 hover:opacity-100 px-2"
              aria-label="Dismiss"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        ))
      )}
    </SQCompletedGamesCard>
  )
}
