import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const ENABLED = import.meta.env.VITE_SQ_ANNOUNCEMENTS !== 'false';

const SEVERITY_STYLES = {
  info: 'bg-purple-50 border-purple-300 text-purple-900 dark:bg-purple-950/40 dark:border-purple-700 dark:text-white',
  warning: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/40 dark:border-amber-700 dark:text-white',
  success: 'bg-green-50 border-green-300 text-green-900 dark:bg-green-950/40 dark:border-green-700 dark:text-white',
};

const SEVERITY_ICONS = {
  info: '✨',
  warning: '⚠️',
  success: '🎉',
};

export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState(null);

  useEffect(() => {
    if (!ENABLED) return;
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('announcements')
          .select('id, body, severity, dismissible')
          .order('published_at', { ascending: false })
          .limit(1);
        if (error || !active || !data || data.length === 0) return;
        const a = data[0];
        if (a.dismissible && localStorage.getItem(`sq:announcement:dismissed:${a.id}`)) {
          return;
        }
        setAnnouncement(a);
      } catch {
        // Fail silently — a banner that breaks the hub is worse than no banner.
      }
    })();
    return () => { active = false; };
  }, []);

  if (!announcement) return null;

  function handleDismiss() {
    localStorage.setItem(`sq:announcement:dismissed:${announcement.id}`, '1');
    setAnnouncement(null);
  }

  const style = SEVERITY_STYLES[announcement.severity] || SEVERITY_STYLES.info;
  const icon = SEVERITY_ICONS[announcement.severity] || SEVERITY_ICONS.info;

  return (
    <div className="max-w-[480px] mx-auto px-4 mb-4">
      <div className={`rounded-2xl border-2 ${style} flex items-start gap-3 p-3 shadow-sm`}>
        <span className="text-lg leading-none pt-0.5" aria-hidden="true">{icon}</span>
        <div className="flex-1 text-sm whitespace-pre-wrap">{announcement.body}</div>
        {announcement.dismissible && (
          <button
            onClick={handleDismiss}
            className="text-sm font-bold opacity-50 hover:opacity-100 px-2 -mr-1 transition-opacity"
            aria-label="Dismiss announcement"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
