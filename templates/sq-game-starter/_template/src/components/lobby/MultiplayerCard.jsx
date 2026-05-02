// Middle lobby card — multiplayer entry point: Create button, list of open
// joinable games, list of the player's active games. Empty state is plain
// text (no big bubble emoji per SQ convention).
//
// TODO wire up:
//   - handleCreate -> insert a new game row, navigate to /multi/:id
//   - openGames    -> fetched + realtime-subscribed list of joinable games
//   - myGames      -> fetched + realtime-subscribed list of the user's active games
export default function MultiplayerCard({
  openGames = [],
  myGames = [],
  onCreate,
  creating = false,
  onEnterGame,
}) {
  const hasAny = openGames.length > 0 || myGames.length > 0

  return (
    <section className="card">
      <h2 className="font-display text-xl mb-1">🎮 Multiplayer</h2>
      <p className="text-sm opacity-80 mb-3">
        Create a game or jump into an open one.
      </p>
      <button
        type="button"
        className="btn-primary mb-4"
        onClick={onCreate}
        disabled={creating}
      >
        {creating ? '⏳ Creating…' : '✨ Create game'}
      </button>

      {hasAny ? (
        <div className="space-y-2">
          {openGames.map((g) => (
            <button
              key={g.id}
              type="button"
              className="w-full text-left rounded-xl border border-purple-200 dark:border-[#2d1b55] px-3 py-2 hover:bg-purple-50 dark:hover:bg-[#1a1130]"
              onClick={() => onEnterGame?.(g.id)}
            >
              <div className="text-sm font-bold">Open game</div>
              <div className="text-xs opacity-70">Tap to join</div>
            </button>
          ))}
          {myGames.map((g) => (
            <button
              key={g.id}
              type="button"
              className="w-full text-left rounded-xl border border-purple-200 dark:border-[#2d1b55] px-3 py-2 hover:bg-purple-50 dark:hover:bg-[#1a1130]"
              onClick={() => onEnterGame?.(g.id)}
            >
              <div className="text-sm font-bold">Your game</div>
              <div className="text-xs opacity-70">Tap to resume</div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm opacity-60 text-center py-2">
          No open games yet — create one!
        </p>
      )}
    </section>
  )
}
