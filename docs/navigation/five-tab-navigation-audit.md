# Persistent five-tab navigation

Baseline: production main `44794c3231828b1ec46a6a75c323de45c64337bc`.

## Findings

The previous `FreeUpperProfileShell` retained only Home and Profile. Search and
Video were native document links; Create had an independent button handler that
assigned `location.href` before the shared navigation handler could coordinate it.
Home/Profile retention also depended on a resolved authenticated session; links
could fall back to document navigation while session binding was pending.

The retained shell hid the source immediately, even when its destination iframe
had not loaded. Its iframe covered the source navigation, and the destination's
bar was not present until its own component initialized. That produces both a
blank transition and a missing bar without necessarily reloading the outer page.
The two documents each rendered their own navigation.

Home/Profile data refresh, skeleton reconstruction and profile authorization
revalidation are separate from document navigation. The retained documents and
DOM identity can survive those requests. Installed PWAs added another issue:
network-first document failures could return cached Home HTML for another tab.
Cache-first scripts/styles also needed new URLs, independently of the service
worker's next activation. Home's old cross-document View Transition opt-in could
report aborted transitions on guest document navigation.

## Architecture and lifecycle

The existing `profile-shell.js` remains the only tab coordinator and history
owner. Its legacy global name stays compatible with Profile. `router.js` keeps
post, video, public-profile and detail URL semantics; Profile keeps relationship
and detail history. There is no new router or swipe interception.

One outer `bottom-nav` node stays mounted. Managed child screens do not render
another navigation component. The source remains visible during cold startup;
a destination becomes visible only after its page signals usable content.
Repeated taps coalesce, selection updates synchronously, and warm screens reuse
the same document and nodes. Native destinations outside plain tab transitions,
such as opening a post from Search or finishing publication, leave the managed
frame so their existing URLs remain real document URLs.

Screens have explicit Uninitialized, Initializing, Active, Suspended and Restored
states. `js/screen-lifecycle.js` supplies lifecycle hooks and scroll restoration;
page adapters own their data and initialization. Suspended observers disconnect,
feed dwell timers stop, native audio/video pauses, YouTube playback receives
pause commands, and page/header realtime channels close. Resumption recreates
channels without multiplying callbacks. Existing nested Profile renderers follow
their owning screen and detail visibility rather than becoming another tab.

Retention normally permits four tab documents including the launch page, with
one temporary initializing document during a cold handoff. Home/Profile DOM and
an unsent composer take priority. An empty composer is evicted first, then Video,
then Search. Search snapshots contain query, results, filters, paging and scroll;
they are cloned, limited to 2 MiB, viewer scoped, and leased for at most 60 seconds.
Expired snapshots keep controls but refetch authorized results. Video eviction
keeps order/position/timestamp metadata and reloads an authorized feed; it does
not preserve protected URLs as a grant. Such returns are measured as cold.

A Search/Video launch cannot remove its own document. If retaining both primary
feeds and a dirty composer would otherwise prevent the remaining tab from
opening, the coordinator permits five tab documents while that extra screen is
active. It evicts the extra suspendable screen on departure. This is bounded to
four child tab frames, never five retained heavy iframes. A dedicated Video-launch
regression verifies the draft, limit and return to four documents.

Logout, identity changes and lease expiration dispose child resources and draft
guards, clear snapshots, remove private root content, and replace the launch
document to clear its JS heap. This reset is deliberately a document navigation
at an account boundary. It performs one native replacement rather than rewriting
joint history immediately before a reload, which triggered a desktop WebKit
assertion during regression testing. Restored disposed bfcache documents restart.

The bar retains the existing 64px plus safe-area contract. Managed screens receive
the outer measured safe area; this avoids nested iframe environments losing the
iPhone inset. Video's existing scrubber offsets are unchanged. Keyboard handling
uses the focused leaf document and the outer visual viewport. Theme tokens remain
shared and are synchronized before destination visibility.

Protected media is released on suspension and reauthorized on return. Feed/grid
DOM and statistics remain retained, but private bytes can require a fresh request;
retention does not bypass privacy checks. Gateway, API authorization, database,
Supabase RLS and publication gates are unchanged. No private snapshot is written
to local storage or a service-worker cache.

## Measurements

See [five-tab-measurements.json](five-tab-measurements.json). These are local,
automated fixtures with real markup/CSS and production navigation/lifecycle code,
not production network measurements or physical iPhone results.

| Screen | Cold coordinator commit | Warm coordinator commit |
| --- | ---: | ---: |
| Home | 480.5 ms | 4.7–6.9 ms |
| Search | 279.5 ms first visit; 192.2–209.5 ms after eviction | 5.6 ms |
| Create | 221.2 ms | 2.5–4.2 ms |
| Video | 293.9 ms first visit; 281.3–321.4 ms after eviction | 2.3 ms |
| Profile | 556.1 ms | 3.4–5.0 ms |

Home/Profile cold tests inject 350 ms of document delay; other destinations inject
100 ms, and Video additionally injects 80 ms of feed delay. The first Search
response is held across an animation frame to assert that Home and the persistent
bar remain present. Assertions check destination state on the first animation
frame of warm returns; coordinator commit timing is not a GPU paint metric.

After repeated dirty-composer five-tab cycles, Chromium CDP reported 3,960 nodes
and 389 listeners in every post-GC sample. Heap samples were 4.60, 5.00 and 5.03 MB.
The stable seven-document CDP count includes nested documents, whereas the shell's
retention limit counts tab documents. This does not establish a physical iOS memory
budget or bound how much feed content a user loads independently of navigation.

## Files and verification

- `profile-shell.js`, `js/screen-lifecycle.js`: coordination, history integration,
  lease boundaries, bounded retention, scroll and resource lifecycle.
- `bottom-nav.js`, `bottom-nav.css`, `side-nav.js`: persistent component ownership,
  keyboard behavior, active state and existing geometry.
- `index.html`, `search.html`, `create.html`, `video.html`, `profile.html`: early
  lifecycle boot, screen adapters and fresh asset references.
- `router.js`, `profile-detail.js`: managed-frame native destinations and owned
  renderer visibility, preserving existing detail/relationship history.
- `search.js`, `posts.js`, `header-badges.js`, `protected-media-client.js`: bounded
  snapshots, subscriptions, timers and private-media lifecycle.
- `service-worker.js`: v26, matching offline document fallback and versioned
  navigation dependencies; no skip-waiting that could discard a draft.
- `tests/five-tab-navigation.test.js`, `tests/protected-media-browser.test.js`:
  timing, identity, scroll, drafts, native media, geometry, keyboard, rapid taps,
  Back/Forward, deep links, guest navigation, PWA, auth boundaries and retention.
- `tests/fixtures/quote-legacy-contracts.json`: refreshed Video source hash for
  intentional lifecycle edits; functional quote/media/routing contracts remain.

Repository checks use the existing complete Node test command, Cloudflare web/API
dry-run builds and the local Worker route/privacy checks. The shared layout suite
still checks 100 viewport/theme/safe-area combinations. Desktop WebKit also runs
the navigation and original mounted-Profile regressions.

The Linux WebKit/WPE offline driver blocks fresh document navigations before its
service worker responds, so evicted-document offline restoration is asserted in
Chromium; WebKit asserts warm offline returns. WPE's silent-WAV seeking backend
uses a finite timestamp double in that assertion; native play/pause is exercised.
No physical iPhone, installed iOS PWA, real keyboard or iOS swipe gesture testing
was performed. Back/Forward use native browser history in both automated engines.

Final local verification on 2026-10-31: complete repository suite **438 passed,
2 optional checks skipped, 0 failed** (440 total). The local Worker-origin check
was then run separately: **8 passed, 0 skipped**. Desktop WebKit's five-tab and
original mounted-Profile suites: **15 passed, 0 skipped**. Web/API dry-run builds
passed. Release uses the existing `cloudflare-tests.yml` push-to-main workflow;
its test job must pass before the production deploy job runs.

The optional standalone WebKit theme suite reaches its offline `page.goto` and
reports `WebKit encountered an internal error`. The same test fails at the same
line on the untouched production baseline in a separate worktree. This is a
pre-existing runner limitation, not counted as a passing check; the complete
Chromium theme/PWA test passes. Online and warm-offline WebKit navigation remains
covered by the 15 passing regressions above.

A final overlay regression covers both the launch document and retained screens:
full-screen dialogs retain priority over the bar, including their bottom controls.
The navigation component stays mounted and returns when the dialog closes;
nonmodal toasts do not hide it. The active screen reports visible overlay state
to the same coordinator, and its observer disconnects on suspension. This avoids
raising the outer navigation above existing post, relationship and composer dialogs.
The correction uses v2 navigation assets and PWA cache v26 so previously cached
navigation code cannot retain the old stacking behavior.
