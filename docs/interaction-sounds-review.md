# FreeUpper interaction sounds: independent review and acceptance readiness

Review date: 2026-11-05 UTC. The original implementation report was treated as
unverified; the source diff was inspected and its tests rerun before making fixes.
This report supersedes the initial implementation's readiness assessment.

## Revision identity and scope

- Repository: `seyistarr/Freeupperr`.
- Freshly fetched `origin/main`: **`c4ad75b5078f337c39f2775e19720de420c1b079`**.
- At review start, local `feat/interaction-sounds` pointed to the same SHA, with
  **21 uncommitted changed/new files**. GitHub had no remote feature branch.
  There was no separate feature commit to verify at that point.
- The original patch was preserved as `/workspace/freeupper-interaction-sounds-before-review.patch`.
  SHA-256: `e23f5ea5511e7dea6aa8adb94cd8553bcf7496c5e69d96797844a3a8f0c25a81`.
- A local baseline commit was reconstructed from exactly that patch:
  **`eb91d91dbd4761ca425de9d7efe497894a8af116`** (21 files, +667 / -63).
  It was created during this review, not claimed to be an existing remote commit.
- The final local feature commit and complete/review-only diff summaries are
  recorded in `/workspace/freeupper-review-manifest.json` and the final response.
  The final candidate descends from the preserved baseline and latest main.
- No push, pull-request merge, preview deployment, production deployment,
  Cloudflare/Supabase setting change, or production database write was performed.

## Findings, classified by severity

| ID | Severity | Finding and evidence | Disposition |
| --- | --- | --- | --- |
| F1 | Medium | Visible persistent navigation belongs to the launch document, whose `FreeUpperScreen.isActive()` becomes false on another tab. The original engine rejected subsequent navigation feedback, and its suspension hook stopped the first tone immediately. Real coordinator/lifecycle/component tests reproduced `search: 1 start / 1 cancellation`, then zero starts on the remaining four tab switches. | Fixed locally: only trusted visible shell navigation may bypass content-screen inactivity, and only its short navigation nodes survive content suspension. Actual document hiding, muting and logout still stop them. Bottom navigation and desktop sidebar now pass all five tab switches. |
| F2 | Medium | Home/Explore/Search feedback covered opening the repost menu but omitted actual Repost/Undo confirmation handlers. Several Like/Save/comment calls also preceded existing busy/validation guards, so ignored activations could still sound. | Fixed locally: menu opening gets a quiet UI tap; actual confirmation handlers get one neutral cue. Selected handler calls moved past their existing synchronous guards. Action requests, authorization, pending sets, promises and rollback logic were preserved. Tests execute actual Home Repost/Undo success/failure and ignored pending Like handlers. |
| F3 | Low | Notification melodies were reused as interaction feedback before server success. Their multi-note duration/character did not match the requested short pop/gentle tap/swoosh well and could suggest successful completion on failures. | Fixed locally: separate short neutral activation palette, Share frequency sweep, no added completion chime. All seven palettes render non-silent, quiet PCM that ends by 140 ms. Incoming notification melodies and their gain remain unchanged. Subjective loudness/character still needs physical acceptance. |
| F4 | Low | Every gesture and nested interaction called unlock again and created silent buffer sources even for a running context. A controlled original-feature browser scenario created 75 silent sources for 25 action samples; repeated blocked gestures could accumulate waiting silent sources. | Fixed locally: running contexts use a fast path, nested calls avoid a redundant unlock, at most one silent source can wait on a suspended context, and a closed context clears its old unlock source. The same scenario used one silent source. Unit checks cover 100 activations, blocked/hanging resume and closed-context replacement. |
| F5 | Low | The reported feature branch had no unique implementation commit: all work was uncommitted. | Original patch preserved and reconstructed as a local baseline commit; final fixes recorded in a separate local commit for reproducibility. No remote branch was created. |
| D1 | Critical / High advisory severities; pre-existing tooling | Full `npm audit` reports 42 dependency findings: 1 critical, 21 high, 19 moderate, 1 low. `tar` 7.5.7 under `@vercel/fun` and top-level 7.5.11 receive a critical aggregate advisory rating; the Vercel development/tooling dependency tree also includes high findings. This is an advisory inventory, not a demonstrated production exploit. | Outstanding dependency triage. `package.json` and `package-lock.json` are byte-identical to main; the sounds feature adds no dependency. Do not treat a passing frontend review as resolution of the toolchain advisories. Major upgrades were not mixed into this feature review. |
| D2 | Medium; pre-existing production dependency | `npm audit --omit=dev` reports 2 moderate findings through `@vercel/og` / `satori`, including improper SVG escaping ([GHSA-wx4j-mvgx-mqwp](https://github.com/advisories/GHSA-wx4j-mvgx-mqwp)). | Outstanding separate dependency/security review. No claim is made that the advisory is exploitable through current image handlers. |
| V1 | Medium acceptance gap | Physical iPhone Safari/PWA and Android audio behavior, silent mode, routing and interruption recovery were not tested. Desktop WebKit was unavailable due missing host libraries. | Physical checklist prepared; production approval remains held. Desktop automation and fallback mocks are not physical-device evidence. |

No new Critical or High interaction-sound/auth/data regression was confirmed.
The dependency advisory severities above are separate existing release risks,
not a claim that the new sound manager exposes a critical vulnerability.

## Behavior verified from code

Interaction sounds default ON, independently of notification sounds. The preference
is stored as a boolean under `fu-interaction-sound:<current-authenticated-user-id>`.
The actual Settings checkbox explicitly says it is saved on this browser. It does
not call a settings RPC, synchronize across devices, or reuse notification JSON.
Storage events update other same-origin tabs that share the same storage container.
Safari and a standalone PWA may use different containers; no synchronization
across such containers is promised.

Playback occurs **during the trusted activation**, before server completion.
Short neutral cues acknowledge the control rather than assert success. RPC failures
retain existing errors/optimistic rollback and cause no second/success/retry sound.
An already-busy or invalid control is silent where its existing guard rejects it
before the audio call. No action awaits sound or gains a timer/network wait for it.

The engine uses one AudioContext per document, the existing Web Audio synthesis,
`webkitAudioContext` fallback, fixed tone labels, and a WeakSet for once-per-event
feedback. Distinct rapid activations have no artificial cooldown. The public
method returns synchronously. Handler sound calls remain optional for a cached
v3 manager. No scrolling/observer/fetch/paging listeners play interaction tones.

Hidden documents, inactive content screens, synthetic/expired activations and
anonymous sessions do not play. Only actual visible root shell navigation is
exempt from content inactivity. Inactive feeds cannot use this exception for
Like/Follow/etc. Muting either category stops its own active tones; logout and
real document hiding stop all tones. Oscillator `onended` removes tracking entries
and disconnects oscillator/gain nodes; native tests observed every started
oscillator ending.

### Action/surface coverage

| Action | Reviewed behavior |
| --- | --- |
| Like/Love / Unlike | Short neutral pop. Home/For You and Explore share the main handler; Search/Video/Profile have their own entry points. Video double-tap routes through the same Like handler. |
| Repost / Undo | Quiet menu-opening tap, then one soft cue for each actual confirmation activation, including Home/Explore/Search and Video. Profile's legacy direct handler remains guarded as before. |
| Share | Short swept-frequency cue when the Share control is activated. Share-sheet cancellation is not announced as success. Market listing and Profile share controls are included. |
| Comment | Gentle tap for opening/focusing comments and eligible submission; comments/replies retain visual validation and failure behavior. |
| Save / Unsave | Soft neutral cue; covers shared post handlers, Explore's direct branch, Video, Search, Profile and Market favorites. |
| Follow / Unfollow | Short subdued cue; Profile's actual relationship mutation entry covers main Follow and relationship-list controls. |
| Other UI | Existing primary bottom navigation/sidebar, Home/Explore/Market selection, Market categories/subcategories, Search result tabs, Profile tabs and Video clear-display control. |

Market does not gain new social actions that its listing UI does not have. Existing
`foryou.js` and `explore.js` delegate to the reviewed shared handlers. Profile post
and Market details retain their existing owned renderer paths. Audio calls add no
new action delegation or Realtime subscriptions.

## Files reviewed

All 21 original changed/new files were reviewed against latest main:

| File | Review focus |
| --- | --- |
| `ui-sounds.js` | Gating, trusted activation, palette, context lifecycle, node cleanup, account/storage/notification isolation |
| `settings.js` | Actual interaction toggle binding, error rollback and authenticated availability |
| `settings.html` | Two independent named controls, browser-local description, keyboard focus and polite error status |
| `auth.js` | Only loader URL changes; existing client, public anon key, session storage and auth callback behavior retained |
| `service-worker.js` | v30 cache, coupled consumer precache, normal install/wait/activation and existing private-response exclusions |
| `index.html` | Home/For You/Explore/lightbox handlers, direct Save/comment branches and repost confirmation callbacks |
| `market.js` | Favorite/save/share/category handlers |
| `video.html` | Like/double tap, save, follow, repost, comments, share and clear-display; legacy action/player source hash remains checked |
| `search.js` | Search actions, repost confirmation, comment controls and result tabs |
| `profile.html` | Relationship mutation, legacy actions, share/tabs and retained detail routing |
| `bottom-nav.js` | Existing modified-click guards and persistent component call |
| `side-nav.js` | Existing modified-click guards and persistent sidebar call |
| `chat.html` | Coupled script URLs only; message handlers not rewritten |
| `notification.html` | Coupled script URLs only; incoming event path retained |
| `search.html` | Early v4 manager and coupled script URLs |
| `tests/helpers/sound-fixture.js` | Fixture authenticity/limitations, activation lifetime and local mock data |
| `tests/quote-reposts-client.test.js` | Legacy source hash guard strips only additive audio/version changes before its original digest/API checks |
| `tests/ui-sounds.test.js` | Existing notification/auth/account guards and updated loader-version assertions |
| `tests/ui-sounds-interactions.test.js` | Preference, deduplication, visibility, blocked audio, actual Video handler and old-manager cases |
| `tests/ui-sounds-interactions-browser.test.js` | Real trusted mouse/touch/keyboard, Settings, actual worker install/offline cache test; not a physical-device test |
| `docs/interaction-sounds.md` | Claims checked against code; initial test results now explicitly marked historical |

Additional unchanged sources inspected: `foryou.js`, `explore.js`, `index-render.js`,
`index-interactions.js`, `posts.js`, `profile-shell.js`, `profile-detail.js`,
`js/screen-lifecycle.js`, `header-badges.js`, relevant existing auth/navigation/
notification/database/browser tests, Cloudflare build/config and dependency manifests.

Four new review artifacts are in the final diff: `tests/ui-sounds-review.test.js`,
`tests/ui-sounds-review-browser.test.js`, this report, and
`docs/interaction-sounds-iphone-acceptance.md`. Final candidate: 25 files versus main.
Review fixes change `ui-sounds.js`, selected `index.html` / `search.js` / `video.html`
call placement, fixture instrumentation and documentation; they do not change
product API payloads, database/schema/configuration or dependencies.

## Independently executed validation

| Check | Actual result |
| --- | --- |
| Original feature focused suite before fixes | **50 passed, 0 failed, 0 skipped** |
| Reproduction against original source | Bottom navigation fails with first tone cancelled and subsequent switches silent; original source also produced 75 silent buffers in the controlled sample |
| Latest focused suite, including all review additions | **65 passed, 0 failed, 0 skipped** |
| Broad suite with installed Chromium | **491 checks: 486 passed, 0 failed, 5 skipped** |
| Compiled Worker mocked runtime, separately enabled | **1 passed, 0 failed** |
| Cloudflare build | Passed: 73 root browser assets prepared |
| Both project-local Wrangler 4.152.0 dry runs | Passed; no uploads. Web 2253.94 KiB / 747.46 KiB gzip; API 7.69 KiB / 2.72 KiB gzip |
| Syntax / inline scripts / diff | Edited JS syntax, all 14 relevant inline scripts and `git diff --check` passed |
| Production read-only routes/assets/health | Passed; details below |
| Physical devices | **Not executed** |

Commands: `FREEUPPER_CHROMIUM=/usr/bin/chromium npm run test:sounds`;
`FREEUPPER_CHROMIUM=/usr/bin/chromium node --test --test-isolation=none tests/*.test.js tests/*.test.cjs`;
`npm run build:cloudflare`; project-local `wrangler deploy --dry-run` for both configs;
`FREEUPPER_TEST_BUNDLE=.wrangler/interaction-sounds-reviewed node --test --test-isolation=none tests/cloudflare-runtime.test.js`.

The broad run's five skips: three need a local Worker test origin, one needs a
compiled bundle, and one needs WebKit. The bundle check was enabled and passed
separately. The three origin-specific Worker tests remain unexecuted; local browser
coordinator/PWA tests and mocked compiled-runtime tests are distinct evidence.
WebKit download/host validation reported missing `libgtk-4.so.1`, `libgraphene-1.0.so.0`,
`libwoff2dec.so.1.0.2`, `libharfbuzz-icu.so.0`, `libhyphen.so.0`, `libmanette-0.2.so.0`
and `libGLESv2.so.2`; no WebKit pass is claimed. The last two unit boundary tests
and PCM-rendering case were added after broad-suite discovery and are included
in the latest 65-check focused run. Production engine/action code was unchanged
between the broad and final focused verification.

New checks cover actual five-tab navigation with the real engine/coordinator,
failed real Video Like with UI update while its RPC is unresolved, native context
suspension/recovery, offline error feedback, 20 rapid real taps, native oscillator
cleanup, actual Settings restoration/account switching/denied storage and isolated
browser contexts, all seven actual PCM palettes, hanging resume, closed context,
`webkitAudioContext`, first gesture before auth, per-category cancellation and
actual Repost/Undo callback failure paths. Existing notification/database tests
remain alongside the new checks; database writes in those tests are local fixtures.

## Performance and security observations

One controlled 25-sample desktop pair, not a statistically conclusive benchmark:

| Observation | Original feature | Reviewed feature |
| --- | --- | --- |
| Contexts created | 1 | 1 |
| Started / ended audible oscillators | 48 / 48 | 48 / 48 |
| Silent buffer sources | 75 | 1 |
| Synchronous interaction call p50 | 0.1 ms | 0.2 ms |
| p95 | 2.0 ms | 0.3 ms |
| Maximum | 8.0 ms | 4.6 ms |

No action awaits audio, and the unresolved-RPC test proves optimistic UI remains
responsive independently of sound/server completion. These numbers do not establish
real-device battery use, long-session heap behavior or production feed throughput.
The engine grows from 18,727 to 23,997 source bytes versus main; three newly precached
consumer scripts total 104,952 uncompressed bytes. No audio assets, third-party
sound requests or new dependencies are downloaded during an action.

New tones receive only fixed labels, never post/message payloads or identifiers.
No telemetry is added. Browser-local keys are account-scoped; trace diagnostics
retain their existing bounded, fixed-label design. The original authenticated
client and RPC boundary remain unchanged. No service-role key, metadata-based
authorization, table grant, RLS or Storage change is introduced. The sound auth
callback performs no awaited SDK work; normal settings sync remains deferred.
The Supabase auth/settings guidance was reviewed statically; no production user
or database was queried for synthetic actions. `getSession` is used only for
client sound eligibility, not as a new server authorization boundary.

Dependencies are unchanged from main. `npm outdated --json` reports available
updates for the existing SDK/tooling packages, including Supabase JS 2.117.2 →
2.119.0, Playwright 1.56.1 → 1.64.1 and Wrangler 4.152.0 → 4.158.0. The pinned
Miniflare beta is on a different release track from npm's stable tag; it was not
treated as a straightforward upgrade. Audit output is preserved for scoped
triage; an automatic major Vercel/OG upgrade could affect the existing custom
Worker build and was not attempted here.

## Production compatibility and browser limits

Only unauthenticated HTTP GETs were used against `https://freeupper.com`.
`/home`, `/search`, `/videos`, `/profile`, `/settings`, `/__migration/health` and
`/ui-sounds.js?v=4` returned HTTP 200. Health reported `ok`, public-route readiness
and verified release status. No test clicks, settings writes, user-data mutation,
API configuration or privileged database operation was performed.

All 15 reviewed browser production assets match latest main: 12 byte-for-byte;
`bottom-nav.js` and `side-nav.js` after their documented guarded route-helper
prefix; `service-worker.js` after its documented `-cloudflare-v1` cache suffix.
The production manager remains v3, and the worker cache remains v29. Requesting
`?v=4` currently still serves v3 bytes, as expected before deployment. This is not
validation of the candidate on production. Asset hash evidence is in
`/workspace/freeupper-review-evidence/production-comparison.json`.

The candidate's early versioned loader, coupled asset queries, v30 worker cache,
optional new method calls and new precached consumers address old cache entries.
The existing worker does not force `skipWaiting`; old clients may need to close
and reopen normally before activation. The automated PWA test installs the actual
new worker and fetches candidate consumers offline; it seeds an old cache rather
than physically upgrading an installed iPhone PWA. External auth/CDN availability
and full offline fresh login are not proven by that test.

| Platform | Evidence / limit |
| --- | --- |
| Desktop Chromium 155 | Actual automated trusted activation, lifecycle, action failure, Settings, PWA, graph rendering/cleanup and broad regressions passed |
| iPhone Safari / installed PWA | Static API review, mocked fallback/interruption cases and manual checklist only; **no physical pass** |
| Android Chrome | Desktop Chromium touch/mobile viewport coverage only; **no physical Android pass** |
| Desktop Safari/WebKit | Runtime unavailable as above; **not passed** |
| Firefox | API compatibility review only; **not executed** |

A native desktop test observed an asynchronous resume where the recovery tap did
not schedule a cue until a later fresh tap. The engine deliberately drops that
activation rather than replay it late. This can also apply to keyboard/VoiceOver
first gestures or a launch tap before auth completes. It needs explicit physical
characterization/product acceptance, not an assumption that OS audio policy can
be bypassed. Silent mode, output routing and device volume remain OS-controlled;
the implementation does not force an audio-session type or system volume.

## Rollback and recommendation

Before any approved rollout, retain the prior main frontend artifact and capture
the exact candidate SHA. A rollback should restore the prior frontend/loader/action
assets together, with a **new cache generation** (for example v31 carrying the
previous code) and consistent asset version URLs, then verify worker activation
and reload on test devices. Do not rely only on redeploying an old cache name or
clearing all user storage. Existing browser-local interaction preference keys may
remain unused safely in the prior v3 code. The API Worker/database/schema need no
rollback because this change does not alter them; existing user actions/data are
not undone by a frontend rollback. Re-run read-only route/asset checks afterward.
This is a plan, not an executed deployment or rollback.

**Recommendation: ready for a controlled, isolated non-production deployment and
physical acceptance using the attached checklist. Not approved for production.**
Before production, complete iPhone Safari/PWA acceptance (including first-tap and
interruption behavior), physical Android checks as required, and dependency risk
triage/remediation or documented risk acceptance. Obtain the user's explicit
approval before any production change. No production approval is being inferred
from passing tests or from this report.
