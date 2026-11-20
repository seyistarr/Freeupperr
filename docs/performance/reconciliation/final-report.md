# Unified cache reconciliation — 2026-11-19

**NO-GO for production.** Local reconciliation fixes both reported caching defects;
physical iPhone Safari/PWA acceptance and separately approved release controls are
still outstanding. No push, main merge, preview publication, deployment, database
mutation, Cloudflare setting/rule change or deployment-workflow edit was performed.

## Provenance and integration

Shell execution is restored through the authorized development executor. Network,
Chromium/local-listener and build subprocess operations use reviewed execution
permissions; no sandbox restriction was bypassed. Earlier execution rejections
are no longer reproducible. The confirmed recovery problem was a reset workspace
with missing unpublished Git objects, not proof that the original work survived.

- Freshly fetched main: `4a19c659a1928b4d1ad39938ed05c5e7931f2d0b`, unchanged at
  final fetch. It includes the work after the previously reported `b943598e`.
- Tested implementation: `9f8a3f19dec6ee0582818da542583d152d1643a3` on
  `integration/unified-cache-current-main`, rooted directly at current main.
  Subsequent delivery commits contain reports/evidence only.
- The executor reset lost the three unpublished original feature commits ending
  `7b2db6eabbf02898dcb1b07be0a5d73fba7429e4`. Remote fetch could not recover that
  object. `feature/unified-performance-cache` is an explicitly documented recovery
  at `d084f6e`, not a claim that the original commits survived. Earlier performance
  reports were not available as files; historical figures are not fresh evidence.
- Read-only merge-tree simulation recorded three conflicts in `profile-shell.js`,
  `service-worker.js`, and the sounds browser test. `global.js` and the five-tab
  test combined automatically. Resolution was applied on the integration branch;
  main was not merged or rewritten. See `merge-simulation.txt`.
- Gallery/Notes, shared video player, author header, interaction sounds, guest
  initialization guards and main regression coverage are retained. Production
  auth/chat/player/profile-content/API/config/workflow files have no diff to main.
  Approved hash exceptions for intentional global/Search changes are explicit.

## Defects and lifecycle findings

1. **Mixed-release assets fixed.** The post-transform inventory now includes every
   root static HTML document, not only five-tab shells. Music and supporting
   documents and dependencies belong to the same content-derived release. Missing
   or corrupt entries recover only matching SHA-256 bytes. Unknown dynamic pages
   use network assets; an unidentifiable client fails closed. Before/after
   reproductions are retained beside this report.
2. **CacheStorage failures fixed.** Open/read/delete/write failures cannot suppress
   a valid matching network shell response. Storage denial and quota rejection
   are exercised in unit tests and the actual generated Chromium worker realm.
   A mismatched newer response remains blocked, as required for release integrity.
3. An installing worker waits naturally; there is no forced skipWaiting, claim or
   reload. The notification listener is attached before registration.update and
   handles an already-installing worker. A failed new install preserves the prior
   namespace; a failed same-release reinstall also preserves active entries.
4. Missing storage while offline cannot recreate missing bytes. Old cached HTML
   cannot recover an evicted old script from a server serving only new bytes;
   it fails closed until the new release can activate. Preserve drafts before
   closing all controlled windows. This is an explicit availability tradeoff.
5. Search keeps its original 60-second freshness lease across pressure snapshots;
   expired/offline results clear while controls persist. Account changes/logout
   dispose old snapshots, drafts and media. Inactive Search/Video may be trimmed
   after backgrounding; active screens, Home/Profile and Create stay protected.
   Drafts remain memory-only and cannot survive OS process termination reliably.

## Verification

| Final check | Actual result |
|---|---|
| Full combined suite at tested implementation SHA | 584 total; **572 passed, 0 failed, 12 skipped**; 453.718 seconds |
| Focused policy/integrity/privacy unit cases | 17 passed, included in full run |
| Release inventory/build contracts | 3 passed, included in full run |
| Real generated SW: storage denial/quota, supporting pages, offline, A/B waiting/cleanup | Passed, included in full run; 627 ms local installation; 0 supporting-document network requests |
| Gallery built navigation/player/sign-out | 4 passed, including 2 with SW enabled, included in full run |
| Explicit Chromium main/feature offline transport/emulated matrix | 4 passed, 0 failed |
| Isolated five-tab and cold handoff measurements | 2 passed, 0 failed |
| Local workerd route/cache/API/privacy suite | 18 passed, 0 failed |
| Production-equivalent asset build and web/API dry-run packages | All passed; no uploads |

The full-run skips comprise 3 localhost-origin checks (subsequently exercised in
local workerd), 8 opt-in offline-matrix cases (4 Chromium cases subsequently passed;
4 WebKit cases not run, including 2 existing emulated-offline TODO cases), and
1 optional WebKit theme case. Skips are not counted as passing. Linux WebKit launch
was separately attempted and blocked by missing host libraries. Raw logs are
retained alongside this report.

### Fresh performance comparison

`cache-comparison.json` compares the **main SW policy and reconciled SW policy over
identical reconciled payloads**, with a local 150 ms HTML response delay. Each row
is the median of 3 response-body-completion samples, not paint or full app readiness.

| Shell | Main policy (ms) | Reconciled policy (ms) |
|---|---:|---:|
| Home | 162.7 | 9.1 |
| Search | 160.0 | 3.7 |
| Create | 157.4 | 5.4 |
| Video | 155.8 | 2.6 |
| Profile | 156.8 | 11.6 |

Warm document network requests: **15 -> 0**. Installation under this delayed
fixture: **989.7 -> 2562.2 ms**. Stored bodies: **7,745,453 bytes / 58 entries ->
9,350,083 bytes / 89 entries**. Median cached global.js response completion over
5 samples: **2.0 -> 3.1 ms**, reflecting integrity verification overhead. Stronger
consistency and complete shell installation cost additional time and storage.

Isolated retained-navigation warm commit samples ranged **1.9–58.9 ms** (including
that 58.9 ms Profile outlier). With 350 ms injected document latency, cold Home
handoff committed in 4.2 ms and became ready in 586 ms; Profile committed in 2.9 ms
and became ready in 629 ms. Commit/first-frame placeholders are not hydration time.
Three forced-GC fixture samples retained 9 documents, 4655 nodes, 505 listeners and
5.37–5.41 MB JS heap; this is bounded local-fixture evidence, not an iPhone limit.
Raw navigation samples and measurement logs are retained. No whole-app before/after
production benchmark or real network speedup is claimed.

Earlier exploratory verification caught an obsolete i18n helper-spelling assertion
and Gallery fixture autoplay/document-ready races. These were corrected without
removing the behavioral assertions; the cache contract has direct unit/generated-
worker tests. The preceding complete run was 583 total, 571 passed, 12 skipped,
zero failures, before the final same-release reinstall regression was added.
Historical results from the missing feature commits are not reused as acceptance.

Reproduction commands (Node 24, existing lockfile; no dependency upgrades):

```sh
npm ci --no-audit --no-fund
npm run build:cloudflare
WRANGLER_SEND_METRICS=false wrangler deploy --dry-run --outdir .wrangler/test-build
WRANGLER_SEND_METRICS=false wrangler deploy --config cloudflare/api/wrangler.jsonc --dry-run --outdir .wrangler/api-test-build
FREEUPPER_CHROMIUM=/usr/bin/chromium FREEUPPER_TEST_BUNDLE=.wrangler/test-build node --test --test-isolation=none tests/*.test.js tests/*.test.cjs
FREEUPPER_OFFLINE_MATRIX=1 FREEUPPER_CHROMIUM=/usr/bin/chromium node --test --test-isolation=none --test-name-pattern='^chromium' tests/gallery-offline-browser.test.js
node scripts/measure-unified-cache.mjs 4a19c659a1928b4d1ad39938ed05c5e7931f2d0b
```

Use the project-local `node_modules/.bin/wrangler`, or a package-manager invocation
that selects it. Set WRANGLER_LOG_PATH to a writable location in restricted sandboxes.
Local origin tests require `wrangler dev --local --port 8787` with only the local
ASSETS binding, then `FREEUPPER_TEST_ORIGIN=http://localhost:8787` and the existing
Cloudflare test files. Dry-run packaging does not prove remote runtime configuration.

## Security, privacy and compatibility

Only verified static source shells/assets persist by default. Authenticated and
personalized APIs, signed/private media, Range/video transfers, WebSockets,
cross-origin responses and decrypted attachments bypass generic caches. No user
tokens, passwords, private chats or decrypted private media are put in Cache API.
The existing public Supabase anon key is client-public; no service-role key was
identified in the shell. This is a cache/code audit, not a fresh live RLS audit.
No database schema, E2EE plans, auth cookies/header routing or media controls change.
The tightly bounded public-image opt-in namespace has no current endpoint opted in.

## Shell size review

The reconciled release is `3fbf78b77ae55fb8eda8`: **9,350,083 bytes (9.35 MB,
8.92 MiB)** of precache response bodies, 89 resources and 117 integrity entries,
including 28 lazy language dictionaries. Independent source/transform/hash audit
found zero mismatches (`asset-audit.json`). This supersedes the earlier 8.77 MB
shell figure; additional supporting HTML is required to close the mixed-release
defect. Browser disk accounting and HTTP transfer compression differ from this sum.

Four required PNG paths contain identical 1,447,710-byte, 1254px-square images:
`apple-touch-icon.png`, `freeupper.png`, `icon-192.png`, `icon-512.png`. Together
they account for 5,790,840 bytes, about 62% of the shell. Correctly sized icon
derivatives or verified lossless optimization are the clearest follow-up reduction;
do not remove manifest/icon paths or mutate generated assets after integrity
calculation. No image was resized or removed in this reconciliation. Scripts and
supporting documents were retained; no unsafe lazy omission or UI redesign was used.

Measurements below use local fixtures. They are not production LCP/INP/CLS, real
cellular performance, physical-device memory measurements or a promise of loading
time. No DevTools trace/Core Web Vitals evidence was collected in this environment.

Chromium validates real generated-worker upgrades/offline/storage behavior and
actual built Gallery with SW enabled, alongside original non-SW cases. Linux WebKit
was downloaded but cannot launch: missing GTK4, Graphene, WOFF2, HarfBuzz ICU,
Hyphen, Manette and GLES libraries. No privileged system-install workaround was
used. Neither physical Safari nor installed iOS PWA was tested. Storage eviction,
bfcache/background restoration, iOS media gestures, standalone lifecycle and OS
kill behavior require the reproducible `iphone-acceptance.md` checklist.

`preview-plan.md` proposes a separate HTTPS Worker/origin with synthetic accounts,
local APIs/media, no production bindings/routes/secrets/Git trigger, and enforced
network isolation. It is a proposal, not a deployed or deployment-ready artifact;
its concrete bundle must be reviewed and explicitly approved before publication.
Publishing this branch unchanged would still reference production services.

## Deployment and rollback

See `deployment-controls.md` and the read-only Cloudflare snapshot. Main is
unprotected and the production environment has no reviewer gate. Main push/merge
can deploy web through GitHub Actions. API Cloudflare Builds independently runs
`npm run deploy:api` for all main paths. Web Builds itself only builds and prints
that Actions owns publishing. Recommended branch protection, required merge checks,
reviewed production approvals and a single gated API publishing owner remain
proposals requiring separate authorization. Current cache rules/settings were
read only; workflow/config/API files remain byte-identical to main.

No release occurred, so production needs no rollback from this task. For a future
approved release, retain the exact built inventory, matching assets and deployment
IDs; current recorded web rollback target is `52a80774-c6aa-4cf5-9ec7-092ac51e207a`,
API `3bcc4400-f4ce-44ad-a13b-b0d4213f1c7a`. Refresh these before use. Prefer a reviewed
forward rollback using the verified builder and known-good matching payloads;
do not publish new HTML with old mutable scripts. Old installed clients remain
on their active release until all controlled windows close. Preserve drafts first;
do not force reload or clear user data. Reverting Worker code does not revert
database/external state or independent deployment triggers. Never perform a broad
cache purge as an account-data cleanup substitute.

Changed-file inventory is recorded in `changed-files.txt`. Local commits and an
incremental Git bundle retain this work without remote publication. Production
remains **NO-GO** pending physical-device acceptance and explicit release approval.
