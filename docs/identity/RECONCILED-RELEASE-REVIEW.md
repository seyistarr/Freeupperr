# Reconciled Stage 1 identity release

2026-11-12 UTC. **Local integration only. Old candidate 66e9a78 is superseded; no new publication is authorized.**

## Baseline and exact integration

Production main: `ba35a24831c2f13de5d57891497861b9f5bab97a`.

New branch: `codex/default-identity-integrated-ba35a24`, local worktree /workspace/Freeupperr-identity-integration.

| Local commit | Purpose |
| --- | --- |
| 1cdb9b7ae3eebcb42442a7d18d968841974362dd | Reviewed identity implementation, carried from ef3a7a7 onto latest main |
| 7f9c1235f6182a8a469d05892466c128091abc5b | Current-main chat acceptance harness and six isolated identity/conversation checks |

A final documentation-only commit records this review; its SHA is the proposed publication tip in the final response/operational manifest. No merge, reset, force-push or remote update occurred. Original worktrees remain intact.

All six production commits since the original 23d4d84 identity baseline were inspected: 6563342, de9c309, c4d135b, 8ef95c3, 247f3de and ba35a24. The last two commits add 223 lines/remove 61 across chat.html and chat.js, with no dependency, database or deployment-workflow changes.

The new chat behavior includes contextual header back/search/New controls, updated light/dark card styling and tab icons, group avatar defaults and member/privacy labels, online indicators, escaped partner header names, and the New Message friends rail. Existing conversation selection, membership, message operations and UUID relationships are retained.

**Both chat runtime files are byte-for-byte identical to latest main.** No older chat markup or logic was copied from the identity branch. There were no source conflicts because reviewed identity changes do not overlap the chat files.

## Identity scope carried forward

The five changed application files remain exactly the previously reviewed implementation:

* auth.js: remove email-derived signup and missing-profile recovery names; preserve the existing Google/email Auth flows; recover via conflict-ignore insertion and reread.
* api/profile-preview.js: exact current-handle RPC and reject unsafe/email-handle inputs.
* profile.html: safe handle routing and existing profile customization flow with explanatory copy.
* index.html: existing onboarding link encouraging public-name customization.
* service-worker.js: v34-default-identity cache refresh, retaining the current production app.

Focused identity tests, preparation scripts, historical review documents and the already-applied migration source were carried with the reviewed implementation. Stage 2 templates remain reference-only; no workflow executes them.

The existing FUID generator and permanent UUIDs are unchanged. The Stage 1 source SHA256 remains f54e457b2d2096314e32afe90ecdf8becb0bc645fc30ea6ed0f9b820acee3af5. Its production migration 20261109051236 is already present; **do not replay it or run supabase db push**.

## Validation and conflicts

The initial untouched-main chat suite exposed a stale test expectation for the previous header and a local missing bundled Chromium executable. The integration changes only the test harness: include the actual latest header/sidebar controls, assert the intended contextual visibility, capture browser exceptions, and support the existing installed Chromium through FREEUPPER_CHROMIUM. It preserves default Playwright browser selection in CI when that environment variable is absent. No chat runtime fix or redesign was made.

Six new isolated checks execute actual current chat functions with an in-memory query adapter: list reload retains default/custom identity names and hides owner-deleted conversations; individual conversation restoration retains UUID/header identity; New Message reopens an existing conversation without duplicate inserts; a new DM uses UUID keys without profile writes; deletion updates owner visibility without deleting the conversation/profile; search rows retain names/handles and UUID navigation.

| Validation | Result |
| --- | --- |
| Focused identity/Auth/chat/routing/RLS/preview checks | 42 passed, 0 failed |
| Updated mobile/desktop/reduced-motion chat browser acceptance | 11 passed, 0 failed |
| Complete regression suite | 516 tests: 515 passed, 0 failed, 1 optional WebKit skip; 288.7 seconds |
| Web Worker build and packaging dry run | Passed; no upload |
| API Worker packaging dry run | Passed; no upload |
| Syntax / whitespace / chat-runtime identity checks | Passed |

Focused runs overlap the full suite and are not additive unique-test counts. All behavior tests use isolated fixtures or localhost, including synthetic authentication/database fixtures. No production Auth test was repeated and no production account/session was created.

After testing, main was fetched again and remained ba35a24831c2f13de5d57891497861b9f5bab97a. All chat runtime and identity integrity comparisons passed. **Recommendation: ready for a new, separate production publishing approval.** There are no unresolved mandatory technical blockers for this reconciled scope. No prior tip approval is being reused.

The read-only compatibility check found migration history at 79 entries, 72 profiles, all original 71 identity fingerprints unchanged, RLS enabled, unchanged policies and no private-schema access for anon/authenticated. The customized canary was excluded from the original-user invariant. No database migration, profile correction, Stage 2 operation or RLS change occurred.

The [Google canary remains passed](GOOGLE-CANARY-PASSED.md); its final login/customization result was not repeated.

## Final deployment trigger review

Live read-only Cloudflare checks confirm:

* freeupper-web watches main/all paths, builds with npm run build:cloudflare, and its production deploy command only logs that GitHub Actions owns publishing. Non-main previews remain enabled.
* GitHub cloudflare-tests.yml publishes web only after the worker job succeeds on a main push. It retains production environment, freeupper-web-production concurrency, cancel-in-progress false and --keep-vars.
* freeupper-api independently watches main/all paths, runs npm run test:api then npm run deploy:api; previews remain disabled. It can deploy before GitHub's web checks finish.
* API Worker code/config, dependencies, all workflows and deployment settings are unchanged by this integration. The chat acceptance workflow runs on matching PRs or its existing chat-release branch; a future main publication still runs the complete worker regression job.
* Current main's worker, deploy-production and both Cloudflare build checks report success. Those are main's checks, not remote CI for this unpublished candidate.

No connected Vercel repository project was found in the prior personal/team check; no intervening commit adds a Vercel trigger. Visibility outside connected scopes remains unverified. Publishing a review branch may create a web preview, so no branch push is performed as a probe.

Latest observed rollback versions are web 32717f7e-2e6b-4f5c-b3a0-0a06da205e54 and API a34ba395-bd40-4d9a-8815-cd4a93047b8d. Recapture queues/versions immediately before any approved publication.

## Proposed publication procedure — requires new approval

1. Review and explicitly approve the new exact publication tip and its automatic web/API production effects. The former 66e9a78 approval does not cover this candidate.
2. Fetch main again and require it to equal the verified baseline. If it advanced, reconcile with the newest baseline and update validation before requesting/using approval. Never overwrite newer chat changes or force-push.
3. Recheck queues, migration presence and rollback versions read-only. Run no database migration.
4. Publish only the approved integration tip as one fast-forward main update. Do not separately invoke an API deployment or publish intermediate commits.
5. Monitor independent API test/deployment and GitHub worker → web deployment, including Cloudflare's non-publishing web build. Verify both production versions correspond to the approved revision.
6. Check deployed auth/default-identity source and health read-only, profile customization source, username/FUID/UUID routing, email-handle denial, profile/post/search availability, original-user identity preservation, RLS invariants and PWA cache activation. Do not repeat the completed live canary or create another account.
7. Record results and stop. Stage 2 requires its own refreshed preview, manifest and explicit authorization.

On a failed mandatory check, stop publication. Before activation, retain the existing production version; after activation, use only the correspondingly authorized Worker recovery. A Worker rollback does not reverse database changes: retain privacy-safe Stage 1 defaults and never reset users or restore the email-leaking trigger. Roll-forward fixes and recovery commits must remain controlled because main updates can trigger both publishers.

Local operational evidence: /workspace/freeupper-validation/identity-reconciliation/. Optional WebKit availability and managed-service parity outside this migration's interfaces remain accepted residual risks. There is no remaining Google canary blocker.
