# Immediate five-tab navigation — 2026-11-04

This supersedes the four-document eviction policy in the earlier five-tab audit.
Implemented on main `a7dfdd3`, incorporating all five intervening post-rendering
commits. Navigation behavior was unchanged between the measured baseline
`ff500e7` and that implementation base.

## Root cause and reproduction

`profile-shell.js` created a hidden destination document, left the previous screen
visible, displayed `Opening <tab>…`, and refused activation until `entry.loaded`.
That flag depended on `FreeUpperScreen.ready()`, which generally meant completed
backend hydration: Home after `await reloadData()`, Search after result/discovery
requests, Video after its feed request, and Profile after its profile-ready event.
Profile additionally polls for Supabase initialization with a 10,000 ms timeout.
There was no intentional 10-second tab animation: the UI inherited document,
script, API and media initialization latency. The coordinator's own failure
timeout is 20 seconds; neither timeout should be a navigation prerequisite.

A four-document cap also evicted Search and Video as users visited all five tabs.
Returning to those tabs repeated document/script initialization and hydration.
On the original fixture with only 100 ms document / 80 ms feed latency, repeated
Search visits took 188–239 ms and Video visits 268–297 ms in Chromium. Initialized
Home/Profile were already fast; this fix extends retention to every tab.

The controlled reproduction sets the same Video feed promise to **10,000 ms**:
original code takes **10,662 ms** from tap to document visibility; fixed code takes
**343 ms Chromium / 371 ms WebKit**, while the feed remains pending. The cold shell
is visible before the destination HTML. Those document times include Playwright
click and document initialization overhead; they are not the shell switch time.

The PWA worker was also network-first for tab documents. A slow connection did
not use its precached shell until fetch failed. Managed tab requests now return
only install-time public HTML shells from the versioned cache when available.
API, authorization, public-profile and post deep-link routing remain unchanged;
no runtime viewer HTML or private response is cached.

## Changes

- The existing `FreeUpperProfileShell` remains the sole coordinator/history owner.
  All five document instances remain until logout, account change or session
  expiry. There is no ordinary-tab eviction and no new router.
- Initialized tabs switch visibility synchronously. Existing DOM, scroll, search
  results, File objects, composer drafts and video feed position survive.
- Cold tabs show a destination shell immediately, before creating the iframe's
  browsing context. Search accepts text; Create accepts text and attachments.
  Pending input survives tab switches and transfers to the initialized page.
  Shells explicitly identify loading content and show retry on document failure.
- DOM initialization makes the real screen eligible for display. Feed/profile
  hydration and media requests finish independently. Existing refresh, permission
  checks, realtime subscriptions and media lifecycle remain in place. Profile
  preparation runs after the visibility commit.
- Inactive videos/audio and owned renderers suspend through the existing lifecycle;
  video position restores and existing observers/user controls govern playback.
- Normal `Opening…` messages are removed. Errors remain actionable; hiding an
  overlay is not used as a substitute for activation.
- Navigation asset URLs use `native-tabs-v1`; the PWA cache advances to v28.
  Waiting-worker updates still do not force-reload an unsent draft.
- Separate `fu-tab-active` and `fu-tab-content-ready` events distinguish immediate
  shell switching from subsequent document readiness.

## Measurements and validation

[Raw samples and method](native-tab-measurements.json), mobile viewport 390×844,
touch enabled. Local fixtures use real markup/coordinator/lifecycle and real
Search/Profile/Video code, with deterministic backend responses. They do not
represent authenticated production traffic or a physical iPhone.

| Tap to next animation frame, warm tabs | Chromium | WebKit 26 |
| --- | ---: | ---: |
| Median | 8.7 ms | 8 ms |
| 95th percentile | 11.3 ms | 16 ms |
| Maximum | 12.4 ms | 26 ms |

Cold Search/Create/Video visibility commits were 1.7–6 ms Chromium and 2 ms
WebKit. Their next-frame samples were 7–8.1 ms Chromium and 8–51 ms WebKit.
The separate cold-Create typing/attachment check measured 4.6 ms Chromium and
55 ms WebKit to its first frame. Thus warm navigation normally meets the
one-frame target; initial WebKit rendering can take additional frames. No
network promise participates in those visibility commits.

Verification performed:

- Complete repository suite: **448 passed, 4 optional checks skipped, 0 failed**.
- Final navigation suites: **12/12 Chromium and 12/12 WebKit**, plus **6/6**
  mounted-Profile WebKit regressions. The additional cached-PWA document test
  passed separately in both engines (now 13 navigation tests / 19 WebKit tests
  in the release workflow).
- Tests cover a pending 10-second feed, a held cold document, input/File handoff,
  persistent document/nav identity, scroll/results, video pause/time, draft state,
  Back/Forward, direct queries, guest fallback, logout/account/expiry boundaries,
  overlay stacking, safe-area/keyboard geometry and offline/waiting-worker returns.
- All **17** Cloudflare checks passed against the built local Worker origin.
  Web and API Worker dry-run builds passed. Current-main post/quote contracts
  passed (7 tests); the legacy player hash check exempts only the two changed
  navigation asset-version strings, preserving its other source/API contracts.
- Cold shells were visually inspected in Chromium and mobile WebKit. Existing
  WPE video seek assertions retain their documented timestamp double; native
  play/pause is exercised. No physical iPhone or authenticated production session
  was available for device/account smoke testing.

## Release

Release uses `.github/workflows/cloudflare-tests.yml`: a push to main runs the
existing full build/test/Worker-origin gate, now additionally installs and runs
mobile WebKit navigation/Profile verification, then deploys `freeupper-web` via
`wrangler deploy --keep-vars` to the existing production domains. The API Worker
is not redeployed by this change. The deployment commit is the commit containing
this report; workflow status and production asset verification are reported in
the task's final response after publication.
