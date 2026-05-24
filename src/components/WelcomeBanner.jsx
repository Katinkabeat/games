import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// One-time hub welcome for brand-new accounts. Gated on
// profiles.welcomed_at: NULL means the account has never been welcomed
// (set so by the handle_new_user trigger, which doesn't touch this
// column). Existing accounts were backfilled to now() in the
// sq_hub_onboarding migration, so they never see this. We only show
// after the fresh fetch confirms NULL — no localStorage seed — so an
// already-welcomed user never gets a flash of the banner.
export default function WelcomeBanner({ userId }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('welcomed_at')
          .eq('id', userId)
          .single();
        if (error || !active || !data) return;
        if (data.welcomed_at === null) setShow(true);
      } catch {
        // Fail silently — a broken banner shouldn't break the hub.
      }
    })();
    return () => { active = false; };
  }, [userId]);

  if (!show) return null;

  async function handleDismiss() {
    setShow(false);
    try {
      await supabase
        .from('profiles')
        .update({ welcomed_at: new Date().toISOString() })
        .eq('id', userId);
    } catch {
      // Best-effort; worst case it shows once more on another device.
    }
  }

  return (
    <div className="max-w-[480px] mx-auto px-4 mb-4">
      <div className="card relative p-4">
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-sm font-bold text-wordy-400 hover:text-wordy-700 transition-colors"
          aria-label="Dismiss welcome"
        >
          ✕
        </button>
        <h2 className="font-display text-lg text-wordy-800 mb-1.5 pr-6">Welcome to Side Quest 👋</h2>
        <p className="text-sm text-wordy-700 leading-relaxed">
          Pick a game below to start. Play today's daily on your own, or open a game for anyone to join.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-wordy-500">
          <span>🔔 <b className="text-wordy-700">whose turn it is</b></span>
          <span>⚙️ <b className="text-wordy-700">settings &amp; friends</b></span>
        </div>
      </div>
    </div>
  );
}
