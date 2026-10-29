# Phase 2 verification results

Date: 2026-10-29. Baseline: `1e23f93`. All database writes below occurred only in disposable local fixtures. Production access was limited to read-only schema/catalog/counter/advisor queries and a read-only vector-conversion probe. No staging queries, production migration, application push or deployment, or publishing activation occurred.

## Results

| Check | Result |
| --- | --- |
| Full repo suite, Chromium and built Worker bundle enabled | **239 passed, 0 failed, 2 skipped**; 241 tests total |
| Local workerd static asset/routing/privacy check and Cloudflare media adapter suite | **8 passed, 0 failed**; covers the runtime-origin check skipped by the full suite |
| Expanded final database authorization/lifecycle suite | **13 passed, 0 failed**; includes draft, protected-origin and verification targets |
| Native PostgreSQL 17 concurrent transactions | **Passed**: parallel quotes, simultaneous same-ID requests, both plain repost RPCs, delete/restore, repeated toggles, original-deletion race |
| Cloudflare asset preparation | Passed; 70 root browser assets prepared |
| Wrangler production-bundle dry run | Passed; no deployment performed |
| Inline JS and posts.js syntax | Passed |
| Video/Explore/renderer/gateway/For You diff against Phase 1 | No changes |
| Publishing gates | Client flag is false; proposed migration defaults server publication to false |

The full-suite skips were WebKit theme tests (engine not configured) and the local-runtime-origin integration test. The latter was subsequently run successfully against local workerd. Safari/WebKit remains unverified in this environment.

A shared-mapper fixture failure during development was fixed by leaving `mapPost` byte-for-byte unchanged and moving quote metadata to opt-in hydration. Final tests pass without weakening or changing the existing test. Read-only-home Wrangler log/registry errors were resolved with `/tmp` log and registry paths; the final build and local-runtime checks passed.

## Security evidence

- Existing anonymous/owner/follower/mutual/unrelated post read results remain unchanged after migration.
- An additional temporary SELECT policy in the local fixture denies an original: both embedded reads and direct quote INSERTs respect that denial.
- Private-account originals are refused even for their owner or approved followers; normal private-account read permissions are preserved.
- Hidden/deleted/draft/restricted/protected-origin/verification/blocked targets are unavailable; publishing revalidates targets.
- Anonymous role, missing authenticated identity, anonymous-auth user claim, invalid IDs, spoofed payload fields and protected quote media are rejected.
- Quote IDs and engagement fields are independent; RPC and UI retries use one stable post ID.
- Soft delete/restore and hard deletion reconcile counts; deleting the original preserves the quote marker and authored engagement.
- Both old plain repost signatures, note support, media normalization, pure post mapping and view API source contracts are unchanged.
- A server gate accidentally enabled in a simulated test still cannot bypass the checked-in disabled client gate.
- Production `image_embedding` is `vector(1024)`. A read-only `jsonb_populate_record` probe successfully converted a synthetic 1024-value JSON array, matching the proposed RPC's typed conversion. No post was inserted or updated by that probe.

## Reproduction

```sh
npm ci --no-audit --no-fund
npm run build:cloudflare
WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/freeupper-quote-build.log npx wrangler deploy --dry-run --outdir .wrangler/test-build
FREEUPPER_TEST_BUNDLE=.wrangler/test-build FREEUPPER_CHROMIUM=/usr/bin/chromium node --test --test-isolation=none tests/*.test.js tests/*.test.cjs
```

For local static delivery, start `wrangler dev --local --port 8787` with writable `WRANGLER_LOG_PATH` and `WRANGLER_REGISTRY_PATH`, then:

```sh
FREEUPPER_TEST_ORIGIN=http://localhost:8787 npm run test:cloudflare
```

The optional native PostgreSQL test setup is in `README.md`; it accepts no production connection URL.

## Review artifact

Proposed migration SHA-256:

`d2c5ca1b28f89b2ab3ae5411be18f89f468d1eb3630ee80d14ca750ac86f0452`

File: `20261029090320_quote_reposts.REVIEW.sql`.

Production migration execution, live-schema verification after execution, deployment of the compatible code, and controlled production publishing smoke tests remain **pending user approval** in the order specified in `README.md`.
