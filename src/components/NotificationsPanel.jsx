import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  getPushPermissionState,
  hasActivePushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/pushNotifications.js';
import { APPS } from '../lib/notificationTopics.js';
import { useNotificationPrefs } from '../hooks/useNotificationPrefs.js';
import NotificationsGameSection from './notifications/NotificationsGameSection.jsx';

// Drill-down panel mirroring AdminPanel's pattern: top-level index of
// games (each with a per-game master toggle), tap a row to drill into
// per-topic toggles. Top of the panel also exposes the browser-level
// push subscription toggle so users can turn pushes on/off without
// leaving the screen.
export default function NotificationsPanel({ onBack }) {
  const [view, setView] = useState('index');
  const prefs = useNotificationPrefs();

  // Browser push state (separate from the per-app prefs above).
  // 'loading' | 'on' | 'off' | 'denied' | 'unsupported'
  const [notifyState, setNotifyState] = useState('loading');
  const [notifyBusy, setNotifyBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const perm = getPushPermissionState();
      if (perm === 'unsupported') {
        if (active) setNotifyState('unsupported');
        return;
      }
      if (perm === 'denied') {
        if (active) setNotifyState('denied');
        return;
      }
      const subscribed = await hasActivePushSubscription();
      if (active) setNotifyState(subscribed ? 'on' : 'off');
    })();
    return () => { active = false; };
  }, []);

  async function handleToggleNotify() {
    if (notifyBusy) return;
    setNotifyBusy(true);
    try {
      if (notifyState === 'on') {
        await unsubscribeFromPush();
        setNotifyState('off');
        toast.success('Notifications turned off');
      } else {
        const result = await subscribeToPush();
        if (result === 'denied') {
          setNotifyState('denied');
          toast.error('Permission denied — enable in your browser settings');
        } else if (result) {
          setNotifyState('on');
          toast.success('Notifications turned on');
        }
      }
    } catch (err) {
      toast.error(err.message || String(err));
    } finally {
      setNotifyBusy(false);
    }
  }

  if (prefs.loading) {
    return (
      <main className="max-w-[480px] mx-auto px-4 pb-12">
        <button
          onClick={onBack}
          className="text-sm font-bold text-wordy-500 hover:text-wordy-700"
        >
          ← Back
        </button>
        <p className="text-sm text-wordy-500 italic mt-4">Loading…</p>
      </main>
    );
  }

  const activeApp = APPS.find((a) => a.key === view);

  if (activeApp) {
    return (
      <main className="max-w-[480px] mx-auto px-4 pb-12">
        <NotificationsGameSection
          app={activeApp}
          prefs={prefs}
          onBack={() => setView('index')}
        />
      </main>
    );
  }

  return (
    <main className="max-w-[480px] mx-auto px-4 pb-12 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-wordy-800">Notifications</h2>
        <button
          onClick={onBack}
          className="text-sm font-bold text-wordy-500 hover:text-wordy-700"
        >
          ← Back
        </button>
      </div>

      <p className="text-xs text-wordy-500">
        Choose which pings you want to get. Tap a game to set per-event preferences,
        or use the Mute switch to silence a game entirely.
      </p>

      <section className="card flex items-center gap-3 p-3">
        <div className="text-2xl">
          {notifyState === 'on' ? '🔔' : '🔕'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-wordy-800">
            {notifyState === 'on' && 'Browser push: on'}
            {notifyState === 'off' && 'Browser push: off'}
            {notifyState === 'denied' && 'Browser push: blocked'}
            {notifyState === 'unsupported' && 'Browser push: not supported'}
            {notifyState === 'loading' && 'Browser push: checking…'}
          </div>
          <div className="text-xs text-wordy-500">
            {notifyState === 'denied'
              ? 'Re-enable notifications in your browser to receive pings.'
              : notifyState === 'unsupported'
              ? 'This browser doesn’t support web push.'
              : 'The OS-level switch. Per-game settings only matter when this is on.'}
          </div>
        </div>
        {notifyState !== 'denied' && notifyState !== 'unsupported' && notifyState !== 'loading' && (
          <button
            onClick={handleToggleNotify}
            disabled={notifyBusy}
            className="text-xs font-bold text-wordy-700 bg-white border-2 border-wordy-200 hover:border-wordy-400 px-2 py-1 rounded-lg disabled:opacity-60 shrink-0"
          >
            {notifyBusy ? '…' : notifyState === 'on' ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </section>

      <ul className="space-y-2">
        {APPS.map((app) => {
          const masterOn = prefs.getMaster(app.key);
          return (
            <li key={app.key}>
              <button
                onClick={() => setView(app.key)}
                className="w-full card hover:shadow-lg transition-shadow flex items-center gap-4 p-4 text-left"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${app.gradient} flex items-center justify-center shrink-0 shadow-sm`}>
                  <span className="font-display text-xl text-white">{app.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-lg text-wordy-800 truncate">{app.label}</div>
                  <div className="text-xs text-wordy-500">
                    {masterOn ? `${app.topics.length} notification type${app.topics.length === 1 ? '' : 's'}` : 'Muted'}
                  </div>
                </div>
                <span className="text-wordy-400">›</span>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
