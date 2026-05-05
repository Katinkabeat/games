import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

// Debounced username -> profiles search used by the hub admin pages
// that add a user to a list (admins, friends, group members). Caller
// owns "already in the list" enrichment at render time, so it stays
// fresh as the underlying list mutates without re-firing the search.
export function useUsernameSearch({ limit = 10, debounceMs = 250, minChars = 2 } = {}) {
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = term.trim();
    if (q.length < minChars) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username')
        .ilike('username', `%${q}%`)
        .order('username')
        .limit(limit);
      if (cancelled) return;
      setSearching(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      setMatches(data || []);
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, limit, debounceMs, minChars]);

  function reset() {
    setTerm('');
    setMatches([]);
  }

  return { term, setTerm, matches, searching, reset };
}
