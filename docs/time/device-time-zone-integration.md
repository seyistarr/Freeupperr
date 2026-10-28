# Device time-zone integration — 2026-10-28

Event displays use the viewer's device time zone. No location permissions or
manual time-zone preferences are needed. The shared helper accepts Date objects,
epoch milliseconds, and ISO event strings with Z or an explicit numeric offset.
Ambiguous date-only/local strings and invalid values render empty instead of
silently assigning the viewer's offset. Birthdays are calendar values and remain
outside the event parser.

Posts, video/comment timestamps, chat clocks/date dividers/last-seen/media times,
search results, sound creation dates, and notification timestamps were inspected.
The checkout contains no separate stories implementation to exercise. Existing
valid event displays already use local Date/Intl formatting; no stored timestamps
are converted to local wall-clock strings. Missing post times no longer fabricate
a current creation time. Notification grouping compares local calendar dates,
including 23/25-hour daylight-saving days.

The Cloudflare build now includes js/, fixing the production helper's observed
404. Pages load the helper before their consumers. The service worker precaches
it and advances the cache version. CI now includes the .cjs regression suite.

## UTC and API boundary

The browser's existing client still targets https://api.freeupper.com. Its gateway
streams mutation and response bodies unchanged; a regression test verifies UTC
Z/+00:00 timestamp preservation. Existing write timestamps use toISOString(), and
checked migration definitions use timestamptz. No database, RLS, secret,
authentication, protected-media, or gateway implementation changes were made.

Unauthenticated production reads of posts/comments/messages/notifications through
the gateway returned 403. Consequently, live protected row contents and their
column types were not verified. No direct Supabase access was used to work around
those denials. Signed-in chat, private notifications, and publishing need a user
session for full live acceptance.

## Verification

- Original `node --test tests/freeupper-time.test.cjs`: 3/3 passed.
- Expanded time suite: 7/7 passed, including actual helper formatting in Lagos,
  London, New York, Tokyo and spring/autumn DST transitions, plus notification
  calendar grouping over 23/25-hour days.
- `npm run build:cloudflare`: passed.
- Web and API `wrangler deploy --dry-run`: passed.
- Full suite with built Worker, Chromium, and local Worker origin: 155/155 passed,
  no skips (`node --test --test-isolation=none tests/*.test.js tests/*.test.cjs`).
- Local real Chromium homepage: helper HTTP 200 and loaded; the same UTC instant
  displayed 13:00 Lagos, 12:00 London, 08:00 New York, 21:00 Tokyo.
- Before deployment: production homepage HTTP 200, API /health healthy, shared
  helper HTTP 404. Post-deployment status is reported with the task results.
