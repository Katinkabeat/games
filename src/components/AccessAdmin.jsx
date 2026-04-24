import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

export default function AccessAdmin({ userId }) {
  const [games, setGames] = useState([]);
  const [accessRows, setAccessRows] = useState([]);
  const [usernames, setUsernames] = useState({}); // user_id -> username
  const [loading, setLoading] = useState(true);

  const [searchByGame, setSearchByGame] = useState({}); // gameId -> term
  const [matchesByGame, setMatchesByGame] = useState({}); // gameId -> [{id, username}]
  const [busyKey, setBusyKey] = useState(null); // `${gameId}:${userId}` while writing

  async function load() {
    const [{ data: catalog, error: catErr }, { data: rows, error: rowsErr }] = await Promise.all([
      supabase.from('games_catalog').select('id, name, requires_access, is_published').order('sort_order'),
      supabase.from('user_game_access').select('user_id, game_id, status'),
    ]);
    if (catErr) toast.error(catErr.message);
    if (rowsErr) toast.error(rowsErr.message);

    const userIds = Array.from(new Set((rows || []).map((r) => r.user_id)));
    let nameMap = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', userIds);
      for (const p of profiles || []) nameMap[p.id] = p.username;
    }

    setGames(catalog || []);
    setAccessRows(rows || []);
    setUsernames(nameMap);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Debounced user search per game
  useEffect(() => {
    const timers = [];
    for (const [gameId, term] of Object.entries(searchByGame)) {
      const q = (term || '').trim();
      if (q.length < 2) {
        setMatchesByGame((prev) => ({ ...prev, [gameId]: [] }));
        continue;
      }
      const t = setTimeout(async () => {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username')
          .ilike('username', `%${q}%`)
          .order('username')
          .limit(8);
        if (error) {
          toast.error(error.message);
          return;
        }
        const allowedIds = new Set(
          accessRows.filter((r) => r.game_id === gameId && r.status === 'allowed').map((r) => r.user_id)
        );
        const enriched = (data || []).map((p) => ({ ...p, alreadyAllowed: allowedIds.has(p.id) }));
        setMatchesByGame((prev) => ({ ...prev, [gameId]: enriched }));
      }, 250);
      timers.push(t);
    }
    return () => { for (const t of timers) clearTimeout(t); };
  }, [searchByGame, accessRows]);

  async function addAllow(gameId, profile) {
    const key = `${gameId}:${profile.id}`;
    setBusyKey(key);
    const { error } = await supabase.from('user_game_access').upsert({
      user_id: profile.id,
      game_id: gameId,
      status: 'allowed',
      added_by: userId,
    }, { onConflict: 'user_id,game_id' });
    setBusyKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${profile.username} can now play ${gameId}`);
    setSearchByGame((prev) => ({ ...prev, [gameId]: '' }));
    setMatchesByGame((prev) => ({ ...prev, [gameId]: [] }));
    load();
  }

  async function removeAllow(gameId, targetUserId, username) {
    if (!window.confirm(`Remove ${username || 'this user'} from ${gameId}?`)) return;
    const { error } = await supabase
      .from('user_game_access')
      .delete()
      .eq('game_id', gameId)
      .eq('user_id', targetUserId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Removed');
    load();
  }

  return (
    <section className="card">
      <h3 className="font-display text-lg text-wordy-800 mb-1">Game access</h3>
      <p className="text-xs text-wordy-500 mb-4">
        Per-game allow lists. Only games with <em>requires_access</em> set are gated;
        the rest are open to all signed-in users.
      </p>

      {loading ? (
        <p className="text-sm text-wordy-500">Loading…</p>
      ) : games.length === 0 ? (
        <p className="text-sm text-wordy-500">No games in catalog yet.</p>
      ) : (
        <ul className="space-y-4">
          {games.map((game) => {
            const allowed = accessRows.filter((r) => r.game_id === game.id && r.status === 'allowed');
            const term = searchByGame[game.id] || '';
            const matches = matchesByGame[game.id] || [];

            return (
              <li key={game.id} className="rounded-lg bg-wordy-50 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm text-wordy-800 truncate">{game.name}</div>
                    <div className="text-xs text-wordy-500">
                      {game.requires_access ? '🔒 Gated' : '🔓 Open to everyone'}
                      {' · '}
                      {game.is_published ? 'published' : 'unpublished'}
                    </div>
                  </div>
                </div>

                {game.requires_access && (
                  <>
                    <div className="text-xs font-bold text-wordy-700 mb-1">Allowed users</div>
                    {allowed.length === 0 ? (
                      <p className="text-xs text-wordy-500 mb-2">Nobody yet — search below to add.</p>
                    ) : (
                      <ul className="space-y-1 mb-2">
                        {allowed.map((r) => (
                          <li
                            key={r.user_id}
                            className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white text-sm"
                          >
                            <span className="font-bold text-wordy-700 truncate">
                              {usernames[r.user_id] || '(unknown)'}
                            </span>
                            <button
                              onClick={() => removeAllow(game.id, r.user_id, usernames[r.user_id])}
                              disabled={busyKey === `${game.id}:${r.user_id}`}
                              className="text-xs font-bold text-rose-500 hover:text-rose-700 shrink-0"
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="relative">
                      <input
                        type="text"
                        value={term}
                        onChange={(e) =>
                          setSearchByGame((prev) => ({ ...prev, [game.id]: e.target.value }))
                        }
                        placeholder="Search by username…"
                        className="w-full px-2 py-1 border-2 border-wordy-200 rounded-lg focus:border-wordy-400 focus:outline-none text-sm"
                      />
                      {term.trim().length >= 2 && matches.length > 0 && (
                        <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-purple-100 rounded-lg shadow-lg z-10 max-h-44 overflow-y-auto">
                          {matches.map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                disabled={p.alreadyAllowed || busyKey === `${game.id}:${p.id}`}
                                onClick={() => !p.alreadyAllowed && addAllow(game.id, p)}
                                className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-wordy-50 text-sm disabled:hover:bg-transparent"
                              >
                                <span className={`font-bold truncate ${p.alreadyAllowed ? 'text-wordy-400' : 'text-wordy-700'}`}>
                                  {p.username}
                                </span>
                                <span className="text-xs text-wordy-500 shrink-0">
                                  {busyKey === `${game.id}:${p.id}` ? '…' : p.alreadyAllowed ? 'Already in' : 'Add →'}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
