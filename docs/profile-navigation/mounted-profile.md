# Retained profile navigation

## Cause and implementation

The bottom navigation used document anchors. Each Profile tap discarded the
viewer-scoped cache and rebuilt the page. Identity rendered first, while counts
and the grid waited for a secondary batch containing listings, collections,
relationships and tab authorization. The existing cache could restore an
in-document profile route, but could not survive Home → Profile navigation.

`profile-shell.js`, loaded by `bottom-nav.js`, retains at most one Home and one
Profile document. Existing profile/modal/detail routing stays inside Profile.
Root browser history handles Home/Profile visibility; it does not replace the
profile router. Hidden documents pause media and retain their DOM and scroll.
Guests and modified clicks retain native anchor behavior. No UI redesign.

The existing 20-profile, immutable-ID, viewer-scoped memory cache now retains an
owner primary snapshot: identity, exact counts, authorized first page, tab and
scroll. After initial authenticated app hydration, the hidden profile prefetches
24 posts and the summary once. Counts and the first page load concurrently with
identity. Optional collections, detail rendering and realtime wait until visible.
Further pages load on scroll, up to the existing 200-post bound. Concurrent
requests deduplicate and existing navigation epochs reject obsolete results.
Keyed thumbnail reconciliation preserves unchanged media nodes during refresh.

## Authorization and freshness

Only the verified current owner's snapshot can restore without another content
permission request. The snapshot lease lasts five minutes from a successful
authorized page load and also requires the same unexpired authenticated session.
Online primary data refreshes after one minute; failed refreshes preserve valid
content. Offline expired snapshots clear. Foreign quote originals are redacted
on return and in late responses received offline. Foreign collections revalidate
and are unavailable offline. Account changes and sign-out destroy retained
documents, viewer caches and detail state. No snapshot enters localStorage,
CacheStorage or a shared server cache. Supabase RLS and the API gateway are
unchanged. Existing foreign profile authorization continues to run.

Versioned script URLs and service-worker cache v23 deliver the changed assets.
No service-worker update reload handler was introduced.

## Measurements and regression checks

Playwright uses a 390×844 mobile viewport, actual profile/cache/navigation code,
an authenticated fixture, 40 authorized posts and a delayed primary HTTP response.
Warm measurements are click-to-first-animation-frame assertions that check the
complete header/counts/24 thumbnails, node identity and retained scroll together.
These are local test measurements, not physical-device or production guarantees.

| Run | Warm first opening | Warm return | Cold completion (180 ms API delay) |
| --- | ---: | ---: | ---: |
| Chromium | 5.9 ms | 7.7 ms | 678 ms |
| Chromium, service-worker-controlled | 13.7 ms | 4.8 ms | 1,062 ms |
| WebKit, service-worker-controlled | 19 ms | 87 ms | 5,922 ms |
| WebKit, added browser Back/Forward check | 22 ms | 18 ms | — |

Browser/iframe startup, session setup and rendering are included in cold times.
Concurrent local test load affected timing; the 87 ms sample remains reported.
Cached restoration itself is synchronous, but RAF scheduling is device-dependent.

New tests cover complete first-frame hydration, no full-document navigation,
Home/Profile retention, browser Back/Forward, active tab/scroll/node preservation,
modal Friends → profile → Back, repeated taps, failed refresh, offline lease
expiry, foreign quote redaction, sign-out and account switching. Existing profile
navigation, detail/grid/video, anonymous/private visibility and post authorization
regressions remain required. Automated WebKit and service-worker-controlled runs
do not constitute physical iOS or home-screen installation verification.
