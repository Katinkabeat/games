import { useState } from 'react';

/**
 * iOS Safari users only see push notifications if the PWA is added to their
 * Home Screen — PushManager isn't available in regular Safari. The hub owns
 * the unified push subscription for every SideQuest game, so this prompt
 * lives here (not inside any one game) and benefits all of them.
 */

function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPad on iOS 13+ reports as Mac with touch support.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

function isInStandaloneMode() {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (navigator.standalone === true) return true;
  return false;
}

function isSafariBrowser() {
  const ua = navigator.userAgent;
  const isSafari = /Safari/.test(ua);
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
  return isSafari && !isOtherBrowser;
}

const DISMISS_KEY = 'sq-ios-install-dismissed';

export default function IOSInstallPrompt() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === 'true'
  );
  const [showSteps, setShowSteps] = useState(false);

  if (!isIOS() || isInStandaloneMode() || dismissed) return null;

  const isSafari = isSafariBrowser();

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  }

  if (!isSafari) {
    return (
      <div className="card border-2 border-amber-200 dark:border-amber-800/50">
        <div className="flex items-start gap-3">
          <span className="text-2xl mt-0.5">📲</span>
          <div className="flex-1">
            <p className="font-bold text-wordy-700 dark:text-wordy-300 text-sm">
              Want notifications on your iPhone?
            </p>
            <p className="text-xs text-wordy-400 dark:text-wordy-500 mt-0.5">
              Open Rae's Side Quest in <strong>Safari</strong> to install it to
              your Home Screen. Push notifications only work from the Home
              Screen app.
            </p>
            <button
              onClick={handleDismiss}
              className="text-xs text-wordy-400 hover:text-wordy-600 dark:text-wordy-500 dark:hover:text-wordy-300 mt-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
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
            your games. It only takes a few seconds.
          </p>

          {!showSteps ? (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setShowSteps(true)}
                className="btn-primary text-xs py-1.5 px-3"
              >
                Show Me How
              </button>
              <button
                onClick={handleDismiss}
                className="text-xs text-wordy-400 hover:text-wordy-600 dark:text-wordy-500 dark:hover:text-wordy-300"
              >
                Not now
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              <Step number={1}>
                Tap the <strong>Share</strong> button{' '}
                <span className="inline-block bg-wordy-100 dark:bg-[#2d1b55] text-wordy-600 dark:text-wordy-300 text-xs font-mono px-1.5 py-0.5 rounded">
                  ⬆
                </span>{' '}
                at the bottom of Safari
              </Step>
              <Step number={2}>
                Scroll down and tap <strong>"Add to Home Screen"</strong>
              </Step>
              <Step number={3}>
                Tap <strong>"Add"</strong> in the top-right corner
              </Step>
              <Step number={4}>
                Open Rae's Side Quest from your Home Screen and enable
                notifications!
              </Step>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowSteps(false)}
                  className="text-xs text-wordy-400 hover:text-wordy-600 dark:text-wordy-500 dark:hover:text-wordy-300"
                >
                  Hide steps
                </button>
                <span className="text-wordy-200 dark:text-wordy-700">·</span>
                <button
                  onClick={handleDismiss}
                  className="text-xs text-wordy-400 hover:text-wordy-600 dark:text-wordy-500 dark:hover:text-wordy-300"
                >
                  Don't show again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Step({ number, children }) {
  return (
    <div className="flex items-start gap-2">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-wordy-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {number}
      </span>
      <p className="text-xs text-wordy-600 dark:text-wordy-400 leading-relaxed">
        {children}
      </p>
    </div>
  );
}
