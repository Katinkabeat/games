import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { supabase } from './lib/supabase.js';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import AuthPage from './components/AuthPage.jsx';
import LandingPage from './components/LandingPage.jsx';
import StyleGuidePage from './components/StyleGuidePage.jsx';

// Allowlist of path prefixes the post-login ?return= redirect will honor.
// Add new SQ games here when scaffolding them so notifications and bookmarks
// survive a logged-out re-entry.
const ALLOWED_RETURN_PREFIXES = ['/wordy/', '/rungles/'];

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

export default function App() {
  if (isStyleGuide) {
    return (
      <ThemeProvider>
        <StyleGuidePage />
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
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

  // Honor a validated ?return= redirect once we have a session and the user
  // isn't in the middle of a password recovery flow.
  useEffect(() => {
    if (loading || !session || isRecovery) return;
    const ret = getValidatedReturn();
    if (ret) window.location.replace(ret);
  }, [loading, session, isRecovery]);

  if (loading) {
    return (
      <ThemeProvider>
        <div className="min-h-screen flex items-center justify-center bg-wordy-50">
          <div className="text-wordy-600 font-body">Loading...</div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <Toaster position="top-center" />
      {session && !isRecovery ? (
        <LandingPage session={session} />
      ) : (
        <AuthPage
          isRecovery={isRecovery}
          onPasswordReset={() => setIsRecovery(false)}
        />
      )}
    </ThemeProvider>
  );
}
