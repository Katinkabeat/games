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

  // Pre-permission primer — shown the first time a user taps "Turn on"
  // before we trigger the OS dialog. Doubles opt-in rate per industry
  // research (Mixpanel, Leanplum). Only fires when permission is
  // 'default' (never been asked).
  const [showPrimer, setShowPrimer] = useState(false);

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
    if (notifyState === 'on') {
      setNotifyBusy(true);
      try {
        await unsubscribeFromPush();
        setNotifyState('off');
        toast.success('Notifications turned off');
      } catch (err) {
        toast.error(err.message || String(err));
      } finally {
        setNotifyBusy(false);
      }
      return;
    }
    // Turning on: show the primer first if we've never asked the OS yet.
    // For users who previously granted then unsubscribed, skip straight
    // to subscribe — they already know what they signed up for.
    const perm = getPushPermissionState();
    if (perm === 'default') {
      setShowPrimer(true);
      return;
    }
    await actuallySubscribe();
  }

  async function actuallySubscribe() {
    if (notifyBusy) return;
    setNotifyBusy(true);
    try {
      const result = await subscribeToPush();
      if (result === 'denied') {
        setNotifyState('denied');
        toast.error('Permission denied — enable in your browser settings');
      } else if (result) {
        setNotifyState('on');
        toast.success('Notifications turned on');
      }
    } catch (err) {
      toast.error(err.message || String(err));
    } finally {
      setNotifyBusy(false);
    }
  }

  function handlePrimerConfirm() {
    setShowPrimer(false);
    actuallySubscribe();
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
      {showPrimer && (
        <PrimerModal
          onConfirm={handlePrimerConfirm}
          onCancel={() => setShowPrimer(false)}
        />
      )}

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

// Pre-permission primer. Shown ONCE the first time a user taps
// "Turn on" — explains what they'll get pinged about and gives a
// graceful out (Cancel doesn't burn the OS permission prompt, so
// they can be re-asked later). After "Got it", the OS permission
// dialog fires.
function PrimerModal({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm card p-6 space-y-4">
        <div className="text-center">
          <div className="text-5xl mb-2">🔔</div>
          <h3 className="font-display text-xl text-wordy-800">
            Get pings when it's your turn
          </h3>
        </div>

        <ul className="space-y-2 text-sm text-wordy-700">
          <li className="flex items-start gap-2">
            <span className="text-wordy-500">•</span>
            <span>A friend takes their turn and you're up next</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-wordy-500">•</span>
            <span>Someone invites you to a match</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-wordy-500">•</span>
            <span>A friend request arrives</span>
          </li>
        </ul>

        <p className="text-xs text-wordy-500">
          You can pick exactly which games and events to ping you about
          on the next screen, and change anytime in Settings.
        </p>

        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={onConfirm}
            className="btn-primary w-full text-sm"
          >
            Got it — ask my browser
          </button>
          <button
            onClick={onCancel}
            className="text-sm font-bold text-wordy-500 hover:text-wordy-700 transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
