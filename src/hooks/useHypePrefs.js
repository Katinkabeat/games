import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

// Loads the current user's hype opt-out preferences and exposes a setter.
// Storage is a sparse JSONB blob on profiles (hype_prefs), keyed by cheer type:
//   { "wordy_bingo": false, "rivalry": false }
// A missing key means opted IN (default true) — a player who never opens this
// screen gets every (non opted-out) highlight. Board movement is mandatory and
// has no toggle. Writes go through the sq_set_hype_pref RPC (server-side merge).
export function useHypePrefs() {
  const [prefs, setPrefs] = useState({}); // { type: boolean }
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('hype_prefs')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setPrefs(data?.hype_prefs || {});
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Default opted-in: a missing key is true.
  const getEnabled = useCallback((key) => prefs?.[key] ?? true, [prefs]);

  const setEnabled = useCallback(
    async (key, enabled) => {
      const prev = prefs[key];
      setPrefs((p) => ({ ...p, [key]: enabled })); // optimistic
      const { error } = await supabase.rpc('sq_set_hype_pref', {
        p_key: key,
        p_enabled: enabled,
      });
      if (error) {
        toast.error(error.message);
        setPrefs((p) => ({ ...p, [key]: prev })); // revert
        return false;
      }
      return true;
    },
    [prefs],
  );

  return { prefs, loading, getEnabled, setEnabled, reload: load };
}
