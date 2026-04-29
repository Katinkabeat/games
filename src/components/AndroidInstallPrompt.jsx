import { useEffect, useState } from 'react';

/**
 * Android Chrome (and other Chromium browsers) fires `beforeinstallprompt`
 * when the PWA is installable. We stash the event and surface a card with
 * an Install button that triggers Chrome's native install sheet.
 *
 * iOS Safari never fires this event, so the iOS-specific prompt handles
 * that platform separately. Already-installed users don't see this either —
 * Chrome skips the event in standalone mode.
 */

const DISMISS_KEY = 'sq-android-install-dismissed';

function isInStandaloneMode() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (navigator.standalone === true) return true;
  return false;
}

export default function AndroidInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === 'true'
  );
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    function handler(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    window.addEventListener('beforeinstallprompt', handler);
    // If the user installs via Chrome's own UI, clear our state too.
    function onInstalled() {
      setDeferredPrompt(null);
    }
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferredPrompt || dismissed || isInStandaloneMode()) return null;

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } finally {
      // The event is single-use; clear it either way.
      setDeferredPrompt(null);
      setInstalling(false);
    }
  }

  return (
    <div className="card border-2 border-wordy-200 dark:border-[#3d2070]">
      <div className="flex items-start gap-3">
        <span className="text-2xl mt-0.5">📲</span>
        <div className="flex-1">
          <p className="font-bold text-wordy-700 dark:text-wordy-300 text-sm">
            Install Rae's Side Quest for notifications!
          </p>
          <p className="text-xs text-wordy-400 dark:text-wordy-500 mt-0.5">
            Add the hub to your Home Screen to get push notifications from all
            your games.
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleInstall}
              disabled={installing}
              className="btn-primary text-xs py-1.5 px-3 disabled:opacity-60"
            >
              {installing ? 'Opening…' : 'Install'}
            </button>
            <button
              onClick={handleDismiss}
              className="text-xs text-wordy-400 hover:text-wordy-600 dark:text-wordy-500 dark:hover:text-wordy-300"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
