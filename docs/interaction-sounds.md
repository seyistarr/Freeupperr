# Interaction sounds (review candidate, 2026-11-05)

Based on `main` commit `c4ad75b5078f337c39f2775e19720de420c1b079`.
No deployment, remote branch push, database migration, or production write is part of this change.

Independent review and current readiness: see [interaction-sounds-review.md](interaction-sounds-review.md).
The original validation counts below are historical; the review includes local fixes and additional tests.

## Findings and implementation

The existing `ui-sounds.js` v3 manager handles incoming notifications/messages,
trusted-gesture Web Audio unlocking, account changes, preference RPCs and event
deduplication. Outgoing actions had haptics/animations but no shared sound feedback.
Home/For You share handlers; Explore also has direct Save/comment branches.
Profile uses retained detail documents and has a separate relationship mutation
entry point. These paths were inspected before adding calls.

Version 4 reuses the same AudioContext, oscillator envelopes and cleanup. Interaction
feedback has lower gain (0.022 peak per voice), with new share/save/tap tones.
After independent review, interactions use their own short neutral palette (including
a Share frequency sweep); incoming notification melodies remain separate. Notification tone sequences and their saved server preference remain intact.

The new **Interaction sounds** Settings checkbox defaults ON. It is independent
from **Notification sounds**. Its preference is **per account on this browser**,
stored under `fu-interaction-sound:<authenticated-user-id>` and synchronized across
same-origin tabs. It does not synchronize across devices. Storage failures keep
the prior value and display an accessible status message. There is no new RPC,
subscription, table access, database migration, or change to action requests.
Both sound checkboxes support keyboard focus, Space and a visible focus outline.

Feedback means the user activated a control; it does not assert server success.
Calls run synchronously in the existing handlers and never await sound. They do
not prevent events, change focus, wrap actions, modify promises, or alter network
payloads. A WeakSet permits one tone per trusted activation, including nested
handlers, while distinct quick activations remain responsive. Automatic work,
expired gestures, synthetic clicks, scrolling, anonymous sessions, hidden documents
and suspended retained screens are silent. Notification sounds retain their existing
separate rate limit and incoming-event deduplication.

No sound is queued while iOS has a suspended/interrupted AudioContext. The original
trusted pointer/touch/keyboard/click unlock path and webkitAudioContext fallback
are retained. Unsupported or blocked audio fails silently without delaying actions.
Native video/audio controls and scrolling have no sound hooks. Muting either sound
category stops only that category; sign-out, page hiding and retained-screen
suspension stop content tones. Visible persistent navigation tones survive a tab
switch; muting, sign-out and document hiding still stop them.

## Handler coverage

| Surface | Existing handlers used |
| --- | --- |
| Home / For You | `toggleReaction`, `toggleBookmarkUI`, `toggleFollowUser`, `triggerRepostFromFeed`, `openShareModal`, comment navigation via `openExplorePost(..., focusComment)`; comment send/like and lightbox handlers |
| Explore | Shared Like/Follow/Repost/Share handlers; direct bookmark and comment-focus branches; `submitExploreComment` |
| Market | `toggleFavorite` (Save), `shareCurrentProduct`, category/subcategory selection |
| Video | `toggleLike` (including double-tap heart), `toggleSave`, Follow controls, `toggleRepost`, `openShare`, `openComments`, comment send/like, clear-display control |
| Search | Like, Save, Follow, Repost, Share, lightbox comment open/send/like, result tabs |
| Profile | Existing Like/Save/Repost/Share/tab handlers; `mutateProfileRelationship` covers main Follow and relationship lists; post/Market detail uses the existing index renderer |
| Shared navigation | Bottom navigation and desktop sidebar, after existing modified-click guards |

`foryou.js`, `explore.js`, renderers and `posts.js` need no new action listeners or
API changes. New method calls are optional even if a previously cached v3 manager
is encountered. All seven affected documents load v4 before auth/action consumers;
new coupled script URLs bypass cache-first old entries. The service-worker cache
changes from v29 to v30. Existing installations update through the normal worker
lifecycle; an already-open old document needs its normal update/reload.

## Changed files

- Engine/loading: `ui-sounds.js`, `auth.js`, `service-worker.js`.
- Handlers: `index.html`, `market.js`, `search.js`, `video.html`, `profile.html`,
  `bottom-nav.js`, `side-nav.js`.
- Settings: `settings.html`, `settings.js`.
- Other document asset references: `search.html`, `chat.html`, `notification.html`.
- Tests: `tests/ui-sounds-interactions.test.js`,
  `tests/ui-sounds-interactions-browser.test.js`, `tests/helpers/sound-fixture.js`,
  `tests/ui-sounds.test.js`, `tests/quote-reposts-client.test.js`.
- This report: `docs/interaction-sounds.md`.

## Validation and production compatibility

Focused tests cover default/independent preferences, per-account persistence,
cross-tab changes, storage failure, all seven sound families, quiet gain,
same-activation deduplication, rapid distinct activations, anonymous/hidden/blocked
contexts, no delayed playback, real Video action preservation, and cached v3
compatibility. Chromium exercises the actual Video Like handler using mouse,
touch and Enter, a synthetic click/scroll silence check, and the actual Settings
checkbox using keyboard Space. A real service-worker install test removes the old
v29 cache and fetches the v4 manager and coupled consumers offline. Existing
notification/browser/database tests run
alongside these regressions.

Read-only GET checks on 2026-11-05 confirmed production serves v3 byte-for-byte
matching the inspected main branch and PWA cache `freeupper-pwa-v29-sidebar-cloudflare-v1`.
The v4 query URL currently also returns v3 because this candidate is not deployed.
`/__migration/health` returned `ok: true`, `publicRoutesReady: true`, and
`releaseVerified: true`. These checks do not authenticate or mutate a user account.
The candidate needs no production schema or permission changes.

A Cloudflare build and both project-local Wrangler 4.152.0 Worker dry runs compile
successfully without uploading. Dry runs verify packaging, not production runtime
behavior. See final validation results below before considering release.

Physical iPhone Safari and installed-PWA audibility, silent-mode behavior and
post-interruption recovery still require device acceptance. Desktop Chromium
cannot establish that a device speaker produces sound. Production remains unchanged;
merging/deployment requires the user's explicit approval.

## Original implementation validation results (before independent review)

- `npm run test:sounds`: **50 passed, 0 failed, 0 skipped** (latest source/tests).
- `FREEUPPER_CHROMIUM=/usr/bin/chromium node --test --test-isolation=none tests/*.test.js tests/*.test.cjs`:
  **477 checks, 472 passed, 0 failed, 5 skipped**. Three skipped checks require a
  configured local Worker origin; one requires WebKit; the bundle-based Worker
  runtime check was subsequently run separately and passed. The two final sound
  regressions added during this run are included in the 50-check focused run.
- Bundle runtime check with `FREEUPPER_TEST_BUNDLE=.wrangler/interaction-sounds-dry-run`:
  **1 passed**, exercising compiled Worker public previews/WASM/privacy with mocked
  upstream services. The bundle must be inside the project for this workerd version;
  an initial attempt with a `/tmp` bundle failed its virtual filesystem path check.
- `npm run build:cloudflare`: passed; 73 root browser assets prepared.
- Both project-local `wrangler deploy --dry-run` commands (web and API configs):
  passed; **no upload**. Web bundle 2253.94 KiB (747.46 KiB gzip), API 7.69 KiB
  (2.72 KiB gzip).
- Node syntax checks for edited JavaScript, parsing all 14 inline scripts in the
  affected HTML documents, and `git diff --check`: passed.
- Production `/home`, `/search`, `/videos`, `/profile`, `/settings`: HTTP 200.
  Production health and asset reads passed as described above. GitHub `main` was
  rechecked and still points to the inspected commit.

The first broad run found a missing default Playwright executable and a legacy
whole-file hash guard that correctly detected the additive Video changes. The
rerun uses installed Chromium. The hash guard now removes only the new sound
calls/loader/asset versions before checking its original legacy digest, preserving
its protection for player behavior and API/media/view-tracking contracts.

**Original readiness assessment (superseded by the independent review):** code review and physical iPhone Safari/PWA acceptance can proceed.
No production database or API change is needed. Merge and deployment remain
unapproved and were not performed.
