import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

export default function FriendsView({ userId, onBack }) {
  const [rows, setRows] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [usernames, setUsernames] = useState({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);
  const [busyKey, setBusyKey] = useState(null);

  async function load() {
    const [friendsResp, blocksResp] = await Promise.all([
      supabase.from('friendships').select('user_a, user_b, status, requested_by, created_at'),
      supabase.from('user_blocks').select('blocked, created_at'),
    ]);
    if (friendsResp.error) {
      toast.error(friendsResp.error.message);
      setLoading(false);
      return;
    }

    const otherIds = new Set();
    for (const r of friendsResp.data || []) {
      otherIds.add(r.user_a === userId ? r.user_b : r.user_a);
    }
    for (const b of blocksResp.data || []) {
      otherIds.add(b.blocked);
    }

    let nameMap = {};
    if (otherIds.size > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', Array.from(otherIds));
      for (const p of profiles || []) nameMap[p.id] = p.username;
    }

    setRows(friendsResp.data || []);
    setBlocks(blocksResp.data || []);
    setUsernames(nameMap);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username')
        .ilike('username', `%${q}%`)
        .neq('id', userId)
        .order('username')
        .limit(10);
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        return;
      }
      const friendIds = new Set(rows.map((r) => (r.user_a === userId ? r.user_b : r.user_a)));
      const blockedIds = new Set(blocks.map((b) => b.blocked));
      setMatches((data || [])
        .filter((p) => !blockedIds.has(p.id))
        .map((p) => ({ ...p, alreadyConnected: friendIds.has(p.id) })));
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, rows, userId]);

  function otherIdOf(row) {
    return row.user_a === userId ? row.user_b : row.user_a;
  }

  async function sendRequest(profile) {
    setBusyKey(`req:${profile.id}`);
    const { error } = await supabase.rpc('request_friendship', { target_user: profile.id });
    setBusyKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Request sent to ${profile.username}`);
    setSearch('');
    setMatches([]);
    load();
  }

  async function acceptRequest(otherId, otherName) {
    setBusyKey(`acc:${otherId}`);
    const { error } = await supabase.rpc('accept_friendship', { other_user: otherId });
    setBusyKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Now friends with ${otherName || 'this user'}`);
    load();
  }

  async function removeRow(otherId, otherName, action) {
    const verb = action === 'cancel' ? 'Cancel request to' : action === 'decline' ? 'Decline request from' : 'Remove';
    if (!window.confirm(`${verb} ${otherName || 'this user'}?`)) return;
    setBusyKey(`rem:${otherId}`);
    const { error } = await supabase.rpc('remove_friendship', { other_user: otherId });
    setBusyKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(action === 'cancel' ? 'Cancelled' : action === 'decline' ? 'Declined' : 'Removed');
    load();
  }

  async function blockUser(otherId, otherName) {
    if (!window.confirm(`Block ${otherName || 'this user'}? This removes any friendship and hides them from your search.`)) return;
    setBusyKey(`blk:${otherId}`);
    // Remove friendship first (silent if no row exists), then block.
    await supabase.rpc('remove_friendship', { other_user: otherId });
    const { error } = await supabase.rpc('block_user', { target: otherId });
    setBusyKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${otherName || 'User'} blocked`);
    load();
  }

  async function unblockUser(otherId, otherName) {
    setBusyKey(`unb:${otherId}`);
    const { error } = await supabase.rpc('unblock_user', { target: otherId });
    setBusyKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${otherName || 'User'} unblocked`);
    load();
  }

  async function reportUser(otherId, otherName) {
    const reason = window.prompt(`Report ${otherName || 'this user'}?\n\nDescribe what's wrong (admins will review):`);
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error('Reason cannot be empty');
      return;
    }
    setBusyKey(`rpt:${otherId}`);
    const { error } = await supabase.rpc('submit_report', {
      reported_user: otherId,
      game: 'sidequest',
      reason: reason.trim(),
    });
    setBusyKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Report submitted — thanks for letting us know');
  }

  const incoming = rows.filter((r) => r.status === 'pending' && r.requested_by !== userId);
  const outgoing = rows.filter((r) => r.status === 'pending' && r.requested_by === userId);
  const friends = rows.filter((r) => r.status === 'accepted');

  return (
    <main className="max-w-3xl mx-auto px-4 pb-12 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-wordy-800">Friends</h2>
        <button onClick={onBack} className="btn-secondary text-sm px-3 py-1.5">← Back</button>
      </div>

      <section className="card">
        <h3 className="font-display text-lg text-wordy-800 mb-2">Add a friend</h3>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by username…"
            className="w-full px-3 py-2 border-2 border-wordy-200 rounded-xl focus:border-wordy-400 focus:outline-none text-sm"
          />
          {search.trim().length >= 2 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-purple-100 rounded-xl shadow-lg z-10 max-h-60 overflow-y-auto">
              {matches.length === 0 ? (
                <p className="px-3 py-2 text-sm text-wordy-500">No users found</p>
              ) : (
                <ul>
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={p.alreadyConnected || busyKey === `req:${p.id}`}
                        onClick={() => !p.alreadyConnected && sendRequest(p)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-wordy-50 text-sm disabled:hover:bg-transparent"
                      >
                        <span className={`font-bold truncate ${p.alreadyConnected ? 'text-wordy-400' : 'text-wordy-700'}`}>
                          {p.username}
                        </span>
                        <span className="text-xs text-wordy-500 shrink-0">
                          {busyKey === `req:${p.id}` ? '…' : p.alreadyConnected ? 'Already connected' : 'Send request →'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      {incoming.length > 0 && (
        <section className="card">
          <h3 className="font-display text-lg text-wordy-800 mb-2">
            Pending requests <span className="text-sm font-normal text-wordy-500">({incoming.length})</span>
          </h3>
          <ul className="space-y-1.5">
            {incoming.map((r) => {
              const otherId = otherIdOf(r);
              const otherName = usernames[otherId] || '(unknown)';
              return (
                <li key={otherId} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-wordy-50 text-sm">
                  <span className="font-bold text-wordy-700 truncate">{otherName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => acceptRequest(otherId, otherName)}
                      disabled={busyKey === `acc:${otherId}`}
                      className="text-xs font-bold text-white bg-wordy-600 px-2 py-1 rounded-lg hover:bg-wordy-500 disabled:opacity-60"
                    >
                      {busyKey === `acc:${otherId}` ? '…' : 'Accept'}
                    </button>
                    <button
                      onClick={() => removeRow(otherId, otherName, 'decline')}
                      className="text-xs font-bold text-rose-500 hover:text-rose-700"
                    >
                      Decline
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="card">
          <h3 className="font-display text-lg text-wordy-800 mb-2">
            Sent requests <span className="text-sm font-normal text-wordy-500">({outgoing.length})</span>
          </h3>
          <ul className="space-y-1.5">
            {outgoing.map((r) => {
              const otherId = otherIdOf(r);
              const otherName = usernames[otherId] || '(unknown)';
              return (
                <li key={otherId} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-wordy-50 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-wordy-700 truncate">{otherName}</div>
                    <div className="text-xs text-wordy-500">Pending</div>
                  </div>
                  <button
                    onClick={() => removeRow(otherId, otherName, 'cancel')}
                    className="text-xs font-bold text-rose-500 hover:text-rose-700 shrink-0"
                  >
                    Cancel
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card">
        <h3 className="font-display text-lg text-wordy-800 mb-2">
          Your friends <span className="text-sm font-normal text-wordy-500">({friends.length})</span>
        </h3>
        {loading ? (
          <p className="text-sm text-wordy-500">Loading…</p>
        ) : friends.length === 0 ? (
          <p className="text-sm text-wordy-500">No friends yet — search above to send your first request.</p>
        ) : (
          <ul className="space-y-1.5">
            {friends.map((r) => {
              const otherId = otherIdOf(r);
              const otherName = usernames[otherId] || '(unknown)';
              return (
                <li key={otherId} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-wordy-50 text-sm">
                  <span className="font-bold text-wordy-700 truncate">{otherName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => reportUser(otherId, otherName)}
                      className="text-xs font-bold text-wordy-500 hover:text-wordy-700"
                      title="Report"
                    >
                      Report
                    </button>
                    <button
                      onClick={() => blockUser(otherId, otherName)}
                      className="text-xs font-bold text-wordy-500 hover:text-wordy-700"
                      title="Block"
                    >
                      Block
                    </button>
                    <button
                      onClick={() => removeRow(otherId, otherName, 'remove')}
                      className="text-xs font-bold text-rose-500 hover:text-rose-700"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {blocks.length > 0 && (
        <section className="card">
          <h3 className="font-display text-lg text-wordy-800 mb-2">
            Blocked <span className="text-sm font-normal text-wordy-500">({blocks.length})</span>
          </h3>
          <p className="text-xs text-wordy-500 mb-2">
            Blocked users can't appear in your friend search. They aren't notified.
          </p>
          <ul className="space-y-1.5">
            {blocks.map((b) => {
              const otherName = usernames[b.blocked] || '(unknown)';
              return (
                <li key={b.blocked} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-wordy-50 text-sm">
                  <span className="font-bold text-wordy-700 truncate">{otherName}</span>
                  <button
                    onClick={() => unblockUser(b.blocked, otherName)}
                    disabled={busyKey === `unb:${b.blocked}`}
                    className="text-xs font-bold text-wordy-600 hover:text-wordy-800 shrink-0"
                  >
                    {busyKey === `unb:${b.blocked}` ? '…' : 'Unblock'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
