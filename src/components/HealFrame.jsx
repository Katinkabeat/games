import { useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { ensurePushSubscribed } from '../lib/pushNotifications.js';

// A1 push-address heal (card c270). Rendered when the hub loads with ?heal=1,
// which is how the games embed the hub in a hidden iframe. Because every SQ app
// is same-origin under /games/, this frame runs in the HUB service-worker scope
// and can read the shared Supabase auth session from localStorage — so it can
// refresh the single `sidequest` push subscription that the games themselves no
// longer own. This self-heals a lapsed/rotated address while the user is simply
// playing, not just when they open the hub directly (c249).
//
// Renders nothing. ensurePushSubscribed() is a no-op unless permission is
// already granted and the account master is on — it never prompts.
export default function HealFrame() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const userId = data?.session?.user?.id;
        if (cancelled || !userId) return;
        await ensurePushSubscribed(userId);
      } catch {
        // Opportunistic — never surface an error into the game shell.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return null;
}
