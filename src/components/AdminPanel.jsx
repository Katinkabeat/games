import { useState } from 'react';
import AnnouncementsAdmin from './AnnouncementsAdmin.jsx';
import AccessAdmin from './AccessAdmin.jsx';
import GroupsAdmin from './GroupsAdmin.jsx';
import ReportsAdmin from './ReportsAdmin.jsx';
import ClosedGamesAdmin from './ClosedGamesAdmin.jsx';
import AdminsManagement from './AdminsManagement.jsx';

// Each entry is one row on the index + the page rendered when tapped.
// `master: true` hides the row from non-master admins.
// `Component` is mounted only when the row is active (lazy = no needless RPCs).
const SECTIONS = [
  { key: 'reports',       icon: '📋', label: 'Reports',                Component: ReportsAdmin     },
  { key: 'closed',        icon: '🛑', label: 'Recently Closed Games',  Component: ClosedGamesAdmin },
  { key: 'announcements', icon: '📣', label: 'Announcements',          Component: AnnouncementsAdmin, master: true },
  { key: 'access',        icon: '🔑', label: 'Access',                 Component: AccessAdmin,        master: true },
  { key: 'groups',        icon: '👥', label: 'Groups',                 Component: GroupsAdmin,        master: true },
  { key: 'admins',        icon: '🛡️', label: 'Admins',                 Component: AdminsManagement,   master: true },
];

export default function AdminPanel({ userId, isMaster, onBack }) {
  const [view, setView] = useState('index');

  const visibleSections = SECTIONS.filter((s) => !s.master || isMaster);
  const active = visibleSections.find((s) => s.key === view);

  if (active) {
    const Section = active.Component;
    return (
      <main className="max-w-[480px] mx-auto px-4 pb-12 space-y-4">
        <button
          onClick={() => setView('index')}
          className="text-sm font-bold text-wordy-500 hover:text-wordy-700"
        >
          ← Admin
        </button>
        <Section userId={userId} />
      </main>
    );
  }

  return (
    <main className="max-w-[480px] mx-auto px-4 pb-12 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-wordy-800">Admin</h2>
        <button onClick={onBack} className="btn-secondary text-sm px-3 py-1.5">
          ← Back
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        <ul>
          {visibleSections.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setView(s.key)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-wordy-50 transition-colors ${
                  i < visibleSections.length - 1 ? 'border-b border-wordy-100' : ''
                }`}
              >
                <span className="text-xl w-8 text-center shrink-0">{s.icon}</span>
                <span className="font-bold text-wordy-700 flex-1">{s.label}</span>
                <span className="text-wordy-300 font-bold text-lg">›</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-wordy-400 px-2">
        Tap a section to open it. Each section loads its own data only when you visit it.
      </p>
    </main>
  );
}
