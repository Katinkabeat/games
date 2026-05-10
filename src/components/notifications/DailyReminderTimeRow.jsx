import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase.js';

// Lives under the "Daily reminder" toggle in the SideQuest section.
// Lets the user pick the local time of day to be pinged. Backed by
// profiles.daily_reminder_time + daily_reminder_tz. The Phase 2 cron
// fires only if the user has at least one unplayed daily, so the
// time controls WHEN, the toggle controls IF.
//
// 30-min slots (07:00 → 22:30). Auto-detects browser TZ on first save.
const SLOTS = (() => {
  const out = [];
  for (let h = 7; h <= 22; h++) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      out.push(`${hh}:${mm}`);
    }
  }
  return out;
})();

function fmtLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function detectTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Halifax'; }
  catch { return 'America/Halifax'; }
}

export default function DailyReminderTimeRow({ dim }) {
  const [time, setTime] = useState('');     // 'HH:MM' (24h) or '' (no schedule)
  const [tz, setTz] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active || !user) { setLoaded(true); return; }
      const { data } = await supabase
        .from('profiles')
        .select('daily_reminder_time, daily_reminder_tz')
        .eq('id', user.id)
        .maybeSingle();
      if (!active) return;
      // Postgres `time` comes back as 'HH:MM:SS' — trim seconds.
      const t = data?.daily_reminder_time
        ? String(data.daily_reminder_time).slice(0, 5)
        : '';
      setTime(t);
      setTz(data?.daily_reminder_tz || detectTz());
      setLoaded(true);
    })();
    return () => { active = false; };
  }, []);

  async function save(newTime) {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const newTz = tz || detectTz();
      const { error } = await supabase
        .from('profiles')
        .update({
          daily_reminder_time: newTime || null,
          daily_reminder_tz: newTz,
        })
        .eq('id', user.id);
      if (error) throw error;
      setTime(newTime);
      setTz(newTz);
    } catch (err) {
      toast.error(err.message || 'Failed to save reminder time');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <div
      className={`mt-1 ml-7 mb-2 p-2 rounded-lg bg-wordy-50/40 dark:bg-wordy-700/20 transition-opacity ${dim ? 'opacity-50' : ''}`}
    >
      <label className="block text-xs font-bold text-wordy-700 mb-1">Reminder time</label>
      <select
        value={time}
        onChange={(e) => save(e.target.value)}
        disabled={dim || saving}
        className="w-full text-sm rounded-md border border-wordy-200 bg-white dark:bg-wordy-100 dark:border-wordy-200 px-2 py-1.5"
      >
        <option value="">No reminder</option>
        {SLOTS.map((t) => (
          <option key={t} value={t}>{fmtLabel(t)}</option>
        ))}
      </select>
      <p className="text-[11px] text-wordy-500 mt-1">
        Fires in your local time ({tz}). Daily resets at midnight Atlantic time.
      </p>
    </div>
  );
}
