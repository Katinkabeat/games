import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

// Loads the current user's per-game invite preferences and exposes a
// setter. Storage is a sparse JSONB blob on profiles (invite_prefs),
// keyed by app: { "wordy": "friends_only", "yahdle": "nobody" }.
//
// A missing key falls back to the user's global profiles.invitability,
// so a player who never opens this screen keeps their existing
// behaviour. Values reuse the invitability_policy vocabulary
// ('everyone' | 'friends_only' | 'nobody').
//
// Writes go through the sq_set_invite_pref RPC, which validates the
// app/policy and does the jsonb merge server-side.
export function useInvitePrefs() {
  const [prefs, setPrefs] = useState({});                  // { app: policy }
  const [fallback, setFallback] = useState('friends_only'); // global invitability
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const { data, error } = await supabase
      .from('profiles')
      .select('invitability, invite_prefs')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setFallback(data?.invitability || 'friends_only');
    setPrefs(data?.invite_prefs || {});
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Effective policy for a game: the explicit per-game override if set,
  // otherwise the user's global default.
  const getPolicy = useCallback(
    (app) => prefs?.[app] ?? fallback,
    [prefs, fallback],
  );

  // True when this game has an explicit override (vs. inheriting the default).
  const isCustom = useCallback((app) => prefs?.[app] != null, [prefs]);

  const setPolicy = useCallback(async (app, policy) => {
    const prev = prefs[app];
    setPrefs((p) => ({ ...p, [app]: policy })); // optimistic
    const { error } = await supabase.rpc('sq_set_invite_pref', {
      p_app: app,
      p_policy: policy,
    });
    if (error) {
      toast.error(error.message);
      setPrefs((p) => ({ ...p, [app]: prev })); // revert
      return false;
    }
    return true;
  }, [prefs]);

  return { prefs, fallback, loading, getPolicy, isCustom, setPolicy, reload: load };
}
