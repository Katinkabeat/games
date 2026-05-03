import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

const SHOW_LIMIT = 10;

const GAMES = [
  { key: 'wordy',   label: 'Wordy',   rpc: 'admin_list_closed_games',     timeField: 'finished_at'  },
  { key: 'rungles', label: 'Rungles', rpc: 'rg_admin_list_closed_games',  timeField: 'finished_at'  },
  { key: 'snibble', label: 'Snibble', rpc: 'sn_admin_list_closed_matches', timeField: 'completed_at' },
];

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (days  > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins  > 0) return `${mins}m ago`;
  return 'just now';
}

export default function ClosedGamesAdmin() {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all(
      GAMES.map(async (g) => {
        const { data, error } = await supabase.rpc(g.rpc, { p_limit: SHOW_LIMIT });
        if (error) {
          console.error(`${g.rpc} failed:`, error);
          return [];
        }
        return (data ?? []).map((row) => ({
          gameKey:   g.key,
          gameLabel: g.label,
          id:        row.id,
          closedAt:  row[g.timeField],
          reason:    row.close_reason,
          closedBy:  row.closed_by_name,
          players:   row.player_names ?? [
            row.creator_name,
            row.opponent_name,
          ].filter(Boolean),
        }));
      })
    );
    const merged = results
      .flat()
      .filter((r) => r.closedAt)
      .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
      .slice(0, SHOW_LIMIT);
    setItems(merged);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg text-wordy-800">Recently Closed Games</h3>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs font-bold text-wordy-500 hover:text-wordy-700 disabled:opacity-50"
        >
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>
      <p className="text-xs text-wordy-500 mb-3">
        Last {SHOW_LIMIT} games closed by an admin across all SQ games. For older
        records, query the database directly.
      </p>

      {loading ? (
        <p className="text-sm text-wordy-500 italic">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-wordy-500 italic">No closed games yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={`${it.gameKey}:${it.id}`}
              className="rounded-xl px-3 py-2.5 bg-wordy-50 border border-wordy-100"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-bold uppercase tracking-wide text-wordy-600">
                  {it.gameLabel}
                </span>
                <span className="text-xs text-wordy-400">{timeAgo(it.closedAt)}</span>
              </div>
              <div className="text-sm font-bold text-wordy-700 truncate">
                {it.players.length > 0 ? it.players.join(' · ') : '(no players)'}
              </div>
              <div className="text-xs text-wordy-600 mt-1">
                <span className="font-bold">Closed by:</span> {it.closedBy ?? '(unknown)'}
              </div>
              <div className="text-xs text-wordy-600 mt-0.5">
                <span className="font-bold">Reason:</span> {it.reason ?? '(none)'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
