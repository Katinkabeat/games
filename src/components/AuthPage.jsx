import { useState, useRef } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAACrUqndWqt4-0ExK';

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef(null);

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
      redirectTo: `${window.location.origin}/wordy/`,
      captchaToken,
    });
    captchaRef.current?.reset();
    setCaptchaToken('');
    if (error) toast.error(error.message);
    else toast.success('Password reset email sent');
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
