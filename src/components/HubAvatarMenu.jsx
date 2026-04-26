import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AVATAR_HUES = [270, 330, 190, 30, 160, 10];

function getInitials(name) {
  return (name || '?').slice(0, 2).toUpperCase();
}

function formatMonthYear(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

export default function HubAvatarMenu({ profile, onProfileUpdate }) {
  const [open, setOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [statsErr, setStatsErr] = useState(null);
  const [hueSaving, setHueSaving] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!statsOpen) return;
    function onKey(e) { if (e.key === 'Escape') setStatsOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [statsOpen]);

  const hue = profile?.avatar_hue ?? 270;
  const name = profile?.username ?? '…';
  const initials = getInitials(name);

  async function handleHueChange(newHue) {
    if (newHue === hue || !profile?.id || hueSaving) return;
    const prev = profile;
    setHueSaving(true);
    onProfileUpdate({ ...profile, avatar_hue: newHue });
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_hue: newHue })
      .eq('id', profile.id);
    setHueSaving(false);
    if (error) onProfileUpdate(prev);
  }

  async function openStats() {
    setStatsOpen(true);
    setOpen(false);
    setStats(null);
    setStatsErr(null);
    const { data, error } = await supabase.rpc('get_sq_stats');
    if (error) setStatsErr(error.message);
    else setStats(data);
  }

  return (
    <>
      <div className="relative shrink-0" ref={wrapRef}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label="Profile and stats"
          aria-haspopup="true"
          aria-expanded={open}
          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm border-2 border-black/5 hover:brightness-110 transition-all"
          style={{ background: `hsl(${hue}, 70%, 55%)` }}
        >
          {initials}
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-2 w-60 bg-[#fff] dark:bg-[#241640] border border-[#e9d5ff] dark:border-[#6d28d9] rounded-xl shadow-lg z-50 py-1">
            <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-[#e9d5ff] dark:border-[#6d28d9]">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs"
                style={{ background: `hsl(${hue}, 70%, 55%)` }}
              >
                {initials}
              </div>
              <div className="min-w-0">
                <div className="font-bold text-wordy-700 dark:text-wordy-300 text-sm truncate">{name}</div>
                <div className="text-xs text-wordy-500">Your profile</div>
              </div>
            </div>
            <div className="px-3 py-2.5 border-b border-[#e9d5ff] dark:border-[#6d28d9]">
              <div className="text-[0.68rem] uppercase tracking-wide text-wordy-500 mb-2">Avatar color</div>
              <div className="grid grid-cols-6 gap-1.5">
                {AVATAR_HUES.map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => handleHueChange(h)}
                    aria-label={`Hue ${h}`}
                    className={`w-full aspect-square rounded-full border-2 transition-transform ${
                      h === hue ? 'border-wordy-700 dark:border-wordy-300 scale-105' : 'border-transparent'
                    }`}
                    style={{ background: `hsl(${h}, 70%, 55%)` }}
                  />
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={openStats}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-wordy-50 dark:hover:bg-[#2d1b55] text-wordy-700 dark:text-wordy-300 transition-colors"
            >
              📊 Stats
            </button>
          </div>
        )}
      </div>

      {statsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setStatsOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-[#fff] dark:bg-[#241640] border border-[#e9d5ff] dark:border-[#6d28d9] rounded-2xl shadow-xl p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-xl text-wordy-800 dark:text-wordy-200">📊 Your stats</h2>
              <button
                type="button"
                onClick={() => setStatsOpen(false)}
                aria-label="Close"
                className="text-wordy-400 hover:text-wordy-700 text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {statsErr && (
              <p className="text-sm text-rose-500">Couldn't load stats: {statsErr}</p>
            )}

            {!statsErr && !stats && (
              <p className="text-sm text-wordy-500">Loading…</p>
            )}

            {stats && (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-[#f3e8ff] dark:border-[#6d28d9] pb-2">
                  <span className="text-wordy-600 dark:text-wordy-400">Member since</span>
                  <span className="font-bold text-wordy-800 dark:text-wordy-200">{formatMonthYear(stats.member_since)}</span>
                </div>

                <div className="flex justify-between border-b border-[#f3e8ff] dark:border-[#6d28d9] pb-2">
                  <span className="text-wordy-600 dark:text-wordy-400">Daily streak</span>
                  <span className="font-bold text-wordy-800 dark:text-wordy-200">
                    {stats.daily_streak} {stats.daily_streak === 1 ? 'day' : 'days'} 🔥
                  </span>
                </div>

                <div>
                  <div className="text-wordy-600 dark:text-wordy-400 mb-1">Games played</div>
                  <ul className="space-y-1 pl-1">
                    <li className="flex justify-between">
                      <span>📝 Wordy</span>
                      <span className="font-bold text-wordy-800 dark:text-wordy-200">{stats.wordy_multi} multi</span>
                    </li>
                    <li className="flex justify-between">
                      <span>🪜 Rungles</span>
                      <span className="font-bold text-wordy-800 dark:text-wordy-200">
                        {stats.rungles_solo} solo · {stats.rungles_multi} multi
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
