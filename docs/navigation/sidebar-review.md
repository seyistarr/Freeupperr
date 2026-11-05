# Sidebar navigation review

Base: latest `origin/main`, `cb364e7be2690ae0f7b5e6b6e38323656e41f6b7`, fetched and verified on 2026-11-05. Changes are local, uncommitted, unpushed and undeployed. Production configuration, database policies and secrets are unchanged.

## Destination and implementation inventory

The shared sidebar is the existing `<side-nav>` desktop/tablet rail, implemented by `side-nav.js` and `side-nav.css`. It appears at 768px and above; below that width the existing bottom bar is used. There is no drawer open/close controller to replace. Responsive hide/reveal is tested without navigating or recreating documents.

| Sidebar destination | URL | Previously | Local implementation |
| --- | --- | --- | --- |
| Home | `/home` | Opportunistic coordinator request; native fallback during bootstrap | Existing coordinator; retain launch/managed document |
| Search | `/search` | Same | Existing coordinator; retain results, query and scroll |
| Chat (optional `show-chat`) | `/messages` | Native anchor, including inside a managed frame | Native top-level anchor; no retained Chat document |
| Create | `/create` | Opportunistic coordinator request; native fallback during bootstrap | Existing coordinator; retain unsent text and attachments |
| Video | `/videos` | Same | Existing coordinator; retain feed/player state, suspend inactive media |
| Profile | `/profile` | Same | Existing coordinator; original synchronous privacy lease validation |
| Logo → Home | `/home` | Unhandled native anchor | Same coordinated Home request as the Home button |

The rail is present on Home (`index.html`), Search, Create, Video, Profile, Settings, Notifications (`notification.html`), Music, Saved Sounds and Sound. Chat imports the shared assets but does not instantiate the rail. The Chat conversations sidebar and reply drawer are internal messaging controls, not app destinations, and are unchanged. No Settings/Music/etc. destinations were added to the rail.

Chat needs additional lifecycle work before retention: conversation/message/presence/typing subscriptions, heartbeat intervals, microphone recording, view-once media timers and cleanup currently rely on visibility/pagehide and their own UI. Retaining it without explicit suspend/resume/dispose and account-boundary tests would create an unsupported sixth resident screen. It therefore keeps native navigation. Standalone auxiliary hosts such as Settings also keep their existing top-level entry into a primary tab; the coordinator deliberately only launches on the five primary documents. Guests, modified clicks and native deep links preserve browser routing.

## Root causes and changes

1. The logo lacked `data-side-key`, bypassing the click handler. Clicking it inside a retained Search document loaded Home into Search's iframe. The coordinator correctly rejected the unexpected document route and evicted it, but the selected Search screen then had no visible document. Chat could make the same frame-local navigation mistake. Native fallbacks now target `_top`, and the logo uses the existing managed Home request.
2. The sidebar only tried an already-loaded global coordinator. A click during script startup could perform a full HTML navigation and lose retained state. The existing screen lifecycle now supplies one memoized coordinator loader to both navigation components. A shared bootstrap intent token ensures the latest click across both components wins; it does not own routing, history or screen state.
3. The coordinator persisted only the bottom bar. It hid the root rail and waited for each child document's rail; cold shells consequently had no desktop navigation. The same coordinator now keeps one root rail above the managed document, removes redundant child rails, and synchronizes both components with the same announcement. Desktop cold shells clear the rail's existing 70/82px width.
4. Active sidebar classes came from each document's initial pathname. Public `setActive` and `aria-current` now follow the coordinator, including Back/Forward. The logo has a Home accessible label; the rail has a navigation label. Avatar updates still follow profile/storage events and clear an absent avatar.
5. The lifecycle's modal check only measured the mobile bottom bar. It now measures the visible navigation surface, so desktop full-screen dialogs can hide and inert both retained controls. Existing themes, breakpoints, markup/icons and page body offsets remain intact.
6. Stress testing in mobile WebKit exposed the native limit of 100 History API writes per 10 seconds: an exception inside `request` prevented activation. The existing coordinator now keeps normal history entries, coalesces sustained bursts after 50 tab writes to at most one write per 300ms, and reserves browser quota for existing detail/modal routing. Activation never waits for history. Pending writes are session/generation-scoped, preserve a changed deep-link URL, and cancel on Back/Forward or clear. A native `SecurityError` caused by another history owner is handled with a deferred latest-intent retry rather than a blocked screen. Regression tests cover 90 rapid requests, eventual URL agreement, Back cancellation and an injected native quota error.
7. Cache-first static assets could otherwise mix old rail styles/scripts with new coordinator code. Navigation asset query versions and the public PWA cache were advanced together to `sidebar-v1` / `freeupper-pwa-v29-sidebar`. Service-worker API/auth bypasses, public-shell-only caching, network/offline semantics and waiting-update policy are unchanged. No forced activation/reload was added.

All navigation still belongs to `FreeUpperProfileShell` in `profile-shell.js`; there is no second engine. `ProfileMounted.prepareVisible` still runs synchronously before visibility. The original expired-lease assertion remains zero cards. No profile authorization logic, snapshot scope, account isolation or lease duration was changed.

## Retention and memory

The original bound remains five primary documents: one launch document plus at most four managed frames. Only visited documents and the existing conditional Profile prefetch are initialized. Chat and auxiliary pages are not added to the resident set. Cold inputs hand off through the original coordinator; inactive documents keep their state and scroll, suspend existing lifecycle hooks/media/realtime work, and dispose on account changes/expiry/logout. Sidebar warm offline loops, 75 rapid requests, document identity and absence of child rail duplicates are covered. The original GC/memory bounds remain enforced.

## Modified files

- Behavior: `side-nav.js`, `side-nav.css`, `profile-shell.js`, `js/screen-lifecycle.js`, `bottom-nav.js`.
- Public PWA asset version/cache list: `service-worker.js`.
- Asset references only: `index.html`, `search.html`, `create.html`, `video.html`, `profile.html`, `settings.html`, `notification.html`, `music.html`, `saved-sounds.html`, `sound.html`, `chat.html`. Existing mixed line endings in Search were preserved apart from its edited stylesheet line.
- Regression coverage: `tests/five-tab-navigation.test.js`, `tests/profile-mounted-navigation.test.js`.
- Legacy source contract: `tests/quote-reposts-client.test.js` normalizes only the explicitly changed asset URL versions before its existing exact video/Explore hash assertions; player/media/API code remains protected.
- Review report: this document.

Existing tests that assumed only one `aria-current` element now explicitly select the bottom navigation. The Home visibility assertion now targets its actual header, rather than assuming the first body child is content (it is now the retained rail). All previous document-count and privacy assertions remain in place. The fixture safely ignores empty frame URLs during initialization. Cold-PWA test assets use production's versioned precache URLs. An independent minimal WebKit probe demonstrated that `context.setOffline(true)` leaves a brand-new cached iframe at `about:blank`, while physically disconnecting its HTTP transport loads the same cached document. The cold-PWA test therefore destroys fixture transport connections and sets the offline privacy signal, retaining all real-document/no-fetch assertions. Warm offline tests still use native offline emulation.

## Validation and measurements

Validation ran locally using the existing CI commands, without triggering GitHub Actions. Environment: Ubuntu 24.04.5, Node 24.22.2, Google Chrome 156.0.8078.79, Playwright 1.56.1 / WebKit build 2215. Project Wrangler remains 4.152.0. Latest `origin/main` was fetched again after validation and still equals the base above.

| Check | Final result |
| --- | --- |
| Focused sidebar/privacy tests, five repetitions | 55 passing (11 per repetition), no failures |
| Complete CI suite | 467 total; 463 passing, zero failures, four existing conditional skips |
| iPhone-compatible mobile WebKit navigation/Profile suite | 33 passing, no failures/skips |
| Local Worker-origin checks | 17 passing, no failures/skips |
| Web + API Worker builds/dry runs | Both passed; no remote deployment |
| Existing navigation geometry regression | 100 page/viewport/theme/safe-area cases passed |
| Diff whitespace check | Passed |

Three full-suite skips require a live local Worker and were exercised by the separate Worker-origin run. The fourth is the optional general WebKit theme suite, outside the existing required mobile navigation command. Running it additionally hit `WebKit encountered an internal error` on emulated-offline native navigation to Video. Unchanged main also timed out (120 seconds) in that optional harness. A supplemental transport-disconnected copy of the full theme harness timed out too; it is inconclusive. No theme source or tracked theme test was modified. This remains an automation/coverage limitation, not a claimed passing check. The required WebKit suite's sidebar theme synchronization and actual transport-offline cold-PWA tests both pass.

Commands (same build/test gates as CI):

```sh
npm run build:cloudflare
npx wrangler deploy --dry-run --outdir .wrangler/test-build
npx wrangler deploy --config cloudflare/api/wrangler.jsonc --dry-run --outdir .wrangler/api-test-build
node --test --test-isolation=none tests/*.test.js tests/*.test.cjs
FREEUPPER_PROFILE_ENGINE=webkit node --test --test-isolation=none tests/five-tab-navigation.test.js tests/profile-mounted-navigation.test.js
# Against wrangler dev --local --port 8787:
FREEUPPER_TEST_ORIGIN=http://localhost:8787 npm run test:cloudflare
```

The final build was checked to contain the exact revised coordinator, navigation components, lifecycle and sidebar CSS. The built PWA cache uses the existing Cloudflare build suffix: `freeupper-pwa-v29-sidebar-cloudflare-v1`. Local logs and screenshots are in `/tmp/freeupper-sidebar-results/`.

### Before/after samples

Both versions were measured serially in the same CI-matching container. Baseline is the unchanged latest main; after is the local diff. Measurements run from click dispatch to the next animation frame, with a 1,000ms cold HTML fixture delay. These are small fixture samples, not physical-device finger-to-pixel measurements or live-backend benchmarks.

| Measurement | Main / Chrome | Revised / Chrome | Main / WebKit | Revised / WebKit |
| --- | --- | --- | --- | --- |
| Cold shell first frame | 12.4ms; rail absent | 37.8ms; rail visible | 63ms; rail absent | 71ms; rail visible |
| Warm Search first frame | 36.3ms | 6.1ms | 5ms | 11ms |
| Logo → Home | Frame evicted after 231ms; Home remained hidden | Home visible at 12.1ms | Frame evicted after 271ms; Home remained hidden | Home visible at 6ms |
| New documents on logo return | 1 | 0 | 1 | 0 |

Warm primary links already sometimes used the coordinator on main; this fixes coverage, retention, bootstrap races and cold navigation availability rather than claiming every existing path was slow. Single frame samples vary with browser initialization/scheduling. Across five final Chrome repetitions, cold shell commits took 0.9–8.4ms and first-frame samples 6.9–59.4ms; warm commits took 3.1–6.3ms and first-frame samples 5.2–17.3ms. The initialized destination is made visible synchronously in the click task. Cold controls remain usable while HTML is held and data loads; no normal Opening overlay is added. The ten-second feed tests retain their original strict document counts and pass in both engines.

GC verification kept 4,644 DOM nodes and 503 listeners across all three samples; heap rose from 5,368,412 to 5,410,804 bytes (about 41.4KiB), within the original enforced bounds. Managed primary documents remained capped at five, including during offline and burst navigation. These are bounded fixture checks, not a long-duration physical-device memory study.

The browser fixtures use real page markup/CSS, both navigation components, the production coordinator/lifecycle and production Search/Profile/Video logic, with deterministic authentication/backend/media fixtures. They are not measurements of live Supabase or Cloudflare availability.

Remaining boundaries: Chat and auxiliary-root entry remain native as described above. A first uncached screen must still fetch its HTML/data to complete loading; its shell and navigation are usable immediately. A blocked first-ever coordinator script must finish loading before it can handle routing, with latest-intent fallback preserved. Under extreme history churn, intermediate history entries are coalesced and the address bar can trail the visible tab by up to the batching interval. If another native history owner exhausts the browser quota, its reset can defer that URL write longer; screen visibility is never deferred. Automated mobile WebKit/PWA checks do not substitute for a physical-device Safari/installed-PWA pass. No live authenticated production testing or release has been performed for this change.
