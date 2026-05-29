// Friend referral links (card c135).
//
// DORMANT until activated: every entry point is gated by
// VITE_REFERRALS_ENABLED (default false). With the flag off, the invite
// UI ships greyed-out and none of the capture/consume logic runs.
//
// Flow when enabled:
//   1. A member generates a single-use token (sq_generate_referral_invite)
//      and shares .../games/?ref=<token>.
//   2. captureRefFromUrl() stashes ?ref= in localStorage on load — it must
//      survive the Supabase signup -> email-confirm round-trip, which a
//      bare URL param would not.
//   3. On the invitee's first confirmed login, consumePendingRef() calls
//      sq_consume_referral_invite(token), which creates a pending friend
//      request FROM the inviter, then clears the stored token.

import { supabase } from './supabase.js';

export const REFERRALS_ENABLED =
  import.meta.env.VITE_REFERRALS_ENABLED === 'true';

const REF_STORAGE_KEY = 'sq:pendingRef';

// Pull ?ref=<token> out of the URL (if present) and remember it. Called on
// app load, before auth resolves, so the token outlives the email-confirm
// redirect. No-op when referrals are disabled.
export function captureRefFromUrl() {
  if (!REFERRALS_ENABLED) return;
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) localStorage.setItem(REF_STORAGE_KEY, ref);
  } catch {
    // private mode / storage blocked — referral is best-effort, ignore.
  }
}

// If a referral token is waiting, consume it as the now-authenticated user,
// then clear it. Idempotent server-side, so a double-fire is harmless. Runs
// once we have a session. No-op when disabled or when nothing is stored.
export async function consumePendingRef() {
  if (!REFERRALS_ENABLED) return;
  let token = null;
  try {
    token = localStorage.getItem(REF_STORAGE_KEY);
  } catch {
    return;
  }
  if (!token) return;

  // Clear first so a failed call can't loop-retry forever on every load;
  // the token is single-use and the request, if created, is the payoff.
  try { localStorage.removeItem(REF_STORAGE_KEY); } catch {}

  const { error } = await supabase.rpc('sq_consume_referral_invite', {
    p_token: token,
  });
  // Silent on error: an expired/spent/self link is an expected outcome, not
  // something to interrupt a brand-new user's first load with.
  if (error) console.debug('[referral] consume skipped:', error.message);
}

// Generate a fresh single-use invite link for the current member. Returns the
// absolute URL to share, or throws (e.g. the 3-active cap) for the caller to
// surface.
export async function generateReferralLink() {
  const { data, error } = await supabase.rpc('sq_generate_referral_invite');
  if (error) throw error;
  return `${window.location.origin}/games/?ref=${data}`;
}
