import { useEffect, useRef, useState } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';
import {
  getPushPermissionState,
  hasActivePushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/pushNotifications.js';

const PW_RULES = { number: /\d/, special: /[^A-Za-z0-9]/ };

// Mirror AuthPage's key. The project enforces a Turnstile captcha on
// signInWithPassword (verified live: the token endpoint returns
// captcha_failed without a token), so the current-password re-auth below
// must supply one. Rendered interaction-only so it stays invisible unless
// Cloudflare actually wants a challenge.
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAACrUqndWqt4-0ExK';

export default function SettingsDropdown({
  email,
  username,
  isDark,
  toggleTheme,
  isAdmin,
  pendingFriendCount = 0,
  onOpenAdmin,
  onOpenFriends,
  onOpenNotifications,
  onOpenInvitePrefs,
  onOpenFeedback,
  onLogout,
  onClose,
  userId,
}) {
  const dropdownRef = useRef(null);

  const [notifyState, setNotifyState] = useState('loading');
  const [notifyBusy, setNotifyBusy] = useState(false);

  const [changingPw, setChangingPw] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [showOldPw, setShowOldPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwCaptchaToken, setPwCaptchaToken] = useState('');
  const pwCaptchaRef = useRef(null);

  // Account lifecycle: 'deactivate' (password-confirmed) | 'delete' (email-confirmed).
  const [acctMode, setAcctMode] = useState(null);
  const [acctPw, setAcctPw] = useState(''); // holds the typed "DEACTIVATE" confirmation
  const [acctBusy, setAcctBusy] = useState(false);

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    (async () => {
      const perm = getPushPermissionState();
      if (perm === 'unsupported') {
        if (active) setNotifyState('unsupported');
        return;
      }
      if (perm === 'denied') {
        if (active) setNotifyState('denied');
        return;
      }
      const has = await hasActivePushSubscription();
      if (active) setNotifyState(has ? 'on' : 'off');
    })();
    return () => { active = false; };
  }, []);

  async function handleToggleNotify() {
    if (notifyBusy) return;
    if (notifyState === 'unsupported') {
      toast.error('Notifications are not supported in this browser');
      return;
    }
    if (notifyState === 'denied') {
      toast.error('Notifications are blocked â€” enable them in your browser settings');
      return;
    }
    setNotifyBusy(true);
    if (notifyState === 'on') {
      const ok = await unsubscribeFromPush(userId);
      if (ok) {
        setNotifyState('off');
        toast.success('Notifications turned off');
      } else {
        toast.error('Could not turn off notifications');
      }
    } else {
      const ok = await subscribeToPush(userId);
      if (ok) {
        setNotifyState('on');
        toast.success('Notifications turned on');
      } else if (Notification.permission === 'denied') {
        setNotifyState('denied');
        toast.error('Notifications are blocked â€” enable them in your browser settings');
      } else {
        toast.error('Could not turn on notifications');
      }
    }
    setNotifyBusy(false);
  }

  function cancelPwChange() {
    setOldPw('');
    setNewPw('');
    setConfirmPw('');
    setShowOldPw(false);
    setShowNewPw(false);
    setShowConfirmPw(false);
    setChangingPw(false);
    setPwCaptchaToken('');
    pwCaptchaRef.current?.reset();
  }

  async function handlePasswordChange() {
    if (!oldPw) return toast.error('Enter your current password');
    if (newPw.length < 6) return toast.error('New password must be at least 6 characters');
    if (!PW_RULES.number.test(newPw)) return toast.error('New password must include a number');
    if (!PW_RULES.special.test(newPw)) return toast.error('New password must include a special character');
    if (newPw !== confirmPw) return toast.error("New passwords don't match");
    if (!pwCaptchaToken) {
      // interaction-only widget normally has a token ready by submit time; if a
      // challenge is mid-flight, ask the user to retry rather than hit the
      // captcha-guarded endpoint without a token.
      return toast.error("Just a moment â€” still verifying. Try again.");
    }

    setSavingPw(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password: oldPw,
        options: { captchaToken: pwCaptchaToken },
      });
      if (signInErr) {
        toast.error('Current password is incorrect');
        return;
      }
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw });
      if (updateErr) throw updateErr;
      toast.success('Password updated!');
      cancelPwChange();
    } catch (err) {
      toast.error(err.message);
    } finally {
      // Turnstile tokens are single-use â€” refresh for any retry.
      setPwCaptchaToken('');
      pwCaptchaRef.current?.reset();
      setSavingPw(false);
    }
  }

  function cancelAcct() {
    setAcctMode(null);
    setAcctPw('');
  }

  async function handleDeactivate() {
    // Typed confirmation rather than password re-auth: the project enforces a
    // Turnstile captcha on signInWithPassword, which can't be satisfied from this
    // dropdown. Deactivation is fully reversible, so a deliberate typed confirm is
    // an appropriate gate.
    if (acctPw.trim().toUpperCase() !== 'DEACTIVATE') {
      return toast.error('Type DEACTIVATE to confirm');
    }
    setAcctBusy(true);
    try {
      const { error } = await supabase.rpc('deactivate_account');
      if (error) throw error;
      toast.success('Account deactivated. Log in any time to reactivate.');
      await supabase.auth.signOut();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAcctBusy(false);
    }
  }

  async function handleRequestDelete() {
    setAcctBusy(true);
    toast.dismiss(); // clear any stale toasts so the result is unambiguous
    try {
      const { data, error } = await supabase.functions.invoke('sq-account-delete', {
        body: { action: 'request' },
      });
      if (error || data?.error) throw new Error(data?.error || 'request_failed');
      toast.success('Check your email for a link to confirm deletion.');
      cancelAcct();
    } catch (e) {
      console.error('[sq-account-delete] request failed', e);
      toast.error('Could not start deletion. Please try again.');
    } finally {
      setAcctBusy(false);
    }
  }

  const hasNumber = PW_RULES.number.test(newPw);
  const hasSpecial = PW_RULES.special.test(newPw);
  const longEnough = newPw.length >= 6;
  const pwMatch = newPw && confirmPw && newPw === confirmPw;

  return (
    <div ref={dropdownRef} className="settings-dropdown card grouped">

      {/* â”€â”€ Profile â”€â”€ */}
      <div className="settings-group">
        <div className="settings-group-head">Profile</div>
        <div className="settings-row">
          <span className="text-sm font-bold text-wordy-600">Name</span>
          <span className="text-sm font-bold text-wordy-700">{username ?? 'â€¦'}</span>
        </div>

      <div className={changingPw ? 'settings-section' : 'settings-row'}>
        {!changingPw ? (
          <>
            <span className="text-sm font-bold text-wordy-600">Password</span>
            <button
              onClick={() => setChangingPw(true)}
              className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
            >
              Change
            </button>
          </>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-wordy-600">Change Password</span>
              <button onClick={cancelPwChange} className="text-xs font-bold text-wordy-400 hover:text-wordy-600">
                âœ•
              </button>
            </div>

            <div className="relative">
              <input
                type={showOldPw ? 'text' : 'password'}
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
                placeholder="Current password"
                className="w-full px-2 py-1.5 pr-8 rounded-lg border-2 border-wordy-200 text-xs font-bold text-wordy-700 focus:border-wordy-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowOldPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-wordy-400 hover:text-wordy-700 text-xs"
              >
                {showOldPw ? 'ðŸ™ˆ' : 'ðŸ‘ï¸'}
              </button>
            </div>

            <div className="relative">
              <input
                type={showNewPw ? 'text' : 'password'}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="New password"
                className="w-full px-2 py-1.5 pr-8 rounded-lg border-2 border-wordy-200 text-xs font-bold text-wordy-700 focus:border-wordy-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowNewPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-wordy-400 hover:text-wordy-700 text-xs"
              >
                {showNewPw ? 'ðŸ™ˆ' : 'ðŸ‘ï¸'}
              </button>
            </div>

            <div className="relative">
              <input
                type={showConfirmPw ? 'text' : 'password'}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Confirm new password"
                className={`w-full px-2 py-1.5 pr-8 rounded-lg border-2 text-xs font-bold text-wordy-700 focus:outline-none ${
                  confirmPw && !pwMatch
                    ? 'border-rose-400 focus:border-rose-500'
                    : 'border-wordy-200 focus:border-wordy-400'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-wordy-400 hover:text-wordy-700 text-xs"
              >
                {showConfirmPw ? 'ðŸ™ˆ' : 'ðŸ‘ï¸'}
              </button>
            </div>

            <div className="text-xs space-y-0.5 pl-0.5">
              <p className={longEnough ? 'text-green-600' : 'text-wordy-400'}>
                {longEnough ? 'âœ“' : 'â—‹'} At least 6 characters
              </p>
              <p className={hasNumber ? 'text-green-600' : 'text-wordy-400'}>
                {hasNumber ? 'âœ“' : 'â—‹'} Contains a number
              </p>
              <p className={hasSpecial ? 'text-green-600' : 'text-wordy-400'}>
                {hasSpecial ? 'âœ“' : 'â—‹'} Contains a special character
              </p>
              {confirmPw && !pwMatch && <p className="text-rose-500">âœ— Passwords don't match</p>}
            </div>

            {TURNSTILE_SITE_KEY && (
              <Turnstile
                ref={pwCaptchaRef}
                siteKey={TURNSTILE_SITE_KEY}
                options={{ appearance: 'interaction-only' }}
                onSuccess={setPwCaptchaToken}
                onExpire={() => setPwCaptchaToken('')}
              />
            )}

            <button
              onClick={handlePasswordChange}
              disabled={savingPw}
              className="w-full text-xs font-bold text-white bg-wordy-600 px-2 py-1.5 rounded-lg hover:bg-wordy-500 disabled:opacity-60"
            >
              {savingPw ? 'â³ Savingâ€¦' : 'ðŸ”‘ Update Password'}
            </button>
          </div>
        )}
      </div>
      </div>

      {/* â”€â”€ Admin (admin-only; kept near the top so it isn't buried) â”€â”€ */}
      {isAdmin && (
        <div className="settings-group">
          <div className="settings-group-head">Admin</div>
          <div className="settings-row">
            <span className="text-sm font-bold text-wordy-600">Admin panel</span>
            <button
              onClick={() => {
                onOpenAdmin();
                onClose();
              }}
              className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
            >
              ðŸ” Open
            </button>
          </div>
        </div>
      )}

      {/* â”€â”€ Preferences â”€â”€ */}
      <div className="settings-group">
        <div className="settings-group-head">Preferences</div>
      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">Theme</span>
        <button
          onClick={toggleTheme}
          className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
        >
          {isDark ? 'â˜€ï¸ Light' : 'ðŸŒ™ Dark'}
        </button>
      </div>

      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">Notifications</span>
        <button
          onClick={() => {
            onOpenNotifications?.();
            onClose();
          }}
          disabled={notifyState === 'unsupported'}
          className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors disabled:opacity-50"
        >
          ðŸ”” Open
        </button>
      </div>

      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">Invites</span>
        <button
          onClick={() => {
            onOpenInvitePrefs?.();
            onClose();
          }}
          className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
        >
          âœ‰ï¸ Open
        </button>
      </div>
      </div>

      {/* â”€â”€ Social â”€â”€ */}
      <div className="settings-group">
        <div className="settings-group-head">Social</div>
      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600 flex items-center gap-1.5">
          Friends
          {pendingFriendCount > 0 && (
            <span
              className="inline-block w-2 h-2 rounded-full bg-red-500"
              aria-label={`${pendingFriendCount} pending friend request${pendingFriendCount === 1 ? '' : 's'}`}
            />
          )}
        </span>
        <button
          onClick={() => {
            onOpenFriends?.();
            onClose();
          }}
          className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
        >
          ðŸ‘¥ Open
        </button>
      </div>

      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">Feedback</span>
        <button
          onClick={() => {
            onOpenFeedback?.();
            onClose();
          }}
          className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
        >
          âœ‰ï¸ Send
        </button>
      </div>
      </div>

      {/* â”€â”€ About â”€â”€ */}
      <div className="settings-group">
        <div className="settings-group-head">About</div>
        <div className="settings-row">
          <span className="text-sm font-bold text-wordy-600">Privacy policy</span>
          <a
            href="/games/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
          >
            Open
          </a>
        </div>
        <div className="settings-row">
          <span className="text-sm font-bold text-wordy-600">Terms</span>
          <a
            href="/games/terms.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
          >
            Open
          </a>
        </div>
      </div>

      {/* â”€â”€ Account â”€â”€ */}
      <div className="settings-group">
        <div className="settings-group-head">Account</div>
      {acctMode === null ? (
        <>
          <button
            onClick={() => setAcctMode('deactivate')}
            className="settings-row text-sm font-bold w-full text-left text-wordy-700 hover:text-wordy-500 transition-colors"
          >
            <span>Deactivate</span>
            <span className="text-wordy-400">â†’</span>
          </button>
          <button
            onClick={() => setAcctMode('delete')}
            className="settings-row text-sm font-bold w-full text-left text-rose-500 hover:text-rose-700 transition-colors"
          >
            <span>Delete account</span>
            <span>â†’</span>
          </button>
        </>
      ) : acctMode === 'deactivate' ? (
        <div className="settings-section space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-wordy-600">Deactivate account</span>
            <button onClick={cancelAcct} className="text-xs font-bold text-wordy-400 hover:text-wordy-600">âœ•</button>
          </div>
          <p className="text-xs text-wordy-500">
            Locks your account and hides you from games. Nothing is deleted â€” log back in any time to reactivate.
            Type <span className="font-bold">DEACTIVATE</span> to confirm.
          </p>
          <input
            type="text"
            value={acctPw}
            onChange={(e) => setAcctPw(e.target.value)}
            placeholder="Type DEACTIVATE"
            autoCapitalize="characters"
            className="w-full px-2 py-1.5 rounded-lg border-2 border-wordy-200 text-xs font-bold text-wordy-700 focus:border-wordy-400 focus:outline-none"
          />
          <button
            onClick={handleDeactivate}
            disabled={acctBusy || acctPw.trim().toUpperCase() !== 'DEACTIVATE'}
            className="w-full text-xs font-bold text-white bg-wordy-600 px-2 py-1.5 rounded-lg hover:bg-wordy-500 disabled:opacity-60"
          >
            {acctBusy ? 'â³ Workingâ€¦' : 'Deactivate my account'}
          </button>
        </div>
      ) : (
        <div className="settings-section space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-rose-500">Delete account</span>
            <button onClick={cancelAcct} className="text-xs font-bold text-wordy-400 hover:text-wordy-600">âœ•</button>
          </div>
          <p className="text-xs text-wordy-500">
            Weâ€™ll email you a confirmation link. After you confirm, your account is locked and permanently
            deleted in 30 days (cancel any time by logging back in). Your scores stay on the leaderboards but
            are anonymized.
          </p>
          <button
            onClick={handleRequestDelete}
            disabled={acctBusy}
            className="w-full text-xs font-bold text-white bg-rose-500 px-2 py-1.5 rounded-lg hover:bg-rose-600 disabled:opacity-60"
          >
            {acctBusy ? 'â³ Sendingâ€¦' : 'Email me a confirmation link'}
          </button>
        </div>
      )}

        <button
          onClick={onLogout}
          className="settings-row text-sm font-bold w-full text-left text-rose-500 hover:text-rose-700 transition-colors"
        >
          <span>Log out</span>
          <span>â†’</span>
        </button>
      </div>
    </div>
  );
}
