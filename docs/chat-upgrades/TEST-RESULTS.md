# Verification results

All tests run locally with production network writes excluded. No hosted SQL migration was executed.

## Combined regression run

```sh
FREEUPPER_CHROMIUM=/usr/bin/chromium node --test \
  tests/chat-identity-integration.test.js \
  tests/chat-premium-browser.acceptance.mjs \
  tests/freeupper-time.test.cjs \
  tests/chat-activity-database.test.js \
  tests/chat-upgrades-browser.test.js \
  tests/cloudflare.test.js \
  tests/ui-sounds.test.js \
  tests/ui-sounds-interactions.test.js \
  tests/theme.test.js
```

Result: **95 tests: 93 passed, 0 failed, 2 skipped**. This run included the then-current 11 upgrade browser tests. Subsequent focused browser reruns cover the final additional XHR, recording and attribute/date regressions; counts overlap and must not be added together.

Skipped by existing suite conditions:

- Workers runtime static assets/routes/privacy test: `FREEUPPER_TEST_ORIGIN` was not configured. Static/gateway unit checks did run.
- WebKit theme browser test: `FREEUPPER_WEBKIT` was not configured. Chromium theme checks did run.

## Final upgrade browser run

```sh
node --test tests/chat-upgrades-browser.test.js
```

Uses system `/usr/bin/chromium`, with all external requests blocked and the actual production markup, styles and handlers. **Final result: 14 passed, 0 failed, 0 skipped.**

Coverage: 320/375/768/820/1280 pixel layouts, real rendering, 32-bar voice geometry, mixed-media reply thumbnails, static date grouping/de-duplication/ordering, receipts, view-once thumbnail privacy, document/poll labels, group summary text, activity placement, reduced motion, quote keyboard jumps, tab arrow/Home/End/native activation, composer keyboard isolation, actual XHR progress handler and AbortSignal, upload failure/cancellation, switching while uploading, immutable destination and reply, stale completion versus new recording, session validation, typing, private channel configuration/auth setup, channel disconnect/reconnect, delayed profile stop races, TTL expiry, synthetic recorder start/cancel/send and attribute escaping.

The recorder fixture uses synthetic media objects; no real microphone or device API behavior is claimed. The channel fixture verifies client logic, not Supabase's hosted WebSocket service. The DB/upload adapters do not prove a successful real Cloudinary upload.

## Isolated SQL verification

```sh
node --test tests/chat-activity-database.test.js
```

Result in combined run: **7 tests passed, 0 failed** (parent plus 6 subtests). PGlite creates disposable production-shaped tables/roles and loads inspected production authorization helper definitions. Checks: direct participants, unauthorized users, null authentication, anon function denial, malformed topics, notes, group membership removal including stale user1 ownership, group send permission, both block directions, actual authenticated-role policy execution, repeatability, future permissive-policy bypass protection, unaffected unrelated topic access and rollback preserving rows/unrelated policy.

This tests PostgreSQL authorization, not cached live subscriptions. A connected removed member must still be tested against a server-enforced revocation strategy.

## Syntax and patch checks

`node --check chat.js`, `node --check service-worker.js`, and `git diff --check` pass.

## Failures resolved during development

Initial existing tests extracted individual functions without the new lifecycle dependencies (`stopActivity`, `clearActivityFor`, tab helpers). Fixtures were updated; behavior assertions retained. Two existing assertions only accepted older cache URLs; they now accept the new version. The final combined regression run has no failures. No live production tests were attempted to compensate for local failures.

## Not performed / release requirements

- Physical iPhone Safari, Android Chrome, installed PWA, background suspension, OS permission prompts and real microphone/audio playback.
- Firefox or WebKit chat acceptance; VoiceOver/TalkBack announcement behavior.
- Two authenticated accounts for direct chat and three for group activity on an isolated hosted environment.
- Real Cloudinary photo/video/mixed uploads, real network interruption and server-side orphan-asset cleanup.
- Hosted private-channel outsider rejection, blocked-user joins, connected membership revocation, JWT refresh and reconnect through the actual API gateway.
- Private view-once backend publication/cancellation/reply behavior: production has no `chat-private-upload` function and the existing flag remains disabled.
- Hosted Realtime public/private project settings and JWT expiry: not exposed by available read tools.
- The entire repository test suite; the relevant chat, identity, timestamps, theme, gateway and sounds suites were run.

These remain release gates, not implied passes. Production recommendation is **NO-GO**.
