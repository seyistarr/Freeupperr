# Notification sounds

`auth.js` loads `ui-sounds.js` after creating the shared authenticated API-gateway
client. It does not create another Supabase client or any Realtime subscriptions.
The homepage header, chat INSERT handler and notification-center INSERT handler
call the shared sound guards. Historical fetches and UPDATE/DELETE events are silent.

Actual database notification types are `like`, `comment`, `reply`, `mention`,
`repost`, and `follow`. Replies/mentions share the comment sound; unrecognized
notification types use notify. Chat sounds come only from message events, including
an open conversation, and never from a second notification or Firebase callback.

The manager verifies messages using current-JWT/RLS reads, checks DM participation
or group membership, and excludes own, muted, hidden, deleted, expired, note-to-self
and system messages. Notification recipients must match the current session.
Existing rendering, unread counters, push handling, blocks and audiences are retained.

The Settings toggle defaults ON. The cache is scoped by authenticated user ID;
the server preference supersedes it on page load/login, foregrounding and reconnect.
A failed preference read stays silent. Saves roll back the toggle/cache on error.
Storage events propagate changes between pages/tabs, and account changes invalidate
in-flight operations. Event IDs are bounded in memory and in a five-minute
cross-page cache; Web Locks coordinate concurrent tabs where supported. A short
rate limit prevents loud bursts. The sound manager never requests push permission.

## Database boundary

Production has RLS on `user_settings`, with no direct authenticated table access.
Existing `get_user_settings()` and `update_user_setting(text,text)` are the approved
settings RPCs. Migration `20261028153536_notification_sound_preference.sql` adds
only the `notification_sound` key to the latter's allowlist, validates true/false,
initializes defaults with conflict-safe INSERT and atomically updates `{sound}`
with `jsonb_set`. Other JSON keys and columns remain intact. Existing function
signature, grants, authenticated-only execution and fixed search path are retained.
No new tables/columns, data backfill, table grants or RLS changes are required.

The migration was applied through the Supabase migration API and its generated
version was synchronized locally; the CLI could not initialize its read-only home.
Production rollback-only checks confirmed OFF/ON, preservation of other keys,
anonymous denial and continued denial of direct table writes. They committed no
user preference changes. Existing security-advisor notices for intentionally
privileged authenticated settings RPCs remain unchanged:
https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

## Verification and device limits

Run `npm run test:sounds` (set `FREEUPPER_CHROMIUM` to the local Chrome executable
if needed), the full existing test suite, Cloudflare build and both Worker dry runs.
The tests cover preference persistence/rollback, concurrent settings updates,
account switching, actual Realtime callbacks and badge updates, all six tone
sequences, membership/visibility rules, unavailable/blocked audio, and real
Chromium interaction unlocking and light/dark toggle styling.

In-page audio requires a genuine interaction in each page/session and an active,
visible document. Hidden/suspended events are dropped, not queued for later.
iOS Safari and installed PWAs may require another tap after an OS interruption;
silent mode, output volume, OS audio policy and device settings remain authoritative.
Firebase background push uses the browser/OS notification sound and is independent
of this in-page preference. No physical iPhone/PWA/Android acceptance is claimed
by desktop Chromium tests. Service-worker cache is bumped to v18; existing
installations receive it through their normal service-worker update lifecycle.
