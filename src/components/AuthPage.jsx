import { useState, useRef } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAACrUqndWqt4-0ExK';

// Gates the public Sign up tab. Keep false until signups are intentionally
// opened — must be flipped in lockstep with the server's disable_signup flag
// (see c131). Defaults off so the tab never shows to the public by accident.
const SIGNUPS_OPEN = import.meta.env.VITE_SIGNUPS_OPEN === 'true';

export default function AuthPage({ isRecovery = false, onPasswordReset = () => {} }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef(null);
  const [mode, setMode] = useState('signin');
  const [pendingEmail, setPendingEmail] = useState('');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [newConfirm, setNewConfirm] = useState('');
  const [showNewPass, setShowNewPass] = useState(false);
  const [showNewConfirm, setShowNewConfirm] = useState(false);

  async function handleNewPassword(e) {
    e.preventDefault();
    if (newPass.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (newPass !== newConfirm) {
      toast.error('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) throw error;
      toast.success('Password updated! Welcome back.');
      onPasswordReset();
    } catch (err) {
      toast.error(err.message ?? 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const options = captchaToken ? { captchaToken } : undefined;
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
      options,
    });

    if (error) {
      if (/not confirmed/i.test(error.message)) {
        setUnconfirmed(true);
      } else {
        toast.error(error.message);
      }
      captchaRef.current?.reset();
      setCaptchaToken('');
      setSubmitting(false);
    }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setSubmitting(true);

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/games/`,
        ...(captchaToken ? { captchaToken } : {}),
      },
    });

    captchaRef.current?.reset();
    setCaptchaToken('');
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setPendingEmail(email.trim());
  }

  async function handleResend() {
    const target = (pendingEmail || email).trim();
    if (!target) {
      toast.error('Enter your email first');
      return;
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: target,
      options: {
        emailRedirectTo: `${window.location.origin}/games/`,
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
    captchaRef.current?.reset();
    setCaptchaToken('');
    if (error) toast.error(error.message);
    else toast.success('Confirmation email sent');
  }

  function switchMode(next) {
    setMode(next);
    setUnconfirmed(false);
  }

  async function handleReset() {
    if (!email.trim()) {
      toast.error('Enter your email first');
      return;
    }
    if (!captchaToken) {
      toast.error('Complete the captcha first');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/games/`,
      captchaToken,
    });
    captchaRef.current?.reset();
    setCaptchaToken('');
    if (error) toast.error(error.message);
    else toast.success('Password reset email sent');
  }

  if (isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-100 p-4">
        <div className="card w-full max-w-md">
          <div className="flex flex-col items-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-wordy-600 flex items-center justify-center mb-3 shadow-md">
              <span className="font-display text-2xl text-white">SQ</span>
            </div>
            <h1 className="font-display text-2xl text-wordy-800">Set a new password</h1>
            <p className="text-sm text-wordy-600 mt-1">Choose a new password to finish resetting</p>
          </div>

          <form onSubmit={handleNewPassword} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-wordy-700 mb-1">New password</label>
              <div className="relative">
                <input
                  type={showNewPass ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  className="w-full px-3 py-2 pr-14 border-2 border-wordy-200 rounded-xl focus:border-wordy-400 focus:outline-none"
                  placeholder="At least 6 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPass(!showNewPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-wordy-500 text-sm font-bold"
                >
                  {showNewPass ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-wordy-700 mb-1">Confirm new password</label>
              <div className="relative">
                <input
                  type={showNewConfirm ? 'text' : 'password'}
                  required
                  value={newConfirm}
                  onChange={(e) => setNewConfirm(e.target.value)}
                  className={`w-full px-3 py-2 pr-14 border-2 rounded-xl focus:outline-none ${
                    newConfirm && newConfirm !== newPass
                      ? 'border-rose-400 focus:border-rose-500'
                      : 'border-wordy-200 focus:border-wordy-400'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowNewConfirm(!showNewConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-wordy-500 text-sm font-bold"
                >
                  {showNewConfirm ? 'Hide' : 'Show'}
                </button>
              </div>
              {newConfirm && newConfirm !== newPass && (
                <p className="text-xs text-rose-500 mt-1">Passwords don't match</p>
              )}
            </div>

            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Updating...' : 'Update password'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (pendingEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-100 p-4">
        <div className="card w-full max-w-md text-center">
          <div className="text-5xl mb-2">✉️</div>
          <h1 className="font-display text-2xl text-wordy-800 mb-2">Check your email</h1>
          <p className="text-sm text-wordy-600">We sent a confirmation link to</p>
          <p className="text-sm font-bold text-wordy-700 mb-3">{pendingEmail}</p>
          <p className="text-sm text-wordy-600 mb-5">
            Click the link in that email to verify your account, then come back and sign in.
          </p>
          <button type="button" onClick={handleResend} className="btn-secondary w-full">
            Resend confirmation email
          </button>
          <div className="flex justify-center text-sm pt-3">
            <button
              type="button"
              onClick={() => { setPendingEmail(''); switchMode('signin'); }}
              className="text-wordy-600 hover:text-wordy-800 underline"
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isSignUp = SIGNUPS_OPEN && mode === 'signup';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-100 p-4">
      <div className="card w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-wordy-600 flex items-center justify-center mb-3 shadow-md">
            <span className="font-display text-2xl text-white">SQ</span>
          </div>
          <h1 className="font-display text-3xl text-wordy-800">Rae's Side Quest</h1>
          <p className="text-sm text-wordy-600 mt-1">
            {isSignUp ? 'Create an account to play' : 'Sign in to play'}
          </p>
        </div>

        {SIGNUPS_OPEN && (
          <div className="flex bg-wordy-100 rounded-xl p-1 mb-5">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                !isSignUp ? 'bg-white text-wordy-800 shadow-sm' : 'text-wordy-600'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                isSignUp ? 'bg-white text-wordy-800 shadow-sm' : 'text-wordy-600'
              }`}
            >
              Sign up
            </button>
          </div>
        )}

        {unconfirmed && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 mb-4 text-sm text-amber-800">
            <strong className="block mb-1">Your email isn't confirmed yet</strong>
            Check your inbox for the confirmation link, or{' '}
            <button
              type="button"
              onClick={handleResend}
              className="font-bold underline"
            >
              resend it
            </button>
            .
          </div>
        )}

        <form onSubmit={isSignUp ? handleSignUp : handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-wordy-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border-2 border-wordy-200 rounded-xl focus:border-wordy-400 focus:outline-none"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-wordy-700 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={isSignUp ? 6 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 pr-14 border-2 border-wordy-200 rounded-xl focus:border-wordy-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-wordy-500 text-sm font-bold"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {isSignUp && (
              <p className="text-xs text-wordy-500 mt-1">At least 6 characters</p>
            )}
          </div>

          {TURNSTILE_SITE_KEY && (
            <div className="flex justify-center items-center h-[80px]">
              <Turnstile
                ref={captchaRef}
                siteKey={TURNSTILE_SITE_KEY}
                onSuccess={setCaptchaToken}
              />
            </div>
          )}

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting
              ? (isSignUp ? 'Creating account...' : 'Signing in...')
              : (isSignUp ? 'Sign up' : 'Sign in')}
          </button>

          {!isSignUp && (
            <div className="flex justify-center text-sm pt-1">
              <button
                type="button"
                onClick={handleReset}
                className="text-wordy-600 hover:text-wordy-800 underline"
              >
                Forgot password?
              </button>
            </div>
          )}
        </form>

        <div className="flex justify-center gap-4 text-xs text-wordy-500 mt-6 pt-4 border-t border-wordy-100">
          <a href="/games/privacy.html" className="hover:text-wordy-700 underline">Privacy</a>
          <a href="/games/terms.html" className="hover:text-wordy-700 underline">Terms</a>
        </div>
      </div>
    </div>
  );
}
