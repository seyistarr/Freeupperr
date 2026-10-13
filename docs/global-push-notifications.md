# Global push notifications: review and deployment

This change uses the existing `public.user_settings.notification_settings` JSONB column.
Only a literal `push_enabled: false` disables account-wide push delivery. Missing rows,
missing keys and null settings retain the legacy enabled behavior. No schema migration,
policy change, existing-user backfill or production data modification is needed to deploy.

## Browser and account behavior

- The authenticated homepage offers the existing permission experience. `Not now`, a browser
  denial, or a previous handled choice prevents repeated automatic prompts. The native API
  runs directly in the click handler before network awaits. Settings provides an explicit
  retry for users who dismissed the in-app prompt; browser denial requires browser/device settings.
- iPhone/iPad browser tabs show dismissible Add to Home Screen guidance. Desktop-mode iPads
  are detected too. The installed app must still have browser permission. Unsupported or
  insecure contexts do not register tokens or request permission.
- The Settings switch represents the account preference; its status explains whether this
  device also needs permission. An enable attempt without permission does not change the
  saved account preference. A separate button enables this device when the account is already on.
- Updates read and merge every existing JSONB key, then conditionally update the previously
  read JSONB value. Concurrent writes retry instead of losing another device's settings.
  New rows are inserted with only `user_id`, allowing the existing database defaults to populate
  before merging `push_enabled`.
- The client reads the preference before loading FCM, before token refresh and before token
  registration. Tokens stay registered while the account is off, allowing other permitted
  devices to resume when the account is enabled again. The server gate, rather than token
  removal, provides account-wide enforcement for existing tokens and old client versions.
- Shared initialization installs one foreground listener per page. It is stopped on opt-out
  or account change. Foreground messages also read the global preference before display.
  Normal sign-out attempts to remove this device's token while the authenticated session
  still exists; cleanup failure does not prevent sign-out. It does not remove other devices.
- Conversation mute controls still write `conversations.muted_by`. The sender's existing mute
  filter runs before the global preference filter. Chat/realtime messages and in-app
  notification records continue independently of push.

## Backed-up deployed function

The separately supplied local deployment-review bundle contains
`supabase/backups/send-push-notification-v23/` with the exact deployed `index.ts`,
the returned deployment metadata, a SHA-256 manifest and the JWT configuration captured
on 2026-10-13. The deployed function was version 23 with `verify_jwt = false`, no import map,
and an `index.ts` entrypoint. This snapshot contains environment variable references only;
no server secret values were fetched or copied. The original backup is supplied locally
rather than committed to this public pull request.

The prepared function in `supabase/functions/send-push-notification/` adds a preference helper
and two calls to it: before token lookup and after badge calculation, immediately before
dispatch. Lookup errors stop the send rather than treating opted-out accounts as enabled.
It keeps the sender's chat mute checks, token cleanup, social payloads, badges and links.
Messages already accepted by FCM can still arrive after a user opts out; they cannot be recalled.

## Required release order — separate production approval required

1. Review the pull request and function diff against the backup. Run `npm run test:push`
   with Node 22.13+; the tests use isolated browser/Firebase/Supabase substitutes and never
   contact the live database or FCM.
2. Validate native browser permission dialogs and an installed iPhone/iPad app in a staging
   environment with test accounts. Cover signed-out home, new sign-in, opt-in, `Not now`, denial,
   reload, global off/on, per-chat mute and two devices. Automated tests here simulate these
   flows; they do not establish actual OS delivery or deployed RLS behavior.
3. After explicit approval, re-download the currently deployed function and compare its version
   and source with the snapshot. Stop and rebase the prepared function if it changed meanwhile.
4. Deploy **only** `send-push-notification` to project `jmjtqidirpmnegzvmiaq`, including both
   `index.ts` and `push-preference.js`. Preserve `verify_jwt = false` because the existing database
   triggers call the function without an authorization header. Keep the current
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `FIREBASE_SERVICE_ACCOUNT_JSON` environment
   configuration. No secret rotation, SQL migration or trigger change is part of this release.
   The repository's `supabase/config.toml` records the existing JWT setting.
5. Confirm deployed logs and test-account behavior under separate authorization. Verify that
   old registered tokens are skipped for an opted-out recipient, enabled recipients still
   receive social/chat pushes, and muted conversations remain silent. Do not use ordinary
   users' data as test fixtures.
6. Release the frontend only after the sender gate is active. The current production sender
   ignores `push_enabled`, so releasing the Settings switch first would give users an ineffective
   account-wide off control. Merge/release requires separate approval.

Deployment can use the Supabase deployment tool with `name: send-push-notification`,
`verify_jwt: false` and these two files, or the documented CLI command after checking its
installed `--help`:

```sh
supabase functions deploy send-push-notification --project-ref jmjtqidirpmnegzvmiaq
```

See the official [deployment guide](https://supabase.com/docs/guides/functions/deploy) and
[function configuration guide](https://supabase.com/docs/guides/functions/function-configuration).
No deployment command has been run for this change.

## Rollback

The exact backup is available for review and recovery. Restoring the old sender removes
global opt-out enforcement, so do not restore it alone after users have saved opt-outs.
Prefer retaining the preference gate while reverting a faulty frontend change. Any sender
rollback needs explicit approval and a plan that continues honoring saved opt-outs.

## Validation limits

The automated suite runs the real client source in an isolated DOM/runtime and the real
sender source with test-only database/Firebase substitutes. It checks gesture timing,
deduplicated initialization, JSONB merge/retry behavior, defaults, reloads, account changes,
registration/logout races, multiple devices, old tokens, server errors and existing chat mutes.
It performs no production writes. Native browser execution was unavailable because this
environment blocked child-process/browser launch. Real OS permission dialogs, actual APNs/FCM
delivery and live authenticated RLS writes remain staging checks before production rollout.
