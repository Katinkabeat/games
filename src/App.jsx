import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { supabase } from './lib/supabase.js';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import AuthPage from './components/AuthPage.jsx';
import LandingPage from './components/LandingPage.jsx';
import StyleGuidePage from './components/StyleGuidePage.jsx';
import ReactivateScreen from './components/ReactivateScreen.jsx';
import DeleteConfirmPage from './components/DeleteConfirmPage.jsx';
import { captureRefFromUrl, consumePendingRef } from './lib/referral.js';

// Friend referral capture (card c135). Stash ?ref=<token> before auth
// resolves so it survives the signup -> email-confirm redirect. No-op
// unless VITE_REFERRALS_ENABLED is on (dormant at ship).
captureRefFromUrl();

// Allowlist of path prefixes the post-login ?return= redirect will honor.
// Add new SQ games here when scaffolding them so notifications and bookmarks
// survive a logged-out re-entry.
const ALLOWED_RETURN_PREFIXES = ['/wordy/', '/rungles/', '/snibble/', '/yahdle/'];

function getValidatedReturn() {
  const params = new URLSearchParams(window.location.search);
  const ret = params.get('return');
  if (!ret) return null;
  try {
    const url = new URL(ret, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    if (!ALLOWED_RETURN_PREFIXES.some((p) => url.pathname.startsWith(p))) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

// ?styleguide=1 short-circuits auth so the sq-ui style guide is reachable
// without a session. Dev-only review surface; safe to ship since it just
// renders static UI with no data access.
const isStyleGuide = new URLSearchParams(window.location.search).has('styleguide');

// ?delete_confirm=TOKEN is the email confirmation link for account deletion.
// Handled before auth: the token is the proof, so it works logged out too.
const deleteConfirmToken = new URLSearchParams(window.location.search).get('delete_confirm');

export default function App() {
  if (isStyleGuide) {
    return (
      <ThemeProvider>
        <StyleGuidePage />
      </ThemeProvider>
    );
  }

  if (deleteConfirmToken) {
    return (
      <ThemeProvider>
        <Toaster position="top-center" />
        <DeleteConfirmPage token={deleteConfirmToken} />
      </ThemeProvider>
    );
  }

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  // Detect a password-recovery link from the URL hash before getSession()
  // resolves so we never momentarily render the lobby for a recovery user.
  const [isRecovery, setIsRecovery] = useState(
    () => window.location.hash.includes('type=recovery')
  );
  // Account lifecycle: null = not yet loaded for this session. When the row has
  // deactivated_at set, we gate to ReactivateScreen instead of the lobby.
  const [lifecycle, setLifecycle] = useState(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
      // A pending referral token (from ?ref=) is consumed on the first
      // authenticated load after signup — creates the inviter's friend
      // request. Idempotent + flag-gated, so safe to call on any sign-in.
      if (s?.user) consumePendingRef();
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // The SideQuest service worker posts a NAVIGATE message when a user clicks
  // a notification whose target URL is outside the SQ scope (e.g. a Wordy or
  // Rungles game board). Without this listener, the SW focuses an existing
  // SQ tab but the tab never actually navigates to the deep link.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    function handleSWMessage(event) {
      if (event.data?.type === 'NAVIGATE' && typeof event.data.url === 'string') {
        window.location.href = event.data.url;
      }
    }
    navigator.serviceWorker.addEventListener('message', handleSWMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleSWMessage);
  }, []);

  // Load the account lifecycle state whenever we have a (non-recovery) session.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId || isRecovery) {
      setLifecycle(null);
      return;
    }
    let active = true;
    setLifecycleLoading(true);
    supabase
      .from('profiles')
      .select('deactivated_at, delete_after, is_anonymized')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        // Precaution for a stale session: the token is still valid but the
        // account's profile is gone or already anonymized (e.g. a tab left open
        // past the deletion sweep, or the row removed out-of-band). Sign out
        // cleanly rather than rendering the app for an account that's gone.
        // Only act on a definitive answer (no query error), so a transient
        // fetch failure never logs anyone out.
        if (!error && (data === null || data?.is_anonymized)) {
          // scope:'local' clears the session without a server round-trip, which
          // would otherwise fail when the underlying auth user is already gone.
          supabase.auth.signOut({ scope: 'local' });
          return;
        }
        setLifecycle(data ?? {});
        setLifecycleLoading(false);
      });
    return () => { active = false; };
  }, [userId, isRecovery]);

  const deactivated = !!lifecycle?.deactivated_at;

  // Honor a validated ?return= redirect once we have a session, the user isn't
  // mid password-recovery, and the account is active (never bounce a deactivated
  // account straight into a game).
  useEffect(() => {
    if (loading || !session || isRecovery) return;
    if (!lifecycle || deactivated) return;
    const ret = getValidatedReturn();
    if (ret) window.location.replace(ret);
  }, [loading, session, isRecovery, lifecycle, deactivated]);

  if (loading) {
    return (
      <ThemeProvider>
        <div className="min-h-screen flex items-center justify-center bg-wordy-50">
          <div className="text-wordy-600 font-body">Loading...</div>
        </div>
      </ThemeProvider>
    );
  }

  function renderMain() {
    if (!session || isRecovery) {
      return (
        <AuthPage
          isRecovery={isRecovery}
          onPasswordReset={() => setIsRecovery(false)}
        />
      );
    }
    // Wait for the lifecycle row so we never flash the lobby for a deactivated account.
    if (lifecycleLoading || !lifecycle) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-wordy-50">
          <div className="text-wordy-600 font-body">Loading...</div>
        </div>
      );
    }
    if (deactivated) {
      return (
        <ReactivateScreen
          profile={lifecycle}
          onReactivated={() => setLifecycle({ ...lifecycle, deactivated_at: null, delete_after: null })}
        />
      );
    }
    return <LandingPage session={session} />;
  }

  return (
    <ThemeProvider>
      <Toaster position="top-center" />
      {renderMain()}
    </ThemeProvider>
  );
}
