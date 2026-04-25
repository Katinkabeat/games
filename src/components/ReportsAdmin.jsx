import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

function formatDate(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function ReportsAdmin({ userId }) {
  const [rows, setRows] = useState([]);
  const [usernames, setUsernames] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  const [notesById, setNotesById] = useState({});

  async function load() {
    const { data, error } = await supabase
      .from('reports')
      .select('id, reporter, reported, reported_username, game, reason, status, reviewed_by, reviewed_at, reviewer_notes, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    const ids = new Set();
    for (const r of data || []) {
      if (r.reporter) ids.add(r.reporter);
      if (r.reviewed_by) ids.add(r.reviewed_by);
    }
    let nameMap = {};
    if (ids.size > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', Array.from(ids));
      for (const p of profiles || []) nameMap[p.id] = p.username;
    }

    setRows(data || []);
    setUsernames(nameMap);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function setStatus(report, newStatus) {
    setBusyId(report.id);
    const { error } = await supabase
      .from('reports')
      .update({
        status: newStatus,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        reviewer_notes: notesById[report.id] || report.reviewer_notes || null,
      })
      .eq('id', report.id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(newStatus === 'reviewed' ? 'Marked reviewed' : 'Dismissed');
    load();
  }

  const open = rows.filter((r) => r.status === 'open');
  const resolved = rows.filter((r) => r.status !== 'open');

  return (
    <section className="card">
      <h3 className="font-display text-lg text-wordy-800 mb-2">
        Reports <span className="text-sm font-normal text-wordy-500">({open.length} open)</span>
      </h3>

      {loading ? (
        <p className="text-sm text-wordy-500">Loading…</p>
      ) : (
        <>
          {open.length === 0 ? (
            <p className="text-sm text-wordy-500 mb-3">No open reports. 🎉</p>
          ) : (
            <ul className="space-y-3 mb-3">
              {open.map((r) => (
                <li key={r.id} className="rounded-lg bg-wordy-50 p-3">
                  <div className="text-xs text-wordy-500 mb-1">
                    <span className="font-bold text-wordy-700">{usernames[r.reporter] || '(unknown)'}</span>
                    {' reported '}
                    <span className="font-bold text-wordy-700">{r.reported_username || '(deleted user)'}</span>
                    {r.game ? <> {' · '} {r.game}</> : null}
                    {' · '}
                    {formatDate(r.created_at)}
                  </div>
                  <div className="text-sm text-wordy-800 whitespace-pre-wrap break-words mb-2">{r.reason}</div>
                  <textarea
                    rows={2}
                    value={notesById[r.id] ?? ''}
                    onChange={(e) => setNotesById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    placeholder="Reviewer notes (optional)…"
                    className="w-full px-2 py-1 mb-2 border-2 border-wordy-200 rounded-lg focus:border-wordy-400 focus:outline-none text-xs resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setStatus(r, 'reviewed')}
                      disabled={busyId === r.id}
                      className="text-xs font-bold text-white bg-wordy-600 px-3 py-1 rounded-lg hover:bg-wordy-500 disabled:opacity-60"
                    >
                      Mark reviewed
                    </button>
                    <button
                      onClick={() => setStatus(r, 'dismissed')}
                      disabled={busyId === r.id}
                      className="text-xs font-bold text-wordy-600 hover:text-wordy-800"
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {resolved.length > 0 && (
            <div>
              <button
                onClick={() => setShowResolved((v) => !v)}
                className="text-xs font-bold text-wordy-600 hover:text-wordy-800"
              >
                {showResolved ? '▼' : '▶'} Resolved ({resolved.length})
              </button>
              {showResolved && (
                <ul className="space-y-2 mt-2">
                  {resolved.map((r) => (
                    <li key={r.id} className="rounded-lg bg-white border border-wordy-100 p-2.5 text-xs">
                      <div className="text-wordy-500">
                        <span className="font-bold text-wordy-600">{r.status}</span>
                        {' · '}
                        <span className="font-bold">{usernames[r.reporter] || '(unknown)'}</span>
                        {' → '}
                        <span className="font-bold">{r.reported_username || '(deleted)'}</span>
                        {' · '}
                        reviewed by <span className="font-bold">{usernames[r.reviewed_by] || '?'}</span> {formatDate(r.reviewed_at)}
                      </div>
                      <div className="text-wordy-800 whitespace-pre-wrap break-words mt-1">{r.reason}</div>
                      {r.reviewer_notes && (
                        <div className="text-wordy-600 italic mt-1">Notes: {r.reviewer_notes}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
