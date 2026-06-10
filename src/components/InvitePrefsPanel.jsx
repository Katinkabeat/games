import { useEffect, useRef, useState } from 'react';
import { APPS } from '../lib/notificationTopics.js';
import { useInvitePrefs } from '../hooks/useInvitePrefs.js';

// Per-game invite preferences — the twin of NotificationsPanel. Lists
// the four games that have an invite flow and lets the player pick, per
// game, who's allowed to invite them. Storage + fallback live in
// useInvitePrefs; this is just the surface.
//
// 'sidequest' (the hub) is excluded — you don't get invited to the hub.
const INVITE_APPS = APPS.filter((a) => a.key !== 'sidequest');

const POLICY_OPTIONS = [
  { value: 'everyone',     label: 'Anyone' },
  { value: 'friends_only', label: 'Friends only' },
  { value: 'nobody',       label: 'Nobody' },
];

const POLICY_SUBTITLE = {
  everyone:     'Anyone can invite you',
  friends_only: 'Only friends can invite you',
  nobody:       'No one can invite you',
};

export default function InvitePrefsPanel({ onBack }) {
  const { loading, getPolicy, setPolicy } = useInvitePrefs();

  if (loading) {
    return (
      <main className="max-w-[480px] mx-auto px-4 pb-12">
        <button
          onClick={onBack}
          className="text-sm font-bold text-wordy-500 hover:text-wordy-700 dark:hover:text-wordy-200"
        >
          ← Back
        </button>
        <p className="text-sm text-wordy-500 italic mt-4">Loading…</p>
      </main>
    );
  }

  return (
    <main className="max-w-[480px] mx-auto px-4 pb-12 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-wordy-800">Invites</h2>
        <button
          onClick={onBack}
          className="text-sm font-bold text-wordy-500 hover:text-wordy-700 dark:hover:text-wordy-200"
        >
          ← Back
        </button>
      </div>

      <p className="text-xs text-wordy-500">
        Choose who can invite you to each game. This only controls invites sent
        to you — you can always invite other people yourself.
      </p>

      <ul className="space-y-2">
        {INVITE_APPS.map((app) => {
          const policy = getPolicy(app.key);
          return (
            <li key={app.key}>
              <div className="card flex items-center gap-4 p-4">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${app.gradient} flex items-center justify-center shrink-0 shadow-sm`}>
                  <span className="font-display text-xl text-white">{app.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-lg text-wordy-800 truncate">{app.label}</div>
                  <div className="text-xs text-wordy-500">{POLICY_SUBTITLE[policy]}</div>
                </div>
                <PolicyPicker
                  value={policy}
                  onChange={(v) => setPolicy(app.key, v)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

// Dark-mode-safe three-option picker, mirroring the one the settings
// dropdown used for the old global control. Native <select> popups don't
// reliably honour color-scheme: dark, so we render our own menu.
function PolicyPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const current = POLICY_OPTIONS.find((o) => o.value === value) ?? POLICY_OPTIONS[1];

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors cursor-pointer flex items-center gap-1"
      >
        <span>{current.label}</span>
        <span className="text-xs text-wordy-400">▾</span>
      </button>
      {open && (
        <ul className="absolute right-0 top-full mt-1 w-36 card dropdown-surface p-1 z-50 shadow-lg space-y-0.5">
          {POLICY_OPTIONS.map((opt) => {
            const selected = opt.value === value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (opt.value !== value) onChange(opt.value);
                  }}
                  className={`w-full text-left text-sm font-bold px-2 py-1.5 rounded-md transition-colors ${
                    selected
                      ? 'text-wordy-700 bg-wordy-50'
                      : 'text-wordy-700 hover:bg-wordy-50'
                  }`}
                >
                  {selected ? '✓ ' : '   '}
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
