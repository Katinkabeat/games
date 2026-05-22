import { useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase.js';

const CATEGORIES = [
  { value: 'bug', label: '🐞 Bug' },
  { value: 'idea', label: '💡 Idea' },
  { value: 'other', label: '💬 Other' },
];

export default function FeedbackView({ onBack }) {
  const [category, setCategory] = useState('bug');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error('Type a message first');
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke('sq-feedback', {
        body: { category, message: trimmed, page: 'hub' },
      });
      if (error) throw error;
      toast.success('Thanks — your message was sent');
      setMessage('');
      onBack?.();
    } catch (err) {
      console.error('[FeedbackView] submit failed', err);
      toast.error('Could not send right now — please try again');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="max-w-[480px] mx-auto px-4 pb-12 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-wordy-800">Send feedback</h2>
        <button
          onClick={onBack}
          className="text-sm font-bold text-wordy-500 hover:text-wordy-700"
        >
          ← Back
        </button>
      </div>
      <p className="text-xs text-wordy-500">
        Found a bug, have an idea, or need to reach us? Send a note and it comes
        straight to us.
      </p>

      <section className="card space-y-3 p-4">
        <div className="flex gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={`flex-1 text-xs font-bold px-2 py-2 rounded-xl border-2 transition-colors ${
                category === c.value
                  ? 'border-wordy-400 bg-wordy-50 text-wordy-700'
                  : 'border-wordy-200 text-wordy-500 hover:border-wordy-300'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Tell us what's going on…"
          rows={5}
          maxLength={4000}
          className="w-full px-3 py-2 border-2 border-wordy-200 rounded-xl focus:border-wordy-400 focus:outline-none text-sm resize-none"
        />

        <button
          onClick={handleSend}
          disabled={sending}
          className="w-full text-sm font-bold text-white bg-wordy-600 px-2 py-2 rounded-lg hover:bg-wordy-500 disabled:opacity-60"
        >
          {sending ? '⏳ Sending…' : '📨 Send'}
        </button>
      </section>
    </main>
  );
}
