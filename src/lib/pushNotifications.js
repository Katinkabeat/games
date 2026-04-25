import { supabase } from './supabase.js';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const APP = 'sidequest';
const SW_PATH = '/games/sw.js';

export function getPushPermissionState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  return Notification.permission;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register(SW_PATH);
}

export async function subscribeToPush(userId) {
  if (!VAPID_PUBLIC_KEY) {
    console.error('VITE_VAPID_PUBLIC_KEY is not set');
    return false;
  }
  try {
    const registration = await registerServiceWorker();
    if (!registration) return false;

    const sw = await navigator.serviceWorker.ready;
    let subscription = await sw.pushManager.getSubscription();

    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const subJson = subscription.toJSON();
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        app: APP,
        endpoint: subJson.endpoint,
        keys_p256dh: subJson.keys.p256dh,
        keys_auth: subJson.keys.auth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,app' }
    );

    if (error) {
      console.error('Failed to save push subscription:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Push subscription failed:', err);
    return false;
  }
}

export async function unsubscribeFromPush(userId) {
  try {
    const sw = await navigator.serviceWorker.ready;
    const subscription = await sw.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', APP);
    return true;
  } catch (err) {
    console.error('Push unsubscribe failed:', err);
    return false;
  }
}

export async function resyncPushSubscription(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const sw = await navigator.serviceWorker.ready;
    const subscription = await sw.pushManager.getSubscription();
    if (!subscription) return false;

    const subJson = subscription.toJSON();
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        app: APP,
        endpoint: subJson.endpoint,
        keys_p256dh: subJson.keys.p256dh,
        keys_auth: subJson.keys.auth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,app' }
    );
    if (error) {
      console.error('Failed to resync push subscription:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Push resync failed:', err);
    return false;
  }
}

export async function hasActivePushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const sw = await navigator.serviceWorker.ready;
    const subscription = await sw.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

/**
 * Auto-migrate a user from per-game (wordy/rungles) push subscriptions to a
 * unified SideQuest subscription. Silent — no UI prompts.
 *
 * Trigger conditions (all must be true):
 *   - Notification.permission is already 'granted' (i.e. user previously
 *     allowed notifications via Wordy or Rungles on this device).
 *   - No active SideQuest push subscription on this device yet.
 *
 * On success:
 *   - Subscribes the SideQuest service worker (no permission prompt because
 *     permission is already granted for this origin).
 *   - Unsubscribes the wordy and rungles service workers' push managers
 *     so the browser doesn't keep multiple active subscriptions.
 *   - Deletes the user's wordy/rungles rows from push_subscriptions.
 *
 * Fire-and-forget; safe to call on every hub mount.
 */
export async function migrateToSideQuestPush(userId) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;

  try {
    // Already on SideQuest? Nothing to do.
    const sqReg = await navigator.serviceWorker.ready;
    if (await sqReg.pushManager.getSubscription()) return;

    // Subscribe via SideQuest's SW. No prompt because permission is granted.
    const ok = await subscribeToPush(userId);
    if (!ok) return;

    // Browser-side: unsubscribe any per-game registrations under this origin.
    const allRegs = await navigator.serviceWorker.getRegistrations();
    for (const reg of allRegs) {
      if (reg.scope === sqReg.scope) continue;
      try {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      } catch {
        // Ignore — best-effort cleanup.
      }
    }

    // DB-side: drop the user's wordy/rungles rows. The unified push edge
    // functions try sidequest first now anyway; cleaning up keeps the table
    // tidy and avoids stale rows lingering across browser storage clears.
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .in('app', ['wordy', 'rungles']);
  } catch {
    // Migration is opportunistic — never throw or block the hub render.
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
