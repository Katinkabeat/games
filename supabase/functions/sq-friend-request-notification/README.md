# sq-friend-request-notification

Web Push notification for incoming friend requests. Mirrors the pattern in
`wordy/supabase/functions/push-notification/`.

## Status

**Source committed, but not deployed to Supabase.**

I tried to deploy this via the Supabase Management API's `POST/PATCH /v1/projects/{ref}/functions` endpoint, but functions deployed that way fail with `BOOT_ERROR` — even a minimal hello-world. The API's `body` field stores source but doesn't bundle it for the Edge Runtime. Real deploys need the CLI's eszip path or the multipart `/deploy` endpoint.

The DB trigger that called this function has also been dropped, so no pg_net requests are queueing against a broken endpoint.

## To enable

1. Install Supabase CLI (recommended via Scoop on Windows):
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
   scoop install supabase
   ```
2. Link the project once:
   ```bash
   supabase link --project-ref yyhewndblruwxsrqzart
   ```
3. Deploy the function:
   ```bash
   cd ~/OneDrive/Claude/rae-side-quest
   supabase functions deploy sq-friend-request-notification --no-verify-jwt
   ```
4. Re-apply the trigger SQL from `supabase/migrations/sq_friend_request_trigger.sql` (or paste into the Supabase SQL editor).

## What it does

When a row is inserted into `public.friendships` with `status='pending'`, a DB
trigger POSTs to this function via `pg_net`. The function:

1. Reads the new row's `requested_by` and computes the recipient.
2. Looks up the recipient's username via `profiles`.
3. Looks up the recipient's push subscription, trying `app='sidequest'` first,
   falling back to `wordy` then `rungles` (matches the unified push
   architecture documented in the project memory).
4. Sends a Web Push notification: "Rae's Side Quest — {requester} wants to
   be friends!"

Expired push subscriptions (HTTP 410/404 from the push service) are deleted
from `push_subscriptions` automatically.
