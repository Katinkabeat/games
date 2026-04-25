import { useState, useRef } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAACrUqndWqt4-0ExK';

export default function AuthPage({ isRecovery = false, onPasswordReset = () => {} }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef(null);
  const [newPass, setNewPass] = useState('');
  const [newConfirm, setNewConfirm] = useState('');
  const [showNewPass, setShowNewPass] = useState(false);

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
      toast.error(error.message);
      captchaRef.current?.reset();
      setCaptchaToken('');
      setSubmitting(false);
    }
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
              <span className="font-display text-3xl text-white">R</span>
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
              <input
                type={showNewPass ? 'text' : 'password'}
                required
                value={newConfirm}
                onChange={(e) => setNewConfirm(e.target.value)}
                className={`w-full px-3 py-2 border-2 rounded-xl focus:outline-none ${
                  newConfirm && newConfirm !== newPass
                    ? 'border-rose-400 focus:border-rose-500'
                    : 'border-wordy-200 focus:border-wordy-400'
                }`}
              />
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-100 p-4">
      <div className="card w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-wordy-600 flex items-center justify-center mb-3 shadow-md">
            <span className="font-display text-3xl text-white">R</span>
          </div>
          <h1 className="font-display text-3xl text-wordy-800">Rae's Side Quest</h1>
          <p className="text-sm text-wordy-600 mt-1">Sign in to play</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
          </div>

          {TURNSTILE_SITE_KEY && (
            <div className="flex justify-center">
              <Turnstile
                ref={captchaRef}
                siteKey={TURNSTILE_SITE_KEY}
                onSuccess={setCaptchaToken}
              />
            </div>
          )}

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>

          <div className="flex justify-center text-sm pt-1">
            <button
              type="button"
              onClick={handleReset}
              className="text-wordy-600 hover:text-wordy-800 underline"
            >
              Forgot password?
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
