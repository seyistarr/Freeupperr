# Notification sounds

`ui-sounds.js?v=3` loads early in the homepage, chat, notification center and
Settings documents. `auth.js` explicitly binds its existing authenticated gateway
client; other pages retain the dynamic-loader fallback. It does not create another Supabase client or any Realtime subscriptions.
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
cross-page cache; Web Locks coordinate concurrent tabs where supported. Persistent event
claims are written only after audio is scheduled successfully. A short
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
by desktop Chromium tests. Service-worker cache is bumped to v20; existing
installations receive it through their normal service-worker update lifecycle.


## iPhone follow-up investigation (2026-10-28)

Downloaded production `ui-sounds.js?v=1` and `auth.js` matched the prior release
byte for byte. Read-only production database checks confirmed that both Realtime
tables are published, the settings RPC is installed and executable by authenticated
users, and the message-filter columns exist. These checks do not establish that a
particular iPhone received a Realtime event.

Controlled tests executing the downloaded production script reproduced two defects:
a rejected `resume()` left `unlocked: true` with the context suspended; and a tap
before async auth completion was discarded, leaving no context and playback false
even after the saved preference became ready. The old asynchronous loader also
allowed consumers/early interactions to precede the sound manager. We have not
attributed this user's physical-device silence to a particular defect.

Version 3 captures silent unlock gestures before auth, waits for a confirmed
running context, retains that initial unlock when the session arrives, and bounds
resume waits. An explicit Test sound button calls `FUSound.play` in the trusted
click handler, with no network await, and uses the same oscillator/gain synthesis
as notifications. This manual preview bypasses only preference readiness/enabled
and automatic burst/event deduplication, without modifying preferences. Auth and
page visibility remain required. A successful result means a graph was scheduled,
not that a device speaker was heard.

Temporary diagnostics are accessible through Settings and `FUSound.diagnostics()`.
They include script version, preference readiness/status, actual AudioContext
state, unlock results, play invocation/scheduling counts and reasons, Realtime
channel status, callback counts and fixed suppression labels. A bounded per-user
sessionStorage summary carries the last event/play result to Settings across
navigation. It contains no payloads, tokens, message/notification IDs, account
identifiers in displayed data, or network telemetry. Logout clears the prior
user's summary. Remove this troubleshooting UI and summary after device acceptance.

Test sound distinguishes three cases: no scheduling (see audio/auth reason),
scheduling but no audible sound (audio/output investigation, independent of
Realtime), or audible test with silent notifications (inspect callback/channel/
filter/sync diagnostics). No physical iPhone Safari, installed PWA or Android
verification is claimed. Desktop Chromium tests verify the actual button's trusted
activation and the manager's non-silent generated PCM using OfflineAudioContext.

DOM-ready binding also supports an early sound script alongside a cached older
`auth.js` that only assigns `window.sb`. A regression test models this PWA upgrade
path; script version 3/cache v20 invalidate the intermediate release.
