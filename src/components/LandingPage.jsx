import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';
import { useTheme } from '../contexts/ThemeContext.jsx';
import SettingsDropdown from './SettingsDropdown.jsx';
import AdminPanel from './AdminPanel.jsx';

const GAMES = [
  {
    id: 'wordy',
    name: 'Wordy',
    url: '/wordy/',
    initial: 'W',
    gradient: 'from-wordy-600 to-wordy-800',
  },
  {
    id: 'rungles',
    name: 'Rungles',
    url: '/rungles/',
    initial: 'R',
    gradient: 'from-wordy-600 to-wordy-800',
  },
];

export default function LandingPage({ session }) {
  const user = session.user;
  const { isDark, toggle: toggleTheme } = useTheme();
  const [username, setUsername] = useState(user.email?.split('@')[0] || 'friend');
  const [wordyTurn, setWordyTurn] = useState(0);
  const [wordyWaiting, setWordyWaiting] = useState(0);
  const [runglesTurn, setRunglesTurn] = useState(0);
  const [loading, setLoading] = useState(true);

  const [bellOpen, setBellOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState('landing');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMaster, setIsMaster] = useState(false);

  const bellRef = useRef(null);
  const cogRef = useRef(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .single();
      if (active && profile?.username) setUsername(profile.username);

      const { data: adminRow } = await supabase
        .from('admins')
        .select('is_master')
        .eq('user_id', user.id)
        .maybeSingle();
      if (active) {
        setIsAdmin(!!adminRow);
        setIsMaster(!!adminRow?.is_master);
      }

      const { data: wordyRows, error: wordyErr } = await supabase
        .from('game_players')
        .select('player_index, games!inner(id, status, current_player_idx)')
        .eq('user_id', user.id);
      if (!wordyErr && active && wordyRows) {
        let turn = 0;
        let waiting = 0;
        for (const row of wordyRows) {
          const g = row.games;
          if (!g) continue;
          if (g.status === 'active' && g.current_player_idx === row.player_index) turn++;
          else if (g.status === 'waiting') waiting++;
        }
        setWordyTurn(turn);
        setWordyWaiting(waiting);
      }

      const { data: runglesRows, error: runglesErr } = await supabase
        .from('rg_players')
        .select('player_idx, rg_games!inner(id, status, current_player_idx)')
        .eq('user_id', user.id);
      if (!runglesErr && active && runglesRows) {
        let turn = 0;
        for (const row of runglesRows) {
          const g = row.rg_games;
          if (!g) continue;
          if (g.status === 'active' && g.current_player_idx === row.player_idx) turn++;
        }
        setRunglesTurn(turn);
      }

      if (active) setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [user.id]);

  useEffect(() => {
    if (!bellOpen) return;
    function handleClickOutside(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [bellOpen]);

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) toast.error(error.message);
  }

  const inboxTotal = wordyTurn + wordyWaiting + runglesTurn;
  const hasNotifications = inboxTotal > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-100">
      <header className="max-w-3xl mx-auto px-4 pt-6 pb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-wordy-800 truncate">Rae's Side Quest</h1>
          <p className="text-sm text-wordy-600 truncate">Hi, {username}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative" ref={bellRef}>
            <button
              type="button"
              onClick={() => {
                setBellOpen((v) => !v);
                setSettingsOpen(false);
              }}
              aria-label={hasNotifications ? `Notifications (${inboxTotal})` : 'Notifications'}
              className="relative w-10 h-10 flex items-center justify-center rounded-xl border-2 border-purple-400 bg-white hover:bg-purple-50 transition-colors active:scale-95"
            >
              <span className="text-xl leading-none">🔔</span>
              {hasNotifications && (
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />
              )}
            </button>

            {bellOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 card p-2 z-50 shadow-lg">
                <h3 className="font-display text-base text-wordy-800 px-2 pt-1 pb-2">Inbox</h3>
                {loading ? (
                  <p className="text-sm text-wordy-500 px-2 pb-2">Loading...</p>
                ) : inboxTotal === 0 ? (
                  <p className="text-sm text-wordy-500 px-2 pb-2">Nothing waiting for you.</p>
                ) : (
                  <ul className="space-y-1">
                    {wordyTurn > 0 && (
                      <li>
                        <a
                          href="/wordy/"
                          className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-wordy-50 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-wordy-600 to-wordy-800 flex items-center justify-center shrink-0">
                            <span className="font-display text-sm text-white">W</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-wordy-800">Wordy</div>
                            <div className="text-xs text-wordy-500">Your turn</div>
                          </div>
                          <span className="min-w-[24px] h-6 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                            {wordyTurn}
                          </span>
                        </a>
                      </li>
                    )}
                    {wordyWaiting > 0 && (
                      <li>
                        <a
                          href="/wordy/"
                          className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-wordy-50 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-wordy-600 to-wordy-800 flex items-center justify-center shrink-0">
                            <span className="font-display text-sm text-white">W</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-wordy-800">Wordy</div>
                            <div className="text-xs text-wordy-500">Waiting for players</div>
                          </div>
                          <span className="min-w-[24px] h-6 px-1.5 rounded-full bg-wordy-400 text-white text-xs font-bold flex items-center justify-center shrink-0">
                            {wordyWaiting}
                          </span>
                        </a>
                      </li>
                    )}
                    {runglesTurn > 0 && (
                      <li>
                        <a
                          href="/rungles/"
                          className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-wordy-50 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-wordy-600 to-wordy-800 flex items-center justify-center shrink-0">
                            <span className="font-display text-sm text-white">R</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-wordy-800">Rungles</div>
                            <div className="text-xs text-wordy-500">Your turn</div>
                          </div>
                          <span className="min-w-[24px] h-6 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                            {runglesTurn}
                          </span>
                        </a>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="relative" ref={cogRef}>
            <button
              type="button"
              onClick={() => {
                setSettingsOpen((v) => !v);
                setBellOpen(false);
              }}
              aria-label="Settings"
              className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-purple-400 bg-white hover:bg-purple-50 transition-colors active:scale-95"
            >
              <span className="text-xl leading-none">⚙️</span>
            </button>

            {settingsOpen && (
              <SettingsDropdown
                userId={user.id}
                email={user.email}
                username={username}
                isDark={isDark}
                toggleTheme={toggleTheme}
                isAdmin={isAdmin}
                onUsernameChange={setUsername}
                onOpenAdmin={() => setView('admin')}
                onLogout={handleLogout}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>
        </div>
      </header>

      {view === 'admin' ? (
        <AdminPanel userId={user.id} isMaster={isMaster} onBack={() => setView('landing')} />
      ) : (
        <main className="max-w-3xl mx-auto px-4 pb-12">
          <div className="grid gap-4 sm:grid-cols-2">
            {GAMES.map((game) => (
              <a
                key={game.id}
                href={game.url}
                className="card hover:shadow-lg transition-shadow flex items-center gap-4 p-5"
              >
                <div
                  className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${game.gradient} flex items-center justify-center shrink-0 shadow-sm`}
                >
                  <span className="font-display text-2xl text-white">{game.initial}</span>
                </div>
                <h3 className="font-display text-xl text-wordy-800 flex-1 min-w-0 truncate">
                  {game.name}
                </h3>
              </a>
            ))}
          </div>
        </main>
      )}
    </div>
  );
}
