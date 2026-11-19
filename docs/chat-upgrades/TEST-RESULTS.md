# Security hardening verification — 2026-11-16

Work continues from `7528928` on `feature/chat-exact-replacements`. Production Supabase inspection was read-only. All schema/data writes described here were confined to disposable local databases/containers. No production login, message send, upload, SQL migration or policy change was performed.

## Results

| Run | Result | What it proves / limits |
| --- | --- | --- |
| Combined relevant regression run | **107 total: 103 passed, 0 failed, 4 skipped** | Existing chat/identity/timestamps/cache/sounds/theme/gateway assertions plus the then-current hardening tests. Later focused runs below cover final additions. |
| Final Chromium chat browser suite | **20 passed, 0 failed** | Real markup/styles/handlers at 320, 375, 768, 820 and 1280 pixels, with controlled network/DB/media adapters. Desktop Chromium viewport automation, not device testing. |
| Final isolated SQL suite | **11 passed, 0 failed** | Production-shaped helper definitions, role/RLS execution, idempotence, replay, expiry, membership/blocks, permissive-policy bypass guards, private join admission, identity/permission/role management and safe rollback. |
| Final signed-JWT HTTP integration | **6 passed, 0 failed** | Real PostgreSQL 17.6 and PostgREST 14.1 verify HMAC-signed local test-user JWTs; forged signature, body UID, outsider and revoked-user access are rejected. Also tests legacy conversation UPDATE/role-RPC fixes with actual verified JWTs. |
| Final actual Supabase Realtime integration | **7 passed, 0 failed** | Real local Realtime v2.78.10 WebSockets, verified local JWTs, three group identities plus outsider, old Broadcast defect reproduction, hardened private-channel injection denial, still-open revoked subscriber, reconnect rejection, and direct-chat blocking without JWT refresh. |
| Syntax / patch validation | **Passed** | `node --check chat.js`, `node --check service-worker.js`, test syntax checks and `git diff --check`. |

Counts overlap: the focused suites include tests also present in the earlier combined run and must **not** be summed as unique tests. Parent/subtest counts are Node test runner counts. Successful run outputs are saved under `docs/chat-upgrades/evidence/`.

Combined command:

```sh
FREEUPPER_CHROMIUM=/usr/bin/chromium node --test \
  tests/chat-identity-integration.test.js \
  tests/chat-premium-browser.acceptance.mjs \
  tests/freeupper-time.test.cjs \
  tests/chat-activity-database.test.js \
  tests/chat-upgrades-browser.test.js \
  tests/chat-activity-authenticated.test.js \
  tests/chat-activity-realtime.test.js \
  tests/cloudflare.test.js \
  tests/ui-sounds.test.js \
  tests/ui-sounds-interactions.test.js \
  tests/theme.test.js
```

The four existing/opt-in skips in that command were:

- Local signed-JWT suite requires `FREEUPPER_LOCAL_ACTIVITY_AUTH=1`. It was then run explicitly and passed.
- Local Realtime suite requires `FREEUPPER_LOCAL_ACTIVITY_REALTIME=1`. It was then run explicitly and passed.
- Workers runtime test requires `FREEUPPER_TEST_ORIGIN`; no deployed test origin was configured. Gateway/static unit checks ran.
- WebKit theme browser test requires `FREEUPPER_WEBKIT`; it was not configured. Chromium theme tests ran.

Final focused commands:

```sh
FREEUPPER_CHROMIUM=/usr/bin/chromium node --test tests/chat-upgrades-browser.test.js
node --test tests/chat-activity-database.test.js
FREEUPPER_LOCAL_ACTIVITY_AUTH=1 FREEUPPER_LOCAL_ACTIVITY_REUSE=1 \
  node --test tests/chat-activity-authenticated.test.js
FREEUPPER_LOCAL_ACTIVITY_REALTIME=1 node --test tests/chat-activity-realtime.test.js
```

## Actual WebSocket findings

The local Realtime test first creates policies on a **test-only `fixture-cached:` namespace**, separate from application activity. It demonstrates that:

- A participant can send another participant's UID inside a Broadcast payload.
- An already-connected removed member continues receiving Broadcast packets with the old authorization cache.
- A new private join by that removed member is denied.

Those temporary local fixture policies are removed in `finally`; they are not part of the production migration.

The same suite then verifies the hardened **private** `chat-activity-db:` transport:

- Authorized group members receive rows with server-assigned actor identity; outsider gets no rows.
- A malicious authenticated client's Broadcast injection is not delivered as activity.
- A removed member keeps the same still-open socket and valid JWT but receives no subsequent activity rows. An authorized remaining member does receive the control event.
- A removed member cannot privately reconnect. Obsolete `chat-activity:` private channels deny both removed users and current participants.
- After a direct-chat block, the original socket and unchanged JWT receive no new rows. A local administrative row update tests receive RLS separately from sender RPC refusal.

This is real service/WebSocket integration, not a mocked socket or an HTTP-only inference. It is still **not** a test of the exact hosted production Realtime build, project settings, proxy or mobile network conditions.

## Browser coverage

Existing rendering, cards/3D ordering, four filters, message composer, replies/captions/thumbnails, local-day separators, duplicate/out-of-order rows, 32-bar voice fit, pending/sent/read receipts, reduced motion, quote keyboard jumps, horizontal tab navigation, search/composer keyboard isolation, recording start/cancel/send, real XHR progress callback handling, cancellation/failure, conversation switching during uploads, immutable destination/reply, private transport setup, reconnect, source isolation/replay and activity expiry all pass.

New privacy checks verify that a frontend flag cannot bypass a missing private backend, new view-once sends cannot fall back to Cloudinary, and the disabled private reader refuses missing/expired/>30-second server deadlines, and a delayed legacy view-once claim cannot open media in a newly selected conversation. Browser media/recorder and backend adapters are synthetic; no real microphone, Cloudinary transfer or physical playback is claimed.

## Local infrastructure and resolved failures

The full Supabase CLI image exceeded the workspace's Docker VFS storage limit. A minimal isolated stack was used instead: PostgreSQL 17.6 Alpine, PostgREST 14.1 and the original Realtime v2.78.10 filesystem flattened to avoid duplicated VFS image layers. Local PostgreSQL required wal2json 2.6 and the normal Supabase roles before Realtime could finish its own migrations. No production database/settings were altered to make tests pass.

Initial socket runs failed during local infrastructure initialization (missing wal2json, missing role/sequence prerequisites or unfinished Realtime migrations); these were not counted as security passes. The final test runs use completed Realtime tenant migrations and pass. An earlier browser fixture tagged queued RPCs by the current mock channel rather than the captured RPC destination; that fixture was corrected without weakening the destination assertion.

The signed-JWT test uses a random local issuer secret stored in `/tmp/fu-security.env`, with dummy local auth-user IDs. This tests actual JWT verification and SQL authorization, **not** GoTrue login/session lifecycle or real hosted accounts. Opt-in tests are hard-coded to loopback ports and named task containers. They cannot be pointed at production by changing a URL environment variable. The HTTP fixture has a fresh local setup mode and a reuse mode that preserves a running Realtime schema; initialize HTTP fixtures before starting Realtime tenant migrations.

## Not performed / remaining release gates

- Hosted production-version canaries through the actual API gateway with two direct-chat accounts and three group accounts.
- Hosted project Realtime settings, JWT/session refresh/revocation, feature rollout and old-client retirement.
- Production-scale heartbeat/fan-out/WAL lag, rate limiting, retention cleanup and service failure testing.
- A secure encrypted private view-once upload/claim/delivery backend: absent and intentionally not fabricated/enabled.
- Physical iPhone Safari, Android Chrome, installed PWA, background microphone behavior, playback, real network interruption and real Cloudinary upload failure/cancellation.
- Firefox/WebKit chat acceptance and VoiceOver/TalkBack behavior.
- Entire unrelated repository test suite; only relevant suites were run.

**Production recommendation remains NO-GO** until the documented canary, private-media availability/security decision and device/release gates are resolved.
# Current release verification

See [RELEASE-CANDIDATE.md](RELEASE-CANDIDATE.md) and PR #41 for the fresh release checks and receipt/metadata/join-request coverage. Results below are historical and should not be added to newer totals.

