# Bottom navigation layout audit

Baseline: `ea98f27dcd8a2421fd29885b2c10aa92a42da725` (main).

## Findings before implementation

All five pages already render one shared custom element. Its visible mobile
height is **64px + the bottom safe-area inset**, including its 1px border with
border-box sizing. Safari and installed PWAs share this rule; their actual inset
and usable viewport depend on device, orientation, browser chrome and installation.
There was no evidence justifying a visual height change.

| Page | Actual scroll owner | Previous spacing / root cause |
| --- | --- | --- |
| Home | Document | A separate 72px token plus 20px body padding omitted the inset. Toast/footer offsets also used this separate token. |
| Search | `#mainScroll.main` | Fixed 90px padding could be smaller than the bar. Its containing layout used 100vh. |
| Create | `#mainScroll.main` | 80px, max(80px, inset), and a later important 78px + 40px + inset rule competed; the final rule over-reserved space. 100vh did not account for the visual keyboard viewport. |
| Video | `#feedTrack`, snapping full-screen `.v-card` elements | Scrubber, mute, information/actions and image dots used a separate 78px offset without the inset. Scrubber had a higher stacking level than navigation, making overlapping hit areas particularly problematic. |
| Profile | `#mainScroll.main` | Fixed 80px padding could be smaller than the bar. Its containing layout used 100vh. |

`global.css` supplies border-box sizing and theme tokens; it does not own bar
geometry. `bottom-nav.css` had repeated geometry declarations, but page content
and video overlays did not consume that geometry. Fixed/sticky headers and modal
sheets have independent positioning; modal overlays stay above navigation.
The bar's below-viewport surface extension remains noninteractive.

## Shared contract

`bottom-nav.css` owns `--bottom-nav-height: 64px`,
`--bottom-safe-area: env(safe-area-inset-bottom, 0px)`,
`--bottom-nav-total-height`, `--bottom-content-gap: 12px`, and
`--bottom-nav-clearance` (total height + gap). Safe-area padding belongs inside
the bar once. Content reserves the resulting total once.

Apply `.bottom-nav-scroll` to the scroll owner (Home body; other pages' main
scroller). Apply `.bottom-nav-viewport` to a nested scroller's viewport wrapper.
The viewport uses 100vh fallback, 100dvh when supported, and the visual viewport
height while typing with a keyboard. Navigation becomes noninteractive and hidden
while the keyboard reduces the visual viewport; clearance remains reserved so
content cannot slip under the restored bar. Desktop navigation remains hidden
and its reserved height becomes zero. Theme surfaces and purple tokens are unchanged.

Video media and cards remain full-screen with their existing object-fit settings.
The scrubber's bottom edge is total bar height + 12px; mute has 4px clearance,
and caption/action/image-dot offsets now include the same total bar height.
Existing pointer capture, seeking, pause/resume and hidden-video pausing remain
unchanged. No new black strip or media size reduction was introduced.

## Navigation behavior

- Home/Profile still use the original authenticated, session-leased retained
  iframe shell. `profile-shell.js`, `router.js`, profile caches and rendering
  were inspected and remain unchanged. Native Back/Forward and modal history
  remain owned by those implementations. No new swipe gesture interception.
- Search/Create/Video retain their existing document-navigation architecture.
  Tapping their current tab now preserves input, scroll and playback instead
  of reloading. Brief duplicate-click suppression resets even if exit is cancelled.
- Shared shell loading coalesces repeated requests. Existing active Home/Profile
  behavior remains delegated to the shell.
- Public `/u/...` and `/@...` profiles now identify the Profile tab, and all five
  destinations are root-relative so `/u/...` cannot resolve Search to `/u/search.html`.
- Active destinations expose `aria-current="page"`; regular targets have minimum
  44px hit dimensions. The existing purple Create circle remains unchanged.
- Unsent post title/content/media/quote installs a conditional beforeunload
  warning. Successful publication removes it. No draft storage was added.
  Mobile OS process termination cannot be guaranteed recoverable by this guard.
- Search query restoration outside retained roots still depends on its existing
  URL/native history/bfcache behavior; this change does not add a search cache.
- Service worker cache advances v23 → v24 and precaches navigation assets, so
  existing cache-first CSS/JS cannot retain stale geometry after activation.
  Activation, network-first documents and privacy exclusions are preserved.

## Measurements and verification

Automated Chromium geometry tests use actual page markup/CSS and shared navigation,
with deterministic final interactive controls/video overlays and external backend
scripts removed. They do not represent live authenticated content screenshots.
Safe-area values are simulated CSS inputs; keyboard resizing uses a VisualViewport
test double. See [geometry.json](geometry.json) for before/after measurements.

At 390×844 with a simulated 34px bottom inset, all bars stay 98px high:

| Page | Before clearance | After clearance |
| --- | ---: | ---: |
| Home | -6px | 12px |
| Search | -8px | 12px |
| Create | 54px | 12px |
| Video scrubber | -10px | 12px |
| Profile | -18px | 12px |

Negative values mean an overlapping hit area. Tests cover 375×667, 390×844,
430×932, 360×800 and 667×375, light/dark themes and 0px/34px safe areas:
100 page/viewport/theme/inset combinations. They also exercise the five requested
navigation sequences, native Back/Forward, public profile routes, rapid taps,
composer preservation/exit guard, keyboard changes, actual production scrub
handlers with a finite-duration media double, minimum touch sizes and single bars.

The existing retained Profile suites cover real retained DOM identity, scroll,
tabs, counts, caches, offline leases, account changes and relationship modal history.
The same suite was also run under the actual service worker in Chromium.

No physical iPhone, installed iOS application or native iOS swipe-back was tested.
WebKit downloaded but could not launch because this Linux runtime lacks its GTK,
Graphene, WOFF, Harfbuzz ICU, Hyphen, Manette and GLES dependencies. Browser
safe-area/keyboard simulations and service-worker tests do not establish physical
iOS behavior. Authenticated publishing and live media were not mutated for testing.

The quote legacy fixture's video hash was refreshed after reviewing the video
diff: only viewport fallback and CSS overlay geometry changed; video JavaScript,
legacy APIs, media normalization and view tracking remain unchanged.

## Files changed

- `bottom-nav.css`: shared geometry, scroll/viewport utilities, keyboard state and hit targets.
- `bottom-nav.js`: visual viewport integration, current-tab/rapid-tap handling, accessible active state and absolute destinations.
- `index.html`, `search.html`, `create.html`, `profile.html`: scroll-owner opt-in and removal of competing clearance rules; Home overlay offsets; conditional unsent-post exit guard in Create.
- `video.html`: shared overlay offsets and full-screen viewport fallbacks.
- `service-worker.js`: navigation asset cache refresh.
- `package.json`: include layout assertions in `test:bottom-nav`.
- `tests/bottom-nav-layout.test.js`: geometry and navigation regression coverage.
- `tests/fixtures/quote-legacy-contracts.json`: reviewed CSS-only video hash refresh.
- `docs/navigation/bottom-navigation-audit.md`, `docs/navigation/geometry.json`: findings, test limits and measurements.

Final local validation: full suite **431 tests: 430 passed, 0 failed, 1 skipped**
(WebKit theme test; missing Linux dependencies), including all 100 geometry cases
and both bundled and live local Cloudflare runtime checks. Separate actual
service-worker retained-navigation run: **6 passed, 0 failed**. Web and API
production bundle dry runs passed. `git diff --check` passed.

Full-suite command:

```sh
FREEUPPER_CHROMIUM=/usr/bin/chromium \
FREEUPPER_TEST_BUNDLE=.wrangler/test-build \
FREEUPPER_TEST_ORIGIN=http://localhost:8787 \
node --test --test-isolation=none tests/*.test.js tests/*.test.cjs
```
