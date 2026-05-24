import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';
import {
  getPushPermissionState,
  hasActivePushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/pushNotifications.js';

const PW_RULES = { number: /\d/, special: /[^A-Za-z0-9]/ };

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
  onOpenFeedback,
  onLogout,
  onClose,
  userId,
}) {
  const dropdownRef = useRef(null);

  const [notifyState, setNotifyState] = useState('loading');
  const [notifyBusy, setNotifyBusy] = useState(false);

  // Invitability privacy setting — who can invite this user to games.
  // 'everyone' | 'friends_only' (default) | 'nobody'.
  const [invitability, setInvitability] = useState('friends_only');
  const [savingInvitability, setSavingInvitability] = useState(false);

  const [changingPw, setChangingPw] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [showOldPw, setShowOldPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

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

  // Load current invitability from profiles.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('invitability')
        .eq('id', userId)
        .maybeSingle();
      if (active && data?.invitability) setInvitability(data.invitability);
    })();
    return () => { active = false; };
  }, [userId]);

  async function handleInvitabilityChange(next) {
    if (next === invitability || savingInvitability) return;
    const prev = invitability;
    setInvitability(next); // optimistic
    setSavingInvitability(true);
    const { error } = await supabase
      .from('profiles')
      .update({ invitability: next })
      .eq('id', userId);
    setSavingInvitability(false);
    if (error) {
      setInvitability(prev);
      toast.error(error.message);
    }
  }

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
      toast.error('Notifications are blocked — enable them in your browser settings');
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
        toast.error('Notifications are blocked — enable them in your browser settings');
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
  }

  async function handlePasswordChange() {
    if (!oldPw) return toast.error('Enter your current password');
    if (newPw.length < 6) return toast.error('New password must be at least 6 characters');
    if (!PW_RULES.number.test(newPw)) return toast.error('New password must include a number');
    if (!PW_RULES.special.test(newPw)) return toast.error('New password must include a special character');
    if (newPw !== confirmPw) return toast.error("New passwords don't match");

    setSavingPw(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: oldPw });
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
    <div ref={dropdownRef} className="settings-dropdown card">
      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">Name</span>
        <span className="text-sm font-bold text-wordy-700">{username ?? '…'}</span>
      </div>

      <div className={changingPw ? 'settings-section' : 'settings-row'}>
        {!changingPw ? (
          <>
            <span className="text-sm font-bold text-wordy-600">Password</span>
            <button
              onClick={() => setChangingPw(true)}
              className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors flex items-center gap-1"
            >
              Change <span className="text-xs text-wordy-400">✏️</span>
            </button>
          </>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-wordy-600">Change Password</span>
              <button onClick={cancelPwChange} className="text-xs font-bold text-wordy-400 hover:text-wordy-600">
                ✕
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
                {showOldPw ? '🙈' : '👁️'}
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
                {showNewPw ? '🙈' : '👁️'}
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
                {showConfirmPw ? '🙈' : '👁️'}
              </button>
            </div>

            <div className="text-xs space-y-0.5 pl-0.5">
              <p className={longEnough ? 'text-green-600' : 'text-wordy-400'}>
                {longEnough ? '✓' : '○'} At least 6 characters
              </p>
              <p className={hasNumber ? 'text-green-600' : 'text-wordy-400'}>
                {hasNumber ? '✓' : '○'} Contains a number
              </p>
              <p className={hasSpecial ? 'text-green-600' : 'text-wordy-400'}>
                {hasSpecial ? '✓' : '○'} Contains a special character
              </p>
              {confirmPw && !pwMatch && <p className="text-rose-500">✗ Passwords don't match</p>}
            </div>

            <button
              onClick={handlePasswordChange}
              disabled={savingPw}
              className="w-full text-xs font-bold text-white bg-wordy-600 px-2 py-1.5 rounded-lg hover:bg-wordy-500 disabled:opacity-60"
            >
              {savingPw ? '⏳ Saving…' : '🔑 Update Password'}
            </button>
          </div>
        )}
      </div>

      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">Theme</span>
        <button
          onClick={toggleTheme}
          className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
        >
          {isDark ? '☀️ Light' : '🌙 Dark'}
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
          🔔 Open
        </button>
      </div>

      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">Invites</span>
        <InvitabilityPicker
          value={invitability}
          disabled={savingInvitability}
          onChange={handleInvitabilityChange}
        />
      </div>

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
          👥 Open
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
          ✉️ Send
        </button>
      </div>

      <div className="settings-row">
        <span className="text-sm font-bold text-wordy-600">Legal</span>
        <span className="flex items-center gap-3">
          <a
            href="/games/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
          >
            Privacy
          </a>
          <a
            href="/games/terms.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
          >
            Terms
          </a>
        </span>
      </div>

      {isAdmin && (
        <div className="settings-row">
          <span className="text-sm font-bold text-wordy-600">Admin</span>
          <button
            onClick={() => {
              onOpenAdmin();
              onClose();
            }}
            className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
          >
            🔐 Open
          </button>
        </div>
      )}

      {acctMode === null ? (
        <div className="settings-row">
          <span className="text-sm font-bold text-wordy-600">Account</span>
          <span className="flex items-center gap-3">
            <button
              onClick={() => setAcctMode('deactivate')}
              className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors"
            >
              Deactivate
            </button>
            <button
              onClick={() => setAcctMode('delete')}
              className="text-sm font-bold text-rose-500 hover:text-rose-700 transition-colors"
            >
              Delete
            </button>
          </span>
        </div>
      ) : acctMode === 'deactivate' ? (
        <div className="settings-section space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-wordy-600">Deactivate account</span>
            <button onClick={cancelAcct} className="text-xs font-bold text-wordy-400 hover:text-wordy-600">✕</button>
          </div>
          <p className="text-xs text-wordy-500">
            Locks your account and hides you from games. Nothing is deleted — log back in any time to reactivate.
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
            {acctBusy ? '⏳ Working…' : 'Deactivate my account'}
          </button>
        </div>
      ) : (
        <div className="settings-section space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-rose-500">Delete account</span>
            <button onClick={cancelAcct} className="text-xs font-bold text-wordy-400 hover:text-wordy-600">✕</button>
          </div>
          <p className="text-xs text-wordy-500">
            We’ll email you a confirmation link. After you confirm, your account is locked and permanently
            deleted in 30 days (cancel any time by logging back in). Your scores stay on the leaderboards but
            are anonymized.
          </p>
          <button
            onClick={handleRequestDelete}
            disabled={acctBusy}
            className="w-full text-xs font-bold text-white bg-rose-500 px-2 py-1.5 rounded-lg hover:bg-rose-600 disabled:opacity-60"
          >
            {acctBusy ? '⏳ Sending…' : 'Email me a confirmation link'}
          </button>
        </div>
      )}

      <div className="settings-row">
        <button
          onClick={onLogout}
          className="text-sm font-bold text-rose-500 hover:text-rose-700 transition-colors"
        >
          Log out
        </button>
      </div>
    </div>
  );
}

// Custom three-option picker for profiles.invitability. We use this
// instead of a native <select> because the OS-rendered open popup
// doesn't reliably respect color-scheme: dark across browsers, and
// the result is a blinding white menu in dark mode.
const INVITE_OPTIONS = [
  { value: 'everyone',     label: 'Anyone' },
  { value: 'friends_only', label: 'Friends only' },
  { value: 'nobody',       label: 'Nobody' },
];

function InvitabilityPicker({ value, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const current = INVITE_OPTIONS.find((o) => o.value === value) ?? INVITE_OPTIONS[1];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="text-sm font-bold text-wordy-700 bg-white border-2 border-wordy-200 hover:border-wordy-400 px-2 py-1 rounded-lg disabled:opacity-60 cursor-pointer flex items-center gap-1"
      >
        <span>{current.label}</span>
        <span className="text-xs text-wordy-400">▾</span>
      </button>
      {open && (
        <ul className="absolute right-0 top-full mt-1 w-32 card dropdown-surface p-1 z-50 shadow-lg space-y-0.5">
          {INVITE_OPTIONS.map((opt) => {
            const selected = opt.value === value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onChange(opt.value);
                  }}
                  className={`w-full text-left text-sm font-bold px-2 py-1.5 rounded-md transition-colors ${
                    selected
                      ? 'text-wordy-700 bg-wordy-50'
                      : 'text-wordy-700 hover:bg-wordy-50'
                  }`}
                >
                  {selected ? '✓ ' : '   '}
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
