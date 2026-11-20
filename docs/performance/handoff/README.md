# A/B handoff diagnosis

The previous marker failure is reproducible without changing the application.
The acceptance harness used `page.waitForFunction(async () => ...)` as an async
boolean poll. In pinned Playwright 1.56.1, its synchronous poll treats the returned
Promise as truthy; the handle then resolves to **false**, which the harness ignored.
See `node_modules/playwright-core/lib/server/frames.js`, `waitForFunctionExpression`.

`before-promise-proof.json` records both HTTP max-age 0 and 14400 reproductions
using the exact published A/B assets on one local origin and registration scope.
The false wait returned while B was still **installing**, A remained active and
controlled the reopened page, and the returned HTTP 200 script matched A's SHA-256.
Reopening that A client also prevents natural B activation. A partially populated
B CacheStorage namespace proves neither successful installation nor activation.
The earlier failure report did not establish an application defect.

Reproduce the original failure locally with the retained approved preview packet:

```sh
node docs/performance/handoff/reproduce-published-assets.mjs /workspace/freeupper-acceptance-preview
```

The reproduction adds only a local diagnostic message listener to observe the
controller's own release and client list. It never publishes or contacts production.

The two public alias URLs have different origins and independent root registrations
and CacheStorage. Moving between those links cannot test replacement. The earlier
stable-origin attempt did use one origin/scope; its premature waits were the error.
The JavaScript marker itself is valid, but status/body digest/controller lifecycle
must accompany marker checks. HTTP caching is not the cause of the reproduction.

## Corrections

- `waitForWaitingWorker` uses `expect.poll` around an awaited browser evaluation.
- Capture the candidate Worker before `registration.update()`, wait for the
  installed/waiting state, retain old clients until intended closure, then hold an
  activation barrier on that candidate **before** opening the next controlled page.
- Confirm the active state, absence of the old cache and exact new HTML/JS bytes.
  Do not use `navigator.serviceWorker.ready` or cache existence alone as update proof.
- The same bad async wait existed in the built-cache and i18n tests; these waits
  now really await their conditions. The offline language fixture now runs at a
  known static shell path. Its prior unlisted document correctly bypassed caching;
  the previous false poll hid that test-fixture mistake.

No application JavaScript, Service Worker policy, generated release semantics,
controllerchange handler, UI, auth/media behavior or deployment workflow is changed.
There is no new skipWaiting, clients.claim or forced product reload. A pending
update cannot destroy a running composer or take over its media/navigation state.

## Verification

The new same-origin two-client test runs A→B→A with both HTTP cache lifetimes.
It checks that the remaining tab keeps the old release, DOM draft sentinel and native
video while the candidate waits; after deliberate closure it checks activation,
old-cache cleanup, exact script and HTML hashes, corruption/missing-entry recovery,
and offline reads. Real Create drafts, Video and Gallery-with-SW cases remain in
the existing full regression suites. `focused-results.log` records four passing
focused tests. Full-suite and CI results are reported separately for the final SHA.

The standalone preview harness is repaired locally to use the same barriers and
requires an explicit origin/direction. It changes no server release automatically.
No live A/B switch, replacement preview upload or configuration change is performed
by this reconciliation. A live bidirectional rerun requires approval to switch
only the existing isolated stable origin between the already uploaded A/B versions.

## API publishing safeguard — approval required

Read-only inspection confirms the API Builds trigger still matches main + all paths,
runs `npm run test:api` and then `npm run deploy:api`. A web-only merge can therefore
redeploy the API independently of web checks. No branch protection or production
environment reviewer gate currently prevents that automatically.

`api-trigger-proposal.json` is a **one-field, unapplied** PATCH proposal: replace
that production publishing command with the existing Wrangler API **dry-run**.
Tests and packaging continue; no main merge publishes an API version. Deploy an
API only after an API change is reviewed, tests/package checks pass and the owner
explicitly approves that API release. Web publishing through GitHub remains as-is.

This is safer than a parent-commit diff guard, which can miss earlier commits in a
merge, and does not depend on path filters correctly capturing future dependencies.
The tradeoff is intentional manual API publishing, including for genuine API changes.
Before approval/applying, reread the exact trigger and confirm the preconditions;
retain the old command for rollback. Do not execute the proposal as part of testing.
The API's running versions/routes/Supabase/WebSocket/header behavior do not change.

Production remains NO-GO pending approved deployment safeguards, physical iPhone XR
/iOS 18.5 Safari and installed-PWA acceptance, and the approved live roundtrip rerun.
