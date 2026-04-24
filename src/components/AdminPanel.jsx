import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';
import AnnouncementsAdmin from './AnnouncementsAdmin.jsx';

export default function AdminPanel({ userId, isMaster, onBack }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);

  async function loadAdmins() {
    const { data: rows, error } = await supabase
      .from('admins')
      .select('user_id, is_master, permissions, added_by, created_at');
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const userIds = rows.map((r) => r.user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds);
    const merged = rows.map((r) => ({
      ...r,
      username: profiles?.find((p) => p.id === r.user_id)?.username ?? '(unknown)',
    }));
    setAdmins(merged);
    setLoading(false);
  }

  useEffect(() => {
    loadAdmins();
  }, []);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username')
        .ilike('username', `%${q}%`)
        .order('username')
        .limit(10);
      if (cancelled) return;
      setSearching(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      const existingIds = new Set(admins.map((a) => a.user_id));
      setMatches((data || []).map((p) => ({ ...p, alreadyAdmin: existingIds.has(p.id) })));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, admins]);

  async function handleAddAdmin(profile) {
    setAddingId(profile.id);
    const { error } = await supabase.from('admins').insert({
      user_id: profile.id,
      permissions: [],
      is_master: false,
      added_by: userId,
    });
    setAddingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${profile.username} is now an admin`);
    setSearch('');
    setMatches([]);
    loadAdmins();
  }

  async function handleRemoveAdmin(profile) {
    if (profile.user_id === userId) {
      toast.error("You can't remove yourself");
      return;
    }
    if (profile.is_master) {
      toast.error("Can't remove a master admin");
      return;
    }
    if (!window.confirm(`Remove ${profile.username} as admin?`)) return;
    const { error } = await supabase.from('admins').delete().eq('user_id', profile.user_id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${profile.username} removed`);
    loadAdmins();
  }

  return (
    <main className="max-w-3xl mx-auto px-4 pb-12 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-wordy-800">Admin</h2>
        <button onClick={onBack} className="btn-secondary text-sm px-3 py-1.5">
          ← Back
        </button>
      </div>

      <section className="card">
        <h3 className="font-display text-lg text-wordy-800 mb-2">Future home for</h3>
        <ul className="text-sm text-wordy-600 space-y-1 list-disc pl-5">
          <li>Test groups — grant specific people access to specific games</li>
          <li>Ad settings — on/off, paid removal tier</li>
          <li>Per-game permission flags</li>
          <li>User lookup and moderation tools</li>
        </ul>
      </section>

      {isMaster && <AnnouncementsAdmin userId={userId} />}

      {isMaster && (
        <section className="card">
          <h3 className="font-display text-lg text-wordy-800 mb-3">Admins</h3>

          {loading ? (
            <p className="text-sm text-wordy-500">Loading...</p>
          ) : (
            <ul className="space-y-1.5 mb-4">
              {admins.map((a) => (
                <li
                  key={a.user_id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-wordy-50 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-wordy-700 truncate">
                      {a.username}
                      {a.user_id === userId && (
                        <span className="ml-2 text-xs font-normal text-wordy-500">(you)</span>
                      )}
                    </div>
                    <div className="text-xs text-wordy-500 truncate">
                      {a.is_master ? 'master admin' : a.permissions?.length ? a.permissions.join(', ') : 'standard'}
                    </div>
                  </div>
                  {!a.is_master && a.user_id !== userId && (
                    <button
                      onClick={() => handleRemoveAdmin(a)}
                      className="text-xs font-bold text-rose-500 hover:text-rose-700 shrink-0"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-bold text-wordy-700">Add admin</label>
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
                  {searching ? (
                    <p className="px-3 py-2 text-sm text-wordy-500">Searching…</p>
                  ) : matches.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-wordy-500">No users found</p>
                  ) : (
                    <ul>
                      {matches.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => !p.alreadyAdmin && handleAddAdmin(p)}
                            disabled={addingId === p.id || p.alreadyAdmin}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-wordy-50 text-sm disabled:hover:bg-transparent"
                          >
                            <span className={`font-bold truncate ${p.alreadyAdmin ? 'text-wordy-400' : 'text-wordy-700'}`}>
                              {p.username}
                            </span>
                            <span className="text-xs text-wordy-500 shrink-0">
                              {addingId === p.id ? '…' : p.alreadyAdmin ? 'Already admin' : 'Add →'}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-wordy-500">
              Start typing to find a user. Only master admins can add or remove admins.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
