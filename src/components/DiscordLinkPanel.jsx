import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';
import { useHypePrefs } from '../hooks/useHypePrefs.js';

// The hype cheers a player can turn off (board movement is always on, so it's
// not listed). checked = "celebrate me for this" (on by default).
const CHEERS = [
  { key: 'wordy_bingo', label: 'Wordy bingo', description: 'Playing all seven tiles in one move' },
  { key: 'yahdle_clean', label: 'Yahdle clean card', description: 'Filling every category with no zeros' },
  { key: 'rungles_gold', label: 'Rungles gold run', description: 'Hitting the gold square on every rung' },
  { key: 'personal_best', label: 'Personal bests', description: 'Beating your own best in a game' },
  { key: 'bounty', label: 'Records', description: "Breaking a game's all-time high score" },
  { key: 'rivalry', label: 'Rivalries', description: 'Your back-and-forth with another player' },
];

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 p-2 rounded-lg cursor-pointer hover:bg-wordy-50 dark:hover:bg-wordy-700/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 accent-wordy-600 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-wordy-800">{label}</div>
        <div className="text-xs text-wordy-500">{description}</div>
      </div>
    </label>
  );
}

// Link your SideQuest account to Discord so the Rook bot can show your name on
// the leaderboards and grant activity roles. You generate a one-time code here,
// then run `/link <code>` in the SideQuest Discord (or DM it to Rook).
export default function DiscordLinkPanel({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ linked: false });
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const { loading: prefsLoading, getEnabled, setEnabled } = useHypePrefs();

  async function loadStatus() {
    setLoading(true);
    const { data, error } = await supabase.rpc('rook_my_discord_link');
    if (error) toast.error('Could not load link status');
    else setStatus(data ?? { linked: false });
    setLoading(false);
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function generateCode() {
    setBusy(true);
    const { data, error } = await supabase.rpc('rook_mint_link_code');
    setBusy(false);
    if (error || !data) {
      toast.error('Could not generate a code');
      return;
    }
    setCode(data);
  }

  async function unlink() {
    setBusy(true);
    const { error } = await supabase.rpc('rook_unlink_discord');
    setBusy(false);
    if (error) {
      toast.error('Could not unlink');
      return;
    }
    setCode(null);
    toast.success('Discord unlinked');
    loadStatus();
  }

  function copyCode() {
    if (!code) return;
    navigator.clipboard?.writeText(code).then(
      () => toast.success('Code copied'),
      () => {}
    );
  }

  return (
    <main className="max-w-[480px] mx-auto px-4 pb-12 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-wordy-800">Discord</h2>
        <button
          onClick={onBack}
          className="text-sm font-bold text-wordy-500 hover:text-wordy-700 dark:hover:text-wordy-200"
        >
          ← Back
        </button>
      </div>

      <p className="text-xs text-wordy-500">
        Link your account to the SideQuest Discord so the Rook bot can show your
        name on the leaderboards and give you roles for your streaks and wins.
      </p>

      {loading ? (
        <p className="text-sm text-wordy-500 italic">Loading…</p>
      ) : status.linked ? (
        <div className="card p-4 space-y-3">
          <div>
            <div className="font-display text-lg text-wordy-800">You're linked</div>
            <div className="text-xs text-wordy-500">
              Connected to Discord{status.discord_username ? ` as ${status.discord_username}` : ''}.
            </div>
          </div>
          <button
            onClick={unlink}
            disabled={busy}
            className="text-sm font-bold text-red-600 hover:text-red-500 disabled:opacity-50"
          >
            Unlink Discord
          </button>
        </div>
      ) : code ? (
        <div className="card p-4 space-y-3">
          <div className="text-xs text-wordy-500">Your one-time code (expires in 10 minutes):</div>
          <button
            onClick={copyCode}
            className="w-full font-mono text-3xl tracking-[0.3em] text-center text-wordy-800 bg-wordy-50 rounded-xl py-4 hover:bg-wordy-100 transition-colors"
            title="Tap to copy"
          >
            {code}
          </button>
          <div className="text-xs text-wordy-500 leading-relaxed">
            In the SideQuest Discord, run{' '}
            <span className="font-mono text-wordy-700">/link {code}</span> (or DM it
            to Rook). Tap the code to copy it.
          </div>
          <button
            onClick={generateCode}
            disabled={busy}
            className="text-sm font-bold text-wordy-500 hover:text-wordy-700 disabled:opacity-50"
          >
            Generate a new code
          </button>
        </div>
      ) : (
        <div className="card p-4 space-y-3">
          <div className="text-xs text-wordy-500">
            Not linked yet. Generate a code, then run it in Discord.
          </div>
          <button
            onClick={generateCode}
            disabled={busy}
            className="btn-primary text-sm font-bold disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Generate link code'}
          </button>
        </div>
      )}

      <div className="border-t border-wordy-200 dark:border-wordy-700 mt-2 pt-4 space-y-2">
        <h3 className="font-display text-lg text-wordy-800">Highlight shoutouts</h3>
        <p className="text-xs text-wordy-500">
          Rook celebrates standout plays in the SideQuest Discord. Turn off any you'd
          rather it skip for you. Leaderboard movements are always shown.
        </p>
        {prefsLoading ? (
          <p className="text-sm text-wordy-500 italic">Loading…</p>
        ) : (
          <div className="card p-2 divide-y divide-wordy-100 dark:divide-wordy-700">
            {CHEERS.map((c) => (
              <ToggleRow
                key={c.key}
                label={c.label}
                description={c.description}
                checked={getEnabled(c.key)}
                onChange={(v) => setEnabled(c.key, v)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
