import { useCallback, useEffect, useState } from 'react';

// Tiny fetch-on-mount wrapper for the hub admin sub-pages. Owns the
// `loading` flag + initial load + a `reload()` the page calls after a
// mutation. Caller is responsible for memoizing `loadFn` (useCallback)
// so the effect only re-runs when its real dependencies change.
export function useAdminQuery(loadFn, initialData = null) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadFn();
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [loadFn]);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, reload, setData };
}
