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
          onClick={handleToggleNotify}
          disabled={notifyBusy || notifyState === 'loading' || notifyState === 'unsupported'}
          className="text-sm font-bold text-wordy-700 hover:text-wordy-500 transition-colors disabled:opacity-60"
        >
          {notifyState === 'loading' && '…'}
          {notifyState === 'on' && '🔔 On'}
          {notifyState === 'off' && '🔕 Off'}
          {notifyState === 'denied' && 'Blocked'}
          {notifyState === 'unsupported' && 'Not supported'}
        </button>
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
