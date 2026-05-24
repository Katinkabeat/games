import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Landing surface for the email confirmation link (/games/?delete_confirm=TOKEN).
// Calls the sq-account-delete edge function to validate the token and schedule
// the 30-day deletion. Works whether or not the visitor is logged in.
export default function DeleteConfirmPage({ token }) {
  const [state, setState] = useState('working'); // 'working' | 'done' | 'error'
  const [deleteDate, setDeleteDate] = useState(null);
  const [msg, setMsg] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard React StrictMode double-invoke
    ran.current = true;
    (async () => {
      const { data, error } = await supabase.functions.invoke('sq-account-delete', {
        body: { action: 'confirm', token },
      });
      if (!error && data?.ok) {
        setDeleteDate(
          data.deleteAfter
            ? new Date(data.deleteAfter).toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric',
              })
            : null
        );
        setState('done');
        return;
      }
      let reason = '';
      try { reason = (await error?.context?.json())?.error ?? ''; } catch { /* ignore */ }
      setMsg(
        reason === 'expired_token'
          ? 'This link has expired. Start the deletion again from Settings to get a fresh link.'
          : reason === 'invalid_token'
            ? 'This link is invalid or has already been used.'
            : 'Something went wrong confirming your request. Please try again from Settings.'
      );
      setState('error');
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-100 p-4">
      <div className="card w-full max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-wordy-600 flex items-center justify-center mb-4 mx-auto shadow-md">
          <span className="font-display text-2xl text-white">SQ</span>
        </div>

        {state === 'working' && (
          <p className="text-sm text-wordy-600">Confirming your request…</p>
        )}

        {state === 'done' && (
          <>
            <h1 className="font-display text-2xl text-wordy-800 mb-2">Deletion confirmed</h1>
            <p className="text-sm text-wordy-600 mb-6">
              Your account is now locked{deleteDate ? ` and will be permanently deleted on ${deleteDate}` : ''}.
              Changed your mind? Just log back in any time before then to cancel.
            </p>
            <a href="/games/" className="btn-primary inline-block">Back to Side Quest</a>
          </>
        )}

        {state === 'error' && (
          <>
            <h1 className="font-display text-2xl text-wordy-800 mb-2">Couldn’t confirm</h1>
            <p className="text-sm text-wordy-600 mb-6">{msg}</p>
            <a href="/games/" className="btn-primary inline-block">Back to Side Quest</a>
          </>
        )}
      </div>
    </div>
  );
}
