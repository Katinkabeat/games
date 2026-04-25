# sq-friend-request-notification

Web Push notification for incoming friend requests. Mirrors the pattern in
`wordy/supabase/functions/push-notification/`.

## Status

**Live since 2026-04-25.** Deployed via Supabase CLI 2.90.0 (installed via Scoop). The DB trigger `friendships_notify_on_insert` is wired and fires on each new pending friendship row.

## Tooling note

The Supabase Management API's `POST/PATCH /v1/projects/{ref}/functions` endpoint with a `body` field does NOT actually bundle functions for the Edge Runtime — every deploy via that path returned `BOOT_ERROR`, even a minimal hello-world. Real deploys must go through `supabase functions deploy …`.

## To redeploy after edits

```powershell
$env:Path = "$env:USERPROFILE\scoop\shims;$env:Path"
$env:SUPABASE_ACCESS_TOKEN = "<your PAT from .env.supabase>"
cd C:\Users\trace\OneDrive\Claude\rae-side-quest
supabase functions deploy sq-friend-request-notification --project-ref yyhewndblruwxsrqzart --no-verify-jwt
```

The `--no-verify-jwt` flag matters — pg_net's http_post from the trigger doesn't sign with a Supabase JWT.

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
