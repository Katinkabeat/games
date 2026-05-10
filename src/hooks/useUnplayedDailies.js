import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Returns a Set of game ids whose daily this user hasn't completed
// for today (Atlantic time). Drives the corner-dot indicator on the
// hub tiles. Backed by sq_unplayed_dailies(uid) which dispatches to
// each daily game's <game>_played_daily(uid, ymd) function — adding
// a new daily game is purely a DB convention change, no hub update.
//
// Refreshes on tab visibility so coming back from a daily-game tab
// clears the dot without a full reload.
export function useUnplayedDailies(userId) {
  const [unplayed, setUnplayed] = useState(() => new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!userId) { setUnplayed(new Set()); setReady(true); return; }
    let active = true;

    async function load() {
      const { data, error } = await supabase.rpc('sq_unplayed_dailies', { uid: userId });
      if (!active) return;
      if (error) {
        console.warn('[useUnplayedDailies]', error);
        // Fail-quiet: empty set means no dot. Don't block the hub.
        setUnplayed(new Set());
      } else {
        setUnplayed(new Set((data ?? []).map(r => r.game_id)));
      }
      setReady(true);
    }

    load();
    function onVisible() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);

  return { unplayed, ready };
}
