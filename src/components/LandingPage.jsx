import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';
import { useUnplayedDailies } from '../hooks/useUnplayedDailies.js';
import { logEvent } from '../lib/telemetry.js';
import { migrateToSideQuestPush, ensurePushSubscribed } from '../lib/pushNotifications.js';
import { useTheme } from '../contexts/ThemeContext.jsx';
import SettingsDropdown from './SettingsDropdown.jsx';
import HubAvatarMenu from './HubAvatarMenu.jsx';
import AnnouncementBanner from './AnnouncementBanner.jsx';
import WelcomeBanner from './WelcomeBanner.jsx';
import { SQErrorBoundary } from '../../packages/sq-ui/index.js';

const AdminPanel = lazy(() => import('./AdminPanel.jsx'));
const NotificationsPanel = lazy(() => import('./NotificationsPanel.jsx'));
const InvitePrefsPanel = lazy(() => import('./InvitePrefsPanel.jsx'));
const DiscordLinkPanel = lazy(() => import('./DiscordLinkPanel.jsx'));
import FriendsView from './FriendsView.jsx';
import FeedbackView from './FeedbackView.jsx';
import IOSInstallPrompt from './IOSInstallPrompt.jsx';
import AndroidInstallPrompt from './AndroidInstallPrompt.jsx';

// Hardcoded fallback — used if the games_catalog query fails/errors or
// returns zero rows, and when VITE_SQ_USE_CATALOG is explicitly false.
// _access defaults to 'allowed' since fallback bypasses Phase 7 gating.
const FALLBACK_GAMES = [
  {
    id: 'wordy',
    name: 'Wordy',
    url: '/wordy/',
    initial: 'W',
    gradient: 'from-wordy-600 to-wordy-800',
    description: 'Build words on the board from the tiles in your rack and rack up the highest score.',
    has_daily: false,
    _access: 'allowed',
  },
  {
    id: 'rungles',
    name: 'Rungles',
    url: '/rungles/',
    initial: 'R',
    gradient: 'from-wordy-600 to-wordy-800',
    description: 'Build a ladder of connected words, each one a rung. Solo is 7 rungs, multiplayer is 10.',
    has_daily: true,
    _access: 'allowed',
  },
  {
    id: 'snibble',
    name: 'Snibble',
    url: '/snibble/',
    initial: 'S',
    gradient: 'from-wordy-600 to-wordy-800',
    description: 'A cozy daily word pet. Each day it has one craving, a rule your words must follow.',
    has_daily: true,
    _access: 'allowed',
  },
  {
    id: 'yahdle',
    name: 'Yahdle',
    url: '/yahdle/',
    initial: 'Y',
    gradient: 'from-wordy-600 to-wordy-800',
    description: 'Roll six letter dice, spell a word, and score it into one of 12 categories.',
    has_daily: true,
    _access: 'allowed',
  },
  {
    id: 'oublex',
    name: 'Oublex',
    url: '/oublex/',
    initial: 'O',
    gradient: 'from-wordy-600 to-wordy-800',
    description: 'A new dungeon takes shape each day. You get one run; spell your way through, or you don’t come back up.',
    has_daily: true,
    _access: 'allowed',
  },
];

const USE_CATALOG = import.meta.env.VITE_SQ_USE_CATALOG !== 'false';
const USE_RPC = import.meta.env.VITE_SQ_USE_RPC !== 'false';

export default function LandingPage({ session }) {
  const user = session.user;
  const usernameStorageKey = `sq:username:${user.id}`;
  const profileStorageKey = `sq:profile:${user.id}`;
  const gamesStorageKey = `sq:games:${user.id}`;
  const { isDark, toggle: toggleTheme } = useTheme();
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem(usernameStorageKey) || ''; } catch { return ''; }
  });
  // Full profile (id + username + avatar_hue) for the hub avatar dropdown.
  // Seeded from localStorage so the avatar paints with the correct hue +
  // initials on first render; the network fetch silently refreshes it.
  const [profile, setProfile] = useState(() => {
    try {
      const raw = localStorage.getItem(profileStorageKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const persistProfile = (p) => {
    setProfile(p);
    try {
      if (p) localStorage.setItem(profileStorageKey, JSON.stringify(p));
      else localStorage.removeItem(profileStorageKey);
    } catch {}
  };
  // Phase 6: unified inbox state. Each item is {game_id, count, label, url}.
  // Populated either from sq_pending_for() RPC or, if that fails or is
  // disabled, from the legacy per-game queries (via buildLegacyItems).
  const [inboxItems, setInboxItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [bellOpen, setBellOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which game's how-to blurb popover is open on the grid (game id or null).
  const [openBlurb, setOpenBlurb] = useState(null);
  const [view, setView] = useState('landing');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMaster, setIsMaster] = useState(false);
  const [adminPermissions, setAdminPermissions] = useState([]);
  // Set of game ids whose daily the user hasn't completed today, plus a
  // ready flag so we can tell "daily done" apart from "still loading" and
  // avoid flashing the wrong status line on daily tiles.
  const { unplayed: unplayedDailies, ready: dailiesLoaded } = useUnplayedDailies(user.id);
  // Seeded from localStorage so testers (and everyone else) skip the
  // gated-flash on subsequent loads while loadCatalog() refreshes in
  // the background.
  const [games, setGames] = useState(() => {
    try {
      const raw = localStorage.getItem(gamesStorageKey);
      const cached = raw ? JSON.parse(raw) : null;
      return Array.isArray(cached) && cached.length > 0 ? cached : FALLBACK_GAMES;
    } catch { return FALLBACK_GAMES; }
  });
  const persistGames = (g) => {
    setGames(g);
    try { localStorage.setItem(gamesStorageKey, JSON.stringify(g)); } catch {}
  };
  // Count of pending incoming friend requests (not ones I sent). Surfaces
  // as a red dot on the cog and the Friends menu item.
  const [pendingFriendCount, setPendingFriendCount] = useState(0);

  const bellRef = useRef(null);
  const cogRef = useRef(null);

  useEffect(() => {
    let active = true;
    let recountTimer = null;
    let pollInterval = null;

    async function loadProfileAndAdmin() {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('id, username, avatar_hue')
        .eq('id', user.id)
        .single();
      if (active && profileRow) {
        persistProfile(profileRow);
        if (profileRow.username) {
          setUsername(profileRow.username);
          try { localStorage.setItem(usernameStorageKey, profileRow.username); } catch {}
        }
      }

      const { data: adminRow } = await supabase
        .from('admins')
        .select('is_master, permissions')
        .eq('user_id', user.id)
        .maybeSingle();
      if (active) {
        setIsAdmin(!!adminRow);
        setIsMaster(!!adminRow?.is_master);
        setAdminPermissions(adminRow?.permissions ?? []);
      }
    }

    async function loadPendingFriends() {
      // Pending requests where I am the recipient (the OTHER user requested).
      const { count } = await supabase
        .from('friendships')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
        .neq('requested_by', user.id);
      if (active) setPendingFriendCount(count ?? 0);
    }

    async function loadCatalog() {
      if (!USE_CATALOG) return;
      const [catalogResp, accessResp] = await Promise.all([
        supabase
          .from('games_catalog')
          .select('id, name, url, initial, gradient, requires_access, description, has_daily')
          .eq('is_published', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('user_game_access')
          .select('game_id, status')
          .eq('user_id', user.id),
      ]);
      if (!active) return;
      if (catalogResp.error || !catalogResp.data || catalogResp.data.length === 0) return;

      const accessByGame = {};
      if (!accessResp.error && accessResp.data) {
        for (const row of accessResp.data) accessByGame[row.game_id] = row.status;
      }

      const enriched = catalogResp.data
        .map((game) => {
          let _access;
          if (!game.requires_access) _access = 'allowed';
          else if (accessByGame[game.id] === 'allowed') _access = 'allowed';
          else if (accessByGame[game.id] === 'blocked') _access = 'blocked';
          else _access = 'gated';
          return { ...game, _access };
        })
        .filter((g) => g._access !== 'blocked');

      persistGames(enriched);
    }

    // Legacy fallback — runs the per-game queries the hub used before
    // Phase 6 and returns the same shape sq_pending_for() does.
    async function recountInboxLegacy() {
      const items = [];

      const { data: wordyRows, error: wordyErr } = await supabase
        .from('game_players')
        .select('player_index, games!inner(id, status, current_player_idx)')
        .eq('user_id', user.id);
      if (!wordyErr && wordyRows) {
        let turn = 0;
        let waiting = 0;
        for (const row of wordyRows) {
          const g = row.games;
          if (!g) continue;
          if (g.status === 'active' && g.current_player_idx === row.player_index) turn++;
          else if (g.status === 'waiting') waiting++;
        }
        if (turn > 0)    items.push({ game_id: 'wordy', count: turn,    label: 'Your turn',           url: '/wordy/' });
        if (waiting > 0) items.push({ game_id: 'wordy', count: waiting, label: 'Waiting for players', url: '/wordy/' });
      }

      const { data: runglesRows, error: runglesErr } = await supabase
        .from('rg_players')
        .select('player_idx, rg_games!inner(id, status, current_player_idx)')
        .eq('user_id', user.id);
      if (!runglesErr && runglesRows) {
        let turn = 0;
        for (const row of runglesRows) {
          const g = row.rg_games;
          if (!g) continue;
          if (g.status === 'active' && g.current_player_idx === row.player_idx) turn++;
        }
        if (turn > 0) items.push({ game_id: 'rungles', count: turn, label: 'Your turn', url: '/rungles/' });
      }

      // Snibble — async match model. "Your turn" = match where you owe a
      // play (in_progress + you haven't submitted the current round) OR
      // an invite waiting for you to accept.
      const { data: snibbleMatches, error: snibbleErr } = await supabase
        .from('sn_matches')
        .select('id, status, creator_id, opponent_id, invited_user_id')
        .or(`creator_id.eq.${user.id},opponent_id.eq.${user.id},invited_user_id.eq.${user.id}`)
        .in('status', ['open', 'in_progress']);
      if (!snibbleErr && snibbleMatches && snibbleMatches.length > 0) {
        const inProgressIds = snibbleMatches.filter(m => m.status === 'in_progress').map(m => m.id);
        let myPlaysByMatch = new Map();
        if (inProgressIds.length > 0) {
          const { data: snPlays } = await supabase
            .from('sn_match_round_plays')
            .select('match_id')
            .in('match_id', inProgressIds)
            .eq('user_id', user.id);
          for (const p of snPlays ?? []) {
            myPlaysByMatch.set(p.match_id, (myPlaysByMatch.get(p.match_id) ?? 0) + 1);
          }
        }
        let turn = 0;
        let invites = 0;
        for (const m of snibbleMatches) {
          if (m.status === 'open' && m.invited_user_id === user.id) invites++;
          else if (m.status === 'in_progress' && (myPlaysByMatch.get(m.id) ?? 0) === 0) turn++;
        }
        if (turn > 0)    items.push({ game_id: 'snibble', count: turn,    label: 'Your turn', url: '/snibble/' });
        if (invites > 0) items.push({ game_id: 'snibble', count: invites, label: 'Invite',    url: '/snibble/' });
      }

      return items;
    }

    async function recountInbox() {
      if (USE_RPC) {
        const { data, error } = await supabase.rpc('sq_pending_for', { uid: user.id });
        if (!error && active && Array.isArray(data)) {
          setInboxItems(data);
          return;
        }
        // Fall through to legacy on error.
      }
      const legacyItems = await recountInboxLegacy();
      if (active) setInboxItems(legacyItems);
    }

    function scheduleRecount() {
      if (recountTimer) clearTimeout(recountTimer);
      recountTimer = setTimeout(() => {
        if (active) recountInbox();
      }, 300);
    }

    (async () => {
      await Promise.all([loadProfileAndAdmin(), loadCatalog(), loadPendingFriends()]);
      await recountInbox();
      if (active) setLoading(false);
    })();

    const channel = supabase
      .channel('hub-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, scheduleRecount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rg_games' }, scheduleRecount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sn_matches', filter: `creator_id=eq.${user.id}` }, scheduleRecount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sn_matches', filter: `opponent_id=eq.${user.id}` }, scheduleRecount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sn_matches', filter: `invited_user_id=eq.${user.id}` }, scheduleRecount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `user_id=eq.${user.id}` }, scheduleRecount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rg_players', filter: `user_id=eq.${user.id}` }, scheduleRecount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sn_match_round_plays', filter: `user_id=eq.${user.id}` }, scheduleRecount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'yahdle_games', filter: `created_by=eq.${user.id}` }, scheduleRecount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'yahdle_games', filter: `invited_user_id=eq.${user.id}` }, scheduleRecount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'yahdle_players', filter: `user_id=eq.${user.id}` }, scheduleRecount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => { if (active) loadPendingFriends(); })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (!pollInterval) {
            pollInterval = setInterval(() => { if (active) recountInbox(); }, 60000);
          }
        } else if (status === 'SUBSCRIBED' && pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      });

    return () => {
      active = false;
      if (recountTimer) clearTimeout(recountTimer);
      if (pollInterval) clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [user.id]);

  useEffect(() => {
    logEvent('app_opened');
    // Auto-migrate friends who already enabled notifications via Wordy or
    // Rungles to the unified SideQuest subscription. Silent no-op if they
    // haven't granted permission on this device.
    migrateToSideQuestPush(user.id);
    // Self-heal a lapsed/rotated push address so notifications don't silently
    // die between sessions. No-op unless permission is granted and the account
    // master is on. Fire-and-forget — never block the hub render.
    ensurePushSubscribed(user.id);
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

  const inboxTotal = inboxItems.reduce((sum, it) => sum + (it.count || 0), 0);
  const hasNotifications = inboxTotal > 0;
  const gamesById = games.reduce((acc, g) => { acc[g.id] = g; return acc; }, {});

  return (
    <div className="min-h-screen bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-100">
      <header className="max-w-[480px] mx-auto px-4 pt-6 pb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <HubAvatarMenu profile={profile} onProfileUpdate={persistProfile} />
          <div className="min-w-0">
            <h1 className="font-display text-2xl text-wordy-800 truncate">Rae's Side Quest</h1>
            <p className="text-sm text-wordy-600 truncate">{username ? `Hi, ${username}` : '\u00A0'}</p>
          </div>
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
              className="relative w-10 h-10 flex items-center justify-center active:scale-95"
            >
              <span className="text-xl leading-none">🔔</span>
              {hasNotifications && (
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />
              )}
            </button>

            {bellOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 card dropdown-surface p-2 z-50 shadow-lg">
                <h3 className="font-display text-base text-wordy-800 px-2 pt-1 pb-2">Inbox</h3>
                {loading ? (
                  <p className="text-sm text-wordy-500 px-2 pb-2">Loading...</p>
                ) : inboxTotal === 0 ? (
                  <p className="text-sm text-wordy-500 px-2 pb-2">Nothing waiting yet. Pick a game below to play today's daily or start a match.</p>
                ) : (
                  <ul className="space-y-1">
                    {inboxItems.filter((it) => (it.count || 0) > 0).map((it, idx) => {
                      const game = gamesById[it.game_id];
                      if (!game) return null;
                      const isUrgent = it.label === 'Your turn';
                      const badgeClass = isUrgent ? 'bg-red-500' : 'bg-wordy-400';
                      return (
                        <li key={`${it.game_id}-${it.label}-${idx}`}>
                          <a
                            href={it.url}
                            className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-wordy-50 transition-colors"
                          >
                            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${game.gradient} flex items-center justify-center shrink-0`}>
                              <span className="font-display text-sm text-white">{game.initial}</span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-bold text-wordy-800">{game.name}</div>
                              <div className="text-xs text-wordy-500">{it.label}</div>
                            </div>
                            <span className={`min-w-[24px] h-6 px-1.5 rounded-full ${badgeClass} text-white text-xs font-bold flex items-center justify-center shrink-0`}>
                              {it.count}
                            </span>
                          </a>
                        </li>
                      );
                    })}
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
              aria-label={pendingFriendCount > 0 ? `Settings (${pendingFriendCount} friend request${pendingFriendCount === 1 ? '' : 's'})` : 'Settings'}
              className="relative w-10 h-10 flex items-center justify-center active:scale-95"
            >
              <span className="text-xl leading-none">⚙️</span>
              {pendingFriendCount > 0 && (
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />
              )}
            </button>

            {settingsOpen && (
              <SettingsDropdown
                userId={user.id}
                email={user.email}
                username={username}
                isDark={isDark}
                toggleTheme={toggleTheme}
                isAdmin={isAdmin}
                pendingFriendCount={pendingFriendCount}
                onOpenAdmin={() => setView('admin')}
                onOpenFriends={() => setView('friends')}
                onOpenNotifications={() => setView('notifications')}
                onOpenInvitePrefs={() => setView('invitePrefs')}
                onOpenDiscordLink={() => setView('discordLink')}
                onOpenFeedback={() => setView('feedback')}
                onLogout={handleLogout}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>
        </div>
      </header>

      {view === 'admin' ? (
        <Suspense fallback={<p className="max-w-[480px] mx-auto px-4 pb-12 text-sm text-wordy-500">Loading admin…</p>}>
          <AdminPanel userId={user.id} isMaster={isMaster} permissions={adminPermissions} onBack={() => setView('landing')} />
        </Suspense>
      ) : view === 'notifications' ? (
        <Suspense fallback={<p className="max-w-[480px] mx-auto px-4 pb-12 text-sm text-wordy-500">Loading notifications…</p>}>
          <NotificationsPanel onBack={() => setView('landing')} />
        </Suspense>
      ) : view === 'invitePrefs' ? (
        <Suspense fallback={<p className="max-w-[480px] mx-auto px-4 pb-12 text-sm text-wordy-500">Loading invites…</p>}>
          <InvitePrefsPanel onBack={() => setView('landing')} />
        </Suspense>
      ) : view === 'discordLink' ? (
        <Suspense fallback={<p className="max-w-[480px] mx-auto px-4 pb-12 text-sm text-wordy-500">Loading…</p>}>
          <DiscordLinkPanel onBack={() => setView('landing')} />
        </Suspense>
      ) : view === 'friends' ? (
        <FriendsView userId={user.id} onBack={() => setView('landing')} />
      ) : view === 'feedback' ? (
        <FeedbackView onBack={() => setView('landing')} />
      ) : (
        <SQErrorBoundary variant="inline" label="hub-grid">
          <AnnouncementBanner />
          <WelcomeBanner userId={user.id} />
          <main className="max-w-[480px] mx-auto px-4 pb-12">
            <div className="mb-4 space-y-3">
              <IOSInstallPrompt />
              <AndroidInstallPrompt />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {games.map((game) => {
                // Admins bypass the access gate so they can test in-development
                // games while the rest of the world sees them as "Coming soon".
                // Pattern locked during Snibble build (2026-04-25).
                const isGatedForUser = game._access === 'gated' && !isAdmin;
                if (isGatedForUser) {
                  return (
                    <div
                      key={game.id}
                      className="card opacity-60 cursor-not-allowed flex items-center gap-4 p-5"
                      aria-disabled="true"
                    >
                      <div
                        className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${game.gradient} flex items-center justify-center shrink-0 shadow-sm`}
                      >
                        <span className="font-display text-2xl text-white">{game.initial}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-display text-xl text-wordy-800 truncate">{game.name}</h3>
                        <p className="text-xs text-wordy-500">Coming soon</p>
                      </div>
                    </div>
                  );
                }
                const isDaily = !!game.has_daily;
                const dailyReady = unplayedDailies.has(game.id);
                const blurbOpen = openBlurb === game.id;
                return (
                  <div
                    key={game.id}
                    className="card flex items-center gap-x-3 gap-y-3 p-5 flex-wrap"
                  >
                    <div
                      className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${game.gradient} flex items-center justify-center shrink-0 shadow-sm`}
                    >
                      <span className="font-display text-2xl text-white">{game.initial}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-display text-xl text-wordy-800 truncate">
                          {game.name}
                        </h3>
                        {game.description && (
                          <button
                            type="button"
                            onClick={() => setOpenBlurb(blurbOpen ? null : game.id)}
                            aria-label={`About ${game.name}`}
                            aria-expanded={blurbOpen}
                            className="shrink-0 text-wordy-400 hover:text-wordy-600 active:scale-95 leading-none"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <circle cx="12" cy="12" r="10" />
                              <path d="M12 16v-4" />
                              <path d="M12 8h.01" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {/* Reserved daily-status line: fixed height so a tile
                          doesn't resize when its daily flips ready→done.
                          Only daily games get the line; blank until loaded. */}
                      {isDaily && (
                        <p className="text-xs font-semibold h-4 leading-4 mt-0.5">
                          {dailyReady ? (
                            <span className="text-amber-600">Daily ready</span>
                          ) : dailiesLoaded ? (
                            <span className="text-wordy-400 font-normal">Daily completed</span>
                          ) : null}
                        </p>
                      )}
                    </div>
                    <a
                      href={game.url}
                      aria-label={`Play ${game.name}`}
                      className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-wordy-600 hover:bg-wordy-700 text-white text-sm font-bold shadow-sm active:scale-95 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M6 3l14 9-14 9z" />
                      </svg>
                      Play
                    </a>
                    {blurbOpen && game.description && (
                      <p className="basis-full text-sm text-wordy-600 border-t border-wordy-100 pt-3">
                        {game.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </main>
        </SQErrorBoundary>
      )}
    </div>
  );
}
