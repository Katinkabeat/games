import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

// Loads the current user's notification prefs and exposes a setter.
// Prefs table is sparse (only stores explicit choices), so we
// also need the Postgres-side default for any topic that has no
// row. The hook handles both — `getEnabled(app, topic)` returns
// the effective bool, and `setEnabled(app, topic, enabled)`
// upserts a row.
//
// Defaults are resolved lazily by reading sq_notification_default()
// for each topic the first time it's asked about, then cached.

export function useNotificationPrefs() {
  // Map keyed by `${app}:${topic}` -> boolean. Includes both stored
  // prefs and resolved defaults; UI doesn't need to distinguish.
  const [prefs, setPrefs] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_notification_prefs')
      .select('app, topic, enabled');
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const next = {};
    for (const row of data || []) {
      next[`${row.app}:${row.topic}`] = row.enabled;
    }
    setPrefs(next);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Resolve effective enabled-ness for a (app, topic). If we have
  // a stored row, use it. Otherwise call sq_notification_default
  // and cache the result so we don't re-roundtrip.
  async function resolveDefault(topic) {
    const cacheKey = `__default:${topic}`;
    if (cacheKey in prefs) return prefs[cacheKey];
    const { data, error } = await supabase.rpc('sq_notification_default', { p_topic: topic });
    const value = error ? true : !!data;
    setPrefs((p) => ({ ...p, [cacheKey]: value }));
    return value;
  }

  const getEnabled = useCallback((app, topic) => {
    const key = `${app}:${topic}`;
    if (key in prefs) return prefs[key];
    const cached = prefs[`__default:${topic}`];
    if (cached !== undefined) return cached;
    // Kick off async resolve; until it returns, fall through to true
    // for known-default-on topics so the toggle paints in a sane state.
    resolveDefault(topic);
    return topic === 'opponent_joined' ? false : true;
  }, [prefs]);

  // Returns `true` if the master switch for an app is enabled (or unset).
  // Distinct from getEnabled('app', '_master') only in that we pre-cache
  // the master default to true.
  const getMaster = useCallback((app) => {
    const key = `${app}:_master`;
    if (key in prefs) return prefs[key];
    return true;
  }, [prefs]);

  const setEnabled = useCallback(async (app, topic, enabled) => {
    // Optimistic update.
    const key = `${app}:${topic}`;
    setPrefs((p) => ({ ...p, [key]: enabled }));

    const { error } = await supabase
      .from('user_notification_prefs')
      .upsert(
        { user_id: (await supabase.auth.getUser()).data.user?.id, app, topic, enabled },
        { onConflict: 'user_id,app,topic' }
      );
    if (error) {
      toast.error(error.message);
      // Revert on failure.
      setPrefs((p) => {
        const copy = { ...p };
        delete copy[key];
        return copy;
      });
      return false;
    }
    return true;
  }, []);

  return { prefs, loading, getEnabled, getMaster, setEnabled, reload: load };
}
