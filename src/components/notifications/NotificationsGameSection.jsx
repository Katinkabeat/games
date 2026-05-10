import { APPS, TOPICS } from '../../lib/notificationTopics.js';
import DailyReminderTimeRow from './DailyReminderTimeRow.jsx';

// Per-game sub-page: master toggle at top, then per-topic toggles.
// Master OFF silences the whole game regardless of per-topic state.
export default function NotificationsGameSection({ app, prefs, onBack }) {
  const masterOn = prefs.getMaster(app.key);

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className="text-sm font-bold text-wordy-500 hover:text-wordy-700 dark:hover:text-wordy-200"
      >
        ← Back
      </button>

      <section className="card">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${app.gradient} flex items-center justify-center shrink-0`}>
            <span className="font-display text-lg text-white">{app.icon}</span>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-lg text-wordy-800 truncate">{app.label}</h3>
            <p className="text-xs text-wordy-500">Notifications for this game</p>
          </div>
        </div>

        <ToggleRow
          label="Mute everything"
          description="Master switch. Silences this game even if individual notifications are on."
          checked={!masterOn}
          onChange={(muted) => prefs.setEnabled(app.key, '_master', !muted)}
          dim={false}
        />

        <div className="border-t border-wordy-100 my-3" />

        <div className="space-y-2">
          {app.topics.map((topic) => {
            const t = TOPICS[topic];
            if (!t) return null;
            const enabled = prefs.getEnabled(app.key, topic);
            return (
              <div key={topic}>
                <ToggleRow
                  label={t.label}
                  description={t.description}
                  checked={enabled}
                  onChange={(v) => prefs.setEnabled(app.key, topic, v)}
                  dim={!masterOn}
                />
                {topic === 'daily_reminder' && (
                  <DailyReminderTimeRow dim={!masterOn || !enabled} />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange, dim }) {
  return (
    <label
      className={`flex items-start gap-3 p-2 rounded-lg cursor-pointer transition-opacity ${
        dim ? 'opacity-50' : 'hover:bg-wordy-50 dark:hover:bg-wordy-700/30'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 accent-wordy-600 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-wordy-800">{label}</div>
        <div className="text-xs text-wordy-500">{description}</div>
      </div>
    </label>
  );
}
