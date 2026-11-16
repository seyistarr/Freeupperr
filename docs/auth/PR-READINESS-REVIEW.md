# Email authentication PR readiness review

Date: 2026-11-16. Branch: `fix/email-auth-confirmation-recovery`.
Starting feature commit: `0c8d5ee`. Latest fetched main: `b943598eeb6cac1a6ab06b3235254f0c38581be1`.
Main has not advanced; the feature branch contains that main commit and has no merge conflicts.
This review supersedes the incomplete validation status in the initial Phase 2 report.

## Navigation timeout: investigation and correction

The original unmodified geometry test was run independently on both branches:

| Checkout | Original test result | Duration |
| --- | --- | --- |
| Main (`b943598`) | All 100 geometry cases and interaction assertions passed | 79.8 seconds |
| Feature before fixture correction | Same checks passed | 81.7 seconds |

A diff of the fixture, navigation JavaScript/CSS, theme controller, route helper and the five matrix
HTML pages was empty between those checkouts. The fixture removes auth/backend scripts from those
pages. This establishes compatible isolated behavior; it does not establish the exact scheduler
or resource condition behind earlier full-suite timeouts.

The confirmed test-design problem was one 120-second timeout covering 100 geometry cases, 350 ms
transition waits in every case, screenshots, and all keyboard/history/composer/scrubber checks.
Cancellation did not bound each case's page lifetime. The revised fixture retains the assertions,
100-case matrix, screenshots and transition waits, but partitions them into 20 geometry tests
(30-second bound each) and an interaction test (60-second bound). Each test registers page cleanup
on cancellation. It passed all 21 checks in 92.8 seconds in the initial partitioned run.
The CI job budget is now 30 minutes for the full repository, browser installation, WebKit and
local Worker stages; production deployment remains gated to a push to main. No navigation layout code, expected geometry, assertion or matrix coverage was changed for the
geometry correction. The separate native media guard below is the only additional product change.

## WebKit offline investigation

An expanded full run completed with 605 passes, 8 optional skips and one failure: WebKit returned
an internal error when Playwright offline emulation navigated to cached `video.html`. The same
failure was reproduced on unchanged main, at the same line and step. The theme fixture now fails
its own server transport for WebKit instead of using emulation. It explicitly checks service-worker
control and a cached video shell, then verifies offline theme persistence, switching and reload.
Chromium retains emulated offline testing. The corrected WebKit theme test passed independently.
No application response or cached body is stubbed to turn a failure into success. CI now includes
the WebKit theme check and the six supported Chromium/WebKit offline matrix cases. The two known
WebKit emulated-offline matrix variants are not used as a mandatory gate; transport outages
exercise actual service-worker cached navigation instead.

## Native media retention: baseline and native probe

The full WebKit navigation run found a sidebar retention assertion failure, which also reproduced
on main. The application requested the correct saved position (for example 0.4545 seconds), but
WebKit's native seek returned 0. A separate page without the app reproduced this with both the
existing MP4 and a temporary all-intra-frame MP4: seeking a paused video to its current position
reported a `seeked` event at 0. This ruled out simply blaming the WAV fixture or app identity state.

`video-player.js` now skips a redundant resume seek when native playback is already within 0.01
seconds of the retained position. Required seeks retain the existing behavior. The sidebar fixture
uses the existing native MP4 with HTTP range support; it checks real playback, native pause,
retained time, retained document/feed and active screen, plus absence of a redundant seeking event.
The corrected native WebKit case passed independently. No synthetic time getter or increased
position tolerance was used. This does not claim to fix every codec/seek behavior in WebKit.

## Security findings and fixes

- Recovery marker lifetime previously renewed on reload and only matched the user UUID. It is now
  bound to the Supabase session ID, has a fixed 15-minute expiry, rejects invalid callback errors,
  and rechecks both account and session before password update. The decoded ID is a UI correlation
  value, not an authorization decision: the Supabase server validates the update's credentials.
  The marker contains no access/refresh token or password.
- A pending login could finish after its modal was closed/replaced and resume a different pending
  action. Modal-generation checks now prevent stale completion from resuming a replacement action.
- Arbitrary backend error-object serialization and raw OAuth error messages were removed. Unknown
  diagnostics are replaced by safe generic text. Recovery/resend missing-account errors and duplicate
  signup receive neutral responses without login/signup fallback or automatic linking.
- Cooldowns cover confirmation and recovery sends and server 429 responses. They are UX controls,
  not a security boundary; server rate-limit/CAPTCHA/hook settings still require manual review.
- Confirmation/recovery links are processed by the existing Supabase SDK flow. No custom confirmation/recovery-token verifier, bearer-token logging, open redirect, service-role
  client key or identity-linking endpoint
  was added. Google retains provider `google` and its existing current-page redirect.
- Accepted passwords are cleared before profile loading, including retry/failure states; they are
  never persisted in local/session storage.
- Existing public anon keys and session storage key are unchanged. The browser's existing floating
  Supabase v2 CDN dependency remains a supply-chain/version risk; this PR does not silently migrate
  SDK versions or authentication flows. A separate approved pin/self-hosting change may address it.
- A compromised same-origin script can access browser sessions; the local recovery marker is not
  claimed to defend against XSS. Server authorization, password policy and revocation remain required.

Tests cover fixed marker expiry, wrong/expired sessions, invalid callbacks, same-user session
replacement, modal replacement, neutral account-state responses and diagnostic redaction.

## Identity and content preservation

No production mutations, account logins, confirmation/resend/reset emails, identity links,
migrations, profile upserts or replacement accounts were performed. The repair's changes do not
rewrite UUIDs, FreeUpper IDs, usernames, display names or content references. Authentication reads
the existing server-created profile. Isolated database tests verify identity defaults, repeated
email/Google authentication, custom presentation, rollback and existing RLS/content boundaries.

The authorized read-only aggregate query on 2026-11-16 returned 73 Auth users, 73 profiles, zero
Auth users missing profiles, zero orphan profiles, and zero duplicate profile IDs. No user IDs,
passwords/hashes, tokens or messages were retrieved. Without exporting a historical identity
snapshot, this is an integrity check, not a claim that no unrelated user changed their profile.

The original legacy video/Explore whole-file fingerprint initially rejected the reviewed media
guard. Its expected hash is unchanged: the test normalizes exactly that one asserted guard block
back to the prior line before hashing. Native media regressions cover the exception; all other
legacy bytes remain protected.

## Final validation

All mandatory local gates are clean:

| Check | Final result |
| --- | --- |
| Complete repository, including local Worker routes and WebKit theme | 614 tests: 606 passed, 0 failed, 8 opt-in matrix entries skipped; 546.9 seconds |
| WebKit authentication, five-tab and mounted-profile navigation | 71 passed, 0 failed, 0 skipped; 271.6 seconds |
| Supported offline matrix (both main and feature) | 6 passed, 0 failed, 0 skipped |
| WebKit theme with actual transport outage | Passed independently and in the complete suite |
| Legacy video/Explore contracts and quote client checks | 7 passed; also passed in complete suite |
| Syntax, whitespace and generated/source parity | Passed |
| Web and API Worker dry-run packaging | Passed; no upload/deployment |

The eight opt-in entries are not omitted mandatory failures: six supported variants were run
separately. Two WebKit emulated-offline variants are known engine/tooling limitations, reproduced
on main; mandatory WebKit offline coverage uses actual transport outages instead.

Reproduction uses Node 24 and the locked dependencies, Chromium, Playwright WebKit, and a local
Wrangler server without production secrets. In the temporary Debian environment, WebKit and
missing runtime libraries were placed under `/tmp`; no system package was changed. The host
package-location validator was disabled for that temporary library layout, not browser tests.
Actual browser launch, playback, cached navigation and assertions ran. CI uses the official
Ubuntu 24.04 `playwright install --with-deps webkit` setup.

```sh
npm run build:cloudflare
WRANGLER_SEND_METRICS=false npx --no-install wrangler deploy --dry-run --outdir .wrangler/test-build
WRANGLER_SEND_METRICS=false npx --no-install wrangler deploy --config cloudflare/api/wrangler.jsonc --dry-run --outdir .wrangler/api-test-build
# Start wrangler dev --local on 127.0.0.1:8787, without .env/.dev.vars production credentials.
FREEUPPER_TEST_BUNDLE=.wrangler/test-build FREEUPPER_TEST_ORIGIN=http://127.0.0.1:8787 FREEUPPER_CHROMIUM=/usr/bin/chromium FREEUPPER_WEBKIT=1 node --test --test-isolation=none --test-concurrency=1 tests/*.test.js tests/*.test.cjs
FREEUPPER_PROFILE_ENGINE=webkit FREEUPPER_AUTH_ENGINE=webkit node --test --test-isolation=none --test-concurrency=1 tests/five-tab-navigation.test.js tests/profile-mounted-navigation.test.js tests/email-auth.test.js
FREEUPPER_CHROMIUM=/usr/bin/chromium FREEUPPER_OFFLINE_MATRIX=1 node --test --test-isolation=none --test-name-pattern='chromium|webkit.*transport' tests/gallery-offline-browser.test.js
```

CI now includes the WebKit auth and theme cases, the supported offline matrix, and local Worker
acceptance. Its production deployment condition is unchanged and tested: only a push to main can
enter that job. Feature-branch publication and PR checks do not authorize production deployment.
GitHub Actions status is reported on the PR; these local results do not substitute for it.

## Changed files after the Phase 2 checkpoint

- `auth.js`, `reset-password.js`: security fixes above; credentials cleared before profile retry.
- `video-player.js`: one redundant native-seek guard; no media authorization/API changes.
- `tests/email-auth.test.js`, `tests/helpers/email-auth-fixture.js`: security cases and WebKit runner.
- `tests/bottom-nav-layout.test.js`: bounded cases and cancellation cleanup, same geometry coverage.
- `tests/five-tab-navigation.test.js`: native MP4/range fixture and retained-time regression.
- `tests/theme.test.js`: real WebKit fixture-transport outage instead of broken offline emulation.
- `tests/quote-reposts-client.test.js`: exact reviewed guard normalization, same remaining hash.
- `tests/gallery-main-preservation.test.js`: allow reviewed CI edits; other fingerprints unchanged.
- `.github/workflows/cloudflare-tests.yml`: sufficient job budget and explicit browser/offline gates.
- Auth review documents: historical report annotated, this review and exact manual checklist added.

## Private configuration and production approval

Private Auth configuration is not exposed by the connected tools. Follow
[the exact read-only manual checklist](PRODUCTION-AUTH-MANUAL-VERIFICATION.md) for SMTP, Site URL,
redirect allowlists, Google callback, confirmation/recovery templates, password/reauthentication
policy, CAPTCHA, server rate limits, hooks and session/revocation settings. No item is represented
as verified merely because mock tests pass. Incompatible or unverified settings block production
approval, not creation of a clearly labelled code-review PR after all mandatory code checks pass.

Do not merge, deploy, alter production settings, send production emails or test real-user accounts
as part of this review. Await separate approval for production work.
