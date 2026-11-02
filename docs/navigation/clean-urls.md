# Clean URL migration

Source: main `b08730c8ac0dc783e0b1687cdcfc02c23a47dbac`.
Feature branch: `feature/clean-urls`. Production deployment is not authorized.

## Routes and document identities

| Public URL | Static document |
| --- | --- |
| `/` | `/index.html` |
| `/home` | `/index.html` |
| `/search` | `/search.html` |
| `/create` | `/create.html` |
| `/videos` | `/video.html` |
| `/profile` | `/profile.html` |
| `/messages` | `/chat.html` |
| `/settings` | `/settings.html` |
| `/notifications` | `/notification.html` |

`js/freeupper-routes.js` supplies exact route identity, static document lookup,
public-profile screen identity, and local URL conversion. It runs in classic
browser scripts, service workers, and the web Worker. Query/hash bytes survive
URL conversion. External URLs, public identities, and unknown paths are untouched.

The web Worker changes only the pathname on a cloned asset request. Query strings
are preserved, including duplicate parameters and encoded values. GET/HEAD serve
the same static documents without a redirect. Other methods receive 405. Wrangler
keeps `html_handling: none`, explicitly runs the Worker for canonical routes, and
does not introduce an SPA fallback or broad extension-stripping rule. Unknown
paths remain 404. Existing asset and legacy document URLs remain available.
No permanent redirects are introduced. Trailing-slash aliases are not added.

`/@username`, `/u/:id`, `/p/:code`, `/v/:code`, API/media handlers, maintenance,
and sitemap handlers retain their ordering and privacy checks. Public preview
handoffs use the clean application routes; canonical share identities, crawler
eligibility, metadata redaction, and no-store responses remain unchanged. `/`
and `/home` share the existing entry/feed document and its root canonical URL.
Video and generic profile OG URLs now use `/videos` and `/profile`.

## Navigation and compatibility

The existing `FreeUpperProfileShell` remains the sole five-tab coordinator.
Its internal keys (including `video`) and Router event page names (including
`index.html` and `video.html`) are stable. Existing page event listeners continue
to work. Clean and legacy launch URLs resolve to the same screen identities.
The outer history writes clean paths, including returns to a legacy launch page
after a tab switch, with its original query/hash preserved. Native account resets
still use the original document endpoint for older offline workers. Public-profile and detail/modal history
continue to be owned by their existing controllers.

Hidden retained frames and Profile's hidden post renderer deliberately continue
requesting their original HTML document endpoints. Those are internal document
dependencies, not top-level navigation links. This supports an active older PWA
worker whose precache only contains legacy documents. Frame validation accepts
both clean and legacy identities. Retention limits, readiness signaling, scroll,
drafts, account leases, authorization revalidation, eviction and media suspension
are not changed. Settings, messages and notifications are native destinations,
not additional retained tabs.

Inline links, share fallbacks, composer returns, profile history, search reset,
notification clicks, desktop navigation and mobile navigation use clean targets.
The notifications target is the existing singular `notification.html` document;
the former router's nonexistent `notifications.html` target is corrected.
Legal, Studio, sound, recovery, admin and maintenance documents retain their
existing public paths, but their links to the migrated pages are updated.

## PWA and offline policy

The manifest retains `id: /`, scope `/`, icons and launch handler. Its start URL
is `/home`; shortcuts use `/create`, `/profile`, `/messages`.

The outer document registers offline support on load. It updates an existing
registration (including Firebase) rather than replacing its script URL. The
Firebase worker imports the shared shell-cache policy so chat's existing root
registration continues providing notification handling and offline support.
New installations use that Firebase-capable registration from the start, avoiding
a script-URL switch on the first chat visit. Firebase's existing CDN dependencies
must be reachable for the initial installation; subsequent worker starts use the
browser-managed installed script resources.
No `skipWaiting`, forced reload, or `clients.claim` is introduced.

Cache generation is `freeupper-pwa-v27-clean-urls`, with the existing Cloudflare
build suffix. Changed navigation dependencies use fresh versioned asset URLs.
The new route helper is loaded before lifecycle/navigation code and precached.
Legacy document URLs remain the install-time static shell keys. Clean and legacy
offline navigations resolve to their corresponding shell in the current cache,
ignoring query parameters only for that static shell lookup. Unknown destinations
never receive Home HTML. Documents fetched during navigation are never written
to the cache. No viewer snapshots are persisted by this migration.

Runtime caching is restricted to same-origin application JS/CSS, static images,
locale files, and the manifest. Authorization-bearing requests, APIs, public
profile/share previews and other origins bypass caching. Private/no-store
responses are not written. Cache writes extend the fetch event lifetime. Source
and generated workers now share these protections instead of relying on fragile
build-time string substitutions.

The Cloudflare build also includes the shared helper in navigation entry scripts
behind an initialization guard. A pre-migration document can lazily request a
script under an old version query without first loading the new head dependency.
This is checked in Chromium against the actual local Worker asset responses.

An already active v26 worker cannot retroactively understand a brand-new clean
URL during a fresh offline launch. It continues supporting legacy document loads
and warm retained navigation while the new worker waits. A network visit and
natural worker activation are required for direct clean-route offline launches.
No cached private API/content is used to work around that limitation.

## Verification

Use Node 24, `npm ci`, and the committed lockfile. Dependencies and production
secrets are unchanged. Fixture database tests use local PGlite only.

```sh
npm run build:cloudflare
npx wrangler deploy --dry-run --outdir .wrangler/test-build
npx wrangler deploy --config cloudflare/api/wrangler.jsonc --dry-run --outdir .wrangler/api-test-build
npx wrangler dev --local --port 8787
# In another terminal:
FREEUPPER_TEST_ORIGIN=http://localhost:8787 FREEUPPER_CHROMIUM=/usr/bin/chromium npm run test:cloudflare
FREEUPPER_TEST_BUNDLE=.wrangler/test-build FREEUPPER_TEST_ORIGIN=http://localhost:8787 FREEUPPER_CHROMIUM=/usr/bin/chromium node --test --test-isolation=none tests/*.test.js tests/*.test.cjs
FREEUPPER_PROFILE_ENGINE=webkit node --test --test-isolation=none tests/five-tab-navigation.test.js tests/profile-mounted-navigation.test.js
```

The route suite checks clean/legacy identities, repeated query preservation,
HEAD/405, no redirects, route collisions, shell-only offline lookup, public link
identity, same-document Router events, manifest identity, and Firebase registration
preservation. Workerd tests assert the actual rewritten asset request pathname
and query, in addition to public/private previews and protected-media boundaries.
Browser suites retain DOM, scroll, draft, profile-history, account-change, keyboard,
overlay, retention and offline assertions. A v26 controller/waiting-update test
checks that clean navigation and an unsent draft survive without activation.

Linux WebKit/WPE does not reproduce an installed iPhone PWA or physical iOS
keyboard/swipe behavior. Its offline driver blocks some fresh document loads
before worker fallback; Chromium covers cold offline restoration, and WebKit
covers warm offline returns. Synthetic authenticated browser fixtures are not
production OAuth, messaging, publishing or real-user privacy acceptance.

## Deployment and rollback (separate authorization required)

1. Review the feature commit, diff and verification results. Do not push to main
   before deployment authorization: `.github/workflows/cloudflare-tests.yml`
   automatically deploys successful main pushes.
2. Before an authorized release, record the active `freeupper-web` Worker version
   and the currently deployed source revision. Keep dashboard variables/secrets.
3. Release web Worker and static assets together through the existing gated
   workflow. This migration needs no database migration, API Worker deployment,
   auth configuration change, secret update or release-flag change.
4. Smoke-test clean/legacy URLs, public/private profile previews, existing post
   links, OAuth return URLs, installed PWA shortcuts, waiting updates and target
   iPhone devices. Check redirects and private/no-store headers.
5. If necessary, restore the recorded Worker version using Cloudflare rollback
   or redeploy the prior source with `--keep-vars`. Do not change API/RLS/privacy
   configuration as part of rollback.

A server rollback does not erase an activated client service worker. Prefer a
forward corrective release that retains clean route aliases and publishes a new
cache version. Preserve `/home` and clean shortcuts for installations whose
manifest has updated. If restoring the old server immediately, follow promptly
with compatibility aliases and a corrective worker/cache version; otherwise a
new installed shortcut may hit a route the old server does not recognize.
Keep old `.html` endpoints throughout. Permanent redirect migration is a separate,
later decision after mixed-version and real-device verification.

## Verification results — 2026-11-02

- Complete available repository suite with Chromium, local Worker origin and
  Miniflare bundle: **449 passed, 0 failed, 1 skipped** (450 total). The skipped
  test is the optional standalone WebKit theme test; it was also run separately.
- Chromium five-tab/mounted-profile suites: **16 passed, 0 skipped**. The final
  legacy-launch query/history assertion was additionally rechecked on Chromium.
- WebKit five-tab/mounted-profile suites on the final navigation implementation:
  **16 passed, 0 skipped**. A prior input timeout occurred after interrupted runs;
  orphaned local WPE processes were removed and the suites rerun successfully.
- Local Wrangler/workerd route/browser checks (`test:cloudflare`): **17 passed,
  0 skipped**. The final generated asset and Miniflare bundle check also includes
  crawler previews, rewritten query bytes, HEAD/405 and protected-media denials.
- Web and API Worker dry-run builds passed. No Worker was deployed.
- The separately enabled WebKit theme test fails at fresh offline
  `page.goto('/video.html')` with `WebKit encountered an internal error`. The same
  test fails at the same operation on an untouched archive of the source main
  commit. This is a reproduced baseline runner limitation, not a passing test.
  Chromium covers that cold-offline behavior, and WebKit covers warm returns.
- Earlier test iterations exposed stale legacy-URL/version assertions and
  fixtures that stripped the new dependency. Those fixtures/assertions were
  updated without removing retention, account-isolation or privacy checks.

WebKit 26.0 (Playwright build 2215) ran with its required Linux libraries supplied
under `/tmp`; its system-library-cache validation was bypassed only after the
runtime could launch using those local libraries. No dependency, system library,
production configuration, database schema, auth source, API Worker, backend
contract or production secret was changed. Real iPhone installations, OAuth,
FCM token delivery, chat send/receive and real-user production acceptance remain
outside these synthetic tests and require the separately authorized release check.

## Modified file inventory

- **Cloudflare and CI**: `.github/workflows/cloudflare-tests.yml`, `cloudflare/build.mjs`, `cloudflare/worker.js`, `wrangler.jsonc`.
- **Shared navigation, PWA and link callers**: `bottom-nav.js`, `chat.js`, `firebase-messaging-sw.js`, `global.js`, `hashtags.js`, `hastags.js`, `js/freeupper-routes.js`, `js/screen-lifecycle.js`, `music.js`, `notification.js`, `privacy-verification.js`, `profile-shell.js`, `router.js`, `search.js`, `service-worker.js`, `side-nav.js`.
- **HTML documents**: `admin.html`, `chat.html`, `create.html`, `index.html`, `music.html`, `notification.html`, `policy.html`, `privacy-verification.html`, `privacy.html`, `profile.html`, `recently-deleted.html`, `reset-password.html`, `saved-sounds.html`, `search.html`, `settings.html`, `sound.html`, `studio.html`, `video.html`.
- **SEO handoffs**: `api/post-preview.js`, `api/profile-preview.js`.
- **Manifest and commands**: `manifest.webmanifest`, `package.json`.
- **Regression tests and fixtures**: `tests/bottom-nav-layout.test.js`, `tests/bottom-nav-theme.test.js`, `tests/clean-routes-browser.test.js`, `tests/clean-routes.test.js`, `tests/cloudflare-runtime.test.js`, `tests/five-tab-navigation.test.js`, `tests/fixtures/quote-legacy-contracts.json`, `tests/fixtures/service-worker-v26.js`, `tests/i18n-browser.test.js`, `tests/i18n.test.js`, `tests/profile-detail-navigation.test.js`, `tests/profile-identity-navigation.test.js`, `tests/profile-mounted-navigation.test.js`, `tests/protected-media-browser.test.js`, `tests/quote-navigation-browser.test.js`, `tests/quote-reposts-browser.test.js`, `tests/theme.test.js`, `tests/ui-sounds.test.js`.
- **Documentation**: `docs/navigation/clean-urls.md`.
