import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

const ID_RE = /^[a-z][a-z0-9-]{1,49}$/;

export default function GroupsAdmin({ userId }) {
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [usernames, setUsernames] = useState({});
  const [loading, setLoading] = useState(true);

  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const [searchByGroup, setSearchByGroup] = useState({});
  const [matchesByGroup, setMatchesByGroup] = useState({});
  const [busyKey, setBusyKey] = useState(null);

  async function load() {
    const [gResp, mResp] = await Promise.all([
      supabase.from('user_groups').select('id, name, description, created_at').order('created_at', { ascending: false }),
      supabase.from('user_group_members').select('group_id, user_id, expires_at, created_at'),
    ]);
    if (gResp.error) toast.error(gResp.error.message);
    if (mResp.error) toast.error(mResp.error.message);

    const userIds = Array.from(new Set((mResp.data || []).map((r) => r.user_id)));
    let nameMap = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', userIds);
      for (const p of profiles || []) nameMap[p.id] = p.username;
    }

    setGroups(gResp.data || []);
    setMembers(mResp.data || []);
    setUsernames(nameMap);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const timers = [];
    for (const [groupId, term] of Object.entries(searchByGroup)) {
      const q = (term || '').trim();
      if (q.length < 2) {
        setMatchesByGroup((prev) => ({ ...prev, [groupId]: [] }));
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
        const inGroup = new Set(members.filter((r) => r.group_id === groupId).map((r) => r.user_id));
        const enriched = (data || []).map((p) => ({ ...p, alreadyIn: inGroup.has(p.id) }));
        setMatchesByGroup((prev) => ({ ...prev, [groupId]: enriched }));
      }, 250);
      timers.push(t);
    }
    return () => { for (const t of timers) clearTimeout(t); };
  }, [searchByGroup, members]);

  async function createGroup(e) {
    e.preventDefault();
    if (creating) return;
    const id = newId.trim();
    if (!ID_RE.test(id)) {
      toast.error('id must be lowercase letters/numbers/hyphens (2–50 chars, start with letter)');
      return;
    }
    if (!newName.trim()) {
      toast.error('Name is required');
      return;
    }
    setCreating(true);
    const { error } = await supabase.from('user_groups').insert({
      id,
      name: newName.trim(),
      description: newDesc.trim() || null,
      created_by: userId,
    });
    setCreating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Group created!');
    setNewId('');
    setNewName('');
    setNewDesc('');
    load();
  }

  async function deleteGroup(group) {
    if (!window.confirm(`Delete group "${group.name}"? Members will be removed too.`)) return;
    const { error } = await supabase.from('user_groups').delete().eq('id', group.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Deleted');
    load();
  }

  async function addMember(groupId, profile) {
    const key = `${groupId}:${profile.id}`;
    setBusyKey(key);
    const { error } = await supabase.from('user_group_members').upsert({
      group_id: groupId,
      user_id: profile.id,
      added_by: userId,
    }, { onConflict: 'group_id,user_id' });
    setBusyKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${profile.username} added`);
    setSearchByGroup((prev) => ({ ...prev, [groupId]: '' }));
    setMatchesByGroup((prev) => ({ ...prev, [groupId]: [] }));
    load();
  }

  async function removeMember(groupId, targetUserId, username) {
    if (!window.confirm(`Remove ${username || 'this user'} from group?`)) return;
    const { error } = await supabase
      .from('user_group_members')
      .delete()
      .eq('group_id', groupId)
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
      <h3 className="font-display text-lg text-wordy-800 mb-1">Groups</h3>
      <p className="text-xs text-wordy-500 mb-4">
        Named buckets of users (e.g. <em>beta-testers</em>, <em>ad-free</em>). Use the
        Game access section above to bulk-grant a group access to a gated game.
        Other parts of the hub can call <code>user_in_group(uid, id)</code> for things
        like ad-free checks.
      </p>

      <form onSubmit={createGroup} className="space-y-2 mb-5">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder="id (e.g. beta-testers)"
            className="px-3 py-2 border-2 border-wordy-200 rounded-xl focus:border-wordy-400 focus:outline-none text-sm"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Display name"
            className="px-3 py-2 border-2 border-wordy-200 rounded-xl focus:border-wordy-400 focus:outline-none text-sm"
          />
        </div>
        <input
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="Description (optional)"
          className="w-full px-3 py-2 border-2 border-wordy-200 rounded-xl focus:border-wordy-400 focus:outline-none text-sm"
        />
        <button type="submit" disabled={creating} className="btn-primary w-full text-sm">
          {creating ? 'Creating…' : 'Create group'}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-wordy-500">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-wordy-500">No groups yet.</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => {
            const groupMembers = members.filter((m) => m.group_id === g.id);
            const term = searchByGroup[g.id] || '';
            const matches = matchesByGroup[g.id] || [];
            return (
              <li key={g.id} className="rounded-lg bg-wordy-50 p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm text-wordy-800">{g.name}</div>
                    <div className="text-xs text-wordy-500 break-all">
                      <code>{g.id}</code>
                      {g.description && <> · {g.description}</>}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteGroup(g)}
                    className="text-xs font-bold text-rose-500 hover:text-rose-700 shrink-0"
                  >
                    Delete
                  </button>
                </div>

                <div className="text-xs font-bold text-wordy-700 mb-1">
                  Members ({groupMembers.length})
                </div>
                {groupMembers.length === 0 ? (
                  <p className="text-xs text-wordy-500 mb-2">Nobody yet.</p>
                ) : (
                  <ul className="space-y-1 mb-2">
                    {groupMembers.map((m) => (
                      <li key={m.user_id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white text-sm">
                        <span className="font-bold text-wordy-700 truncate">{usernames[m.user_id] || '(unknown)'}</span>
                        <button
                          onClick={() => removeMember(g.id, m.user_id, usernames[m.user_id])}
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
                    onChange={(e) => setSearchByGroup((prev) => ({ ...prev, [g.id]: e.target.value }))}
                    placeholder="Search by username…"
                    className="w-full px-2 py-1 border-2 border-wordy-200 rounded-lg focus:border-wordy-400 focus:outline-none text-sm"
                  />
                  {term.trim().length >= 2 && matches.length > 0 && (
                    <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-purple-100 rounded-lg shadow-lg z-10 max-h-44 overflow-y-auto">
                      {matches.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            disabled={p.alreadyIn || busyKey === `${g.id}:${p.id}`}
                            onClick={() => !p.alreadyIn && addMember(g.id, p)}
                            className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-wordy-50 text-sm disabled:hover:bg-transparent"
                          >
                            <span className={`font-bold truncate ${p.alreadyIn ? 'text-wordy-400' : 'text-wordy-700'}`}>{p.username}</span>
                            <span className="text-xs text-wordy-500 shrink-0">
                              {busyKey === `${g.id}:${p.id}` ? '…' : p.alreadyIn ? 'Already in' : 'Add →'}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
