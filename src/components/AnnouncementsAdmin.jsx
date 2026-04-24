import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

function formatDate(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function defaultExpiresAt(daysFromNow = 7) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(23, 59, 0, 0);
  return d.toISOString().slice(0, 16);
}

export default function AnnouncementsAdmin({ userId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('info');
  const [expiresAt, setExpiresAt] = useState(defaultExpiresAt(7));
  const [dismissible, setDismissible] = useState(true);
  const [posting, setPosting] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from('announcements')
      .select('id, body, severity, published_at, expires_at, dismissible')
      .order('published_at', { ascending: false })
      .limit(20);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handlePost(e) {
    e.preventDefault();
    if (posting) return;
    if (!body.trim()) {
      toast.error('Body cannot be empty');
      return;
    }
    setPosting(true);
    const { error } = await supabase.from('announcements').insert({
      body: body.trim(),
      severity,
      expires_at: new Date(expiresAt).toISOString(),
      dismissible,
      created_by: userId,
    });
    setPosting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Announcement posted!');
    setBody('');
    setSeverity('info');
    setExpiresAt(defaultExpiresAt(7));
    setDismissible(true);
    load();
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this announcement?')) return;
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Deleted');
    load();
  }

  function statusOf(row) {
    const now = Date.now();
    const pub = new Date(row.published_at).getTime();
    const exp = new Date(row.expires_at).getTime();
    if (exp <= now) return { label: 'expired', color: 'text-wordy-400' };
    if (pub > now) return { label: 'scheduled', color: 'text-blue-500' };
    return { label: 'active', color: 'text-green-600' };
  }

  return (
    <section className="card">
      <h3 className="font-display text-lg text-wordy-800 mb-3">Announcements</h3>

      <form onSubmit={handlePost} className="space-y-2 mb-5">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Announcement body — keep it short and friendly"
          rows={3}
          className="w-full px-3 py-2 border-2 border-wordy-200 rounded-xl focus:border-wordy-400 focus:outline-none text-sm resize-none"
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            <span className="block font-bold text-wordy-700 mb-1">Severity</span>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-full px-3 py-2 border-2 border-wordy-200 rounded-xl focus:border-wordy-400 focus:outline-none text-sm"
            >
              <option value="info">✨ Info</option>
              <option value="warning">⚠️ Warning</option>
              <option value="success">🎉 Success</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-bold text-wordy-700 mb-1">Expires</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full px-3 py-2 border-2 border-wordy-200 rounded-xl focus:border-wordy-400 focus:outline-none text-sm"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-wordy-700">
          <input
            type="checkbox"
            checked={dismissible}
            onChange={(e) => setDismissible(e.target.checked)}
          />
          Allow users to dismiss
        </label>
        <button
          type="submit"
          disabled={posting}
          className="btn-primary w-full text-sm"
        >
          {posting ? 'Posting…' : 'Post announcement'}
        </button>
      </form>

      <div>
        <h4 className="font-bold text-sm text-wordy-700 mb-2">Recent (latest 20)</h4>
        {loading ? (
          <p className="text-sm text-wordy-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-wordy-500">No announcements yet.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const status = statusOf(row);
              return (
                <li
                  key={row.id}
                  className="flex items-start gap-2 p-2.5 rounded-lg bg-wordy-50 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-wordy-800 whitespace-pre-wrap break-words">{row.body}</div>
                    <div className="text-xs text-wordy-500 mt-1">
                      <span className={`font-bold ${status.color}`}>{status.label}</span>
                      {' · '}
                      {row.severity}
                      {' · expires '}
                      {formatDate(row.expires_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(row.id)}
                    className="text-xs font-bold text-rose-500 hover:text-rose-700 shrink-0"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
