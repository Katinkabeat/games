import { useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

// Shown after login when the signed-in account is deactivated (a reversible
// "break") or scheduled for deletion (within the 30-day grace window). Logging
// in is itself the proof of ownership, so reactivation is a single click here.
export default function ReactivateScreen({ profile, onReactivated }) {
  const [busy, setBusy] = useState(false);
  const pendingDeletion = !!profile?.delete_after;
  const deleteDate = pendingDeletion
    ? new Date(profile.delete_after).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  async function reactivate() {
    setBusy(true);
    const { data, error } = await supabase.rpc('reactivate_account');
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (data === false) {
      toast.error('This account can no longer be reactivated.');
      return;
    }
    toast.success('Welcome back!');
    onReactivated?.();
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-100 p-4">
      <div className="card w-full max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-wordy-600 flex items-center justify-center mb-4 mx-auto shadow-md">
          <span className="font-display text-3xl text-white">R</span>
        </div>
        <h1 className="font-display text-2xl text-wordy-800 mb-2">
          {pendingDeletion ? 'Account scheduled for deletion' : 'Account deactivated'}
        </h1>
        <p className="text-sm text-wordy-600 mb-6">
          {pendingDeletion
            ? `Your account is locked and will be permanently deleted on ${deleteDate}. Reactivate now to cancel and pick up right where you left off.`
            : 'Your account is deactivated. Reactivate whenever you’re ready to get back to your games.'}
        </p>
        <button onClick={reactivate} disabled={busy} className="btn-primary w-full mb-3">
          {busy
            ? 'Reactivating…'
            : pendingDeletion ? 'Cancel deletion & reactivate' : 'Reactivate my account'}
        </button>
        <button onClick={logout} className="text-sm text-wordy-600 hover:text-wordy-800 underline">
          Log out
        </button>
      </div>
    </div>
  );
}
