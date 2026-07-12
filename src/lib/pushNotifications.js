import { supabase } from './supabase.js';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const APP = 'sidequest';
const SW_PATH = '/games/sw.js';

// Account-wide master mute. Stored as a sentinel pref row (app '_all',
// topic '_master'); absent = on. This is the durable "do I want push at all"
// intent — decoupled from whether a browser subscription happens to exist.
const MASTER_APP = '_all';
const MASTER_TOPIC = '_master';

// Is the account-wide push master ON? Absent row = on (default). Fail-open.
export async function getPushMasterEnabled(userId) {
  if (!userId) return true;
  const { data, error } = await supabase
    .from('user_notification_prefs')
    .select('enabled')
    .eq('user_id', userId)
    .eq('app', MASTER_APP)
    .eq('topic', MASTER_TOPIC)
    .maybeSingle();
  if (error) return true;
  return data ? data.enabled !== false : true;
}

// Set the account-wide push master. enabled=false silences everything without
// touching the browser subscription (the address stays alive underneath).
export async function setPushMasterEnabled(userId, enabled) {
  if (!userId) return false;
  const { error } = await supabase.from('user_notification_prefs').upsert(
    { user_id: userId, app: MASTER_APP, topic: MASTER_TOPIC, enabled },
    { onConflict: 'user_id,app,topic' }
  );
  if (error) {
    console.error('Failed to set push master:', error);
    return false;
  }
  return true;
}

// Keep the push address alive. Called on every app open: if the browser has
// already granted permission and the account master is on, (re)create and
// refresh the subscription row — self-healing a lapsed/rotated address that
// would otherwise silently stop all notifications. No permission prompt
// (permission is already granted); respects an explicit master-off mute.
export async function ensurePushSubscribed(userId) {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') return false;
  if (!userId) return false;
  if (!(await getPushMasterEnabled(userId))) return false;
  // subscribeToPush is idempotent: reuses an existing browser subscription or
  // creates a new one, then upserts the row (refreshing endpoint + updated_at).
  return subscribeToPush(userId);
}

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

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
