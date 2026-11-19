# Chat reconciliation review — 2026-11-19

Production remains **NO-GO**. This branch is for review and CI only. No SQL against either hosted project, database migration, Auth seeding, staging cleanup, merge or deployment was performed in this review.

## Provenance and scope

- Original commits `7528928` and `4d2cb95` are retained as ancestors of `review/chat-security-reconciled`; the implementation was not recreated.
- Fresh fetch and remote-ref check show GitHub main at `4a19c659a1928b4d1ad39938ed05c5e7931f2d0b`, which is already this implementation's base. No main reconciliation conflicts or missing intervening main commits exist.
- Reviewed `REVIEW.md` (historical), `SECURITY-HARDENING.md`, `TEST-RESULTS.md`, activity migration, disable/maintenance/rollback proposals and saved production catalog. Historical reports describe their original execution dates, not current hosted state.
- Verified mapping: production `jmjtqidirpmnegzvmiaq`; staging `tagkrhvgcbnybiuyvjxt`. See `PROJECT-VERIFICATION-STOP-REPORT.md` for the prior live-application/Worker mapping evidence and staging change disclosure.
- Production schema comparison uses the saved November 16 read-only evidence. SQL execution is on hold, so **no fresh production policy/function drift verification is claimed**. Fresh approved metadata inspection is a release prerequisite.

## Separate review of PR #40

PR #40, `feature/chat-live-activity-main` at `d697305697b023026c3e4e86ad40ef19c9b1db1e`, changes only `chat.js` (78 additions, one deletion). It uses the existing `typing:` Broadcast channel and accepts client-provided actor IDs. Its recording/send hooks, heartbeat, TTL and close cleanup overlap the retained implementation. It lacks the server-authored identity and per-change authorization of the hardened transport. Its visibility heartbeat stop is not imported independently: background recording/upload behavior still requires device testing and a deliberate lifecycle decision. No compatible, nonduplicated patch was identified that warrants importing a second activity system. PR #40 is left unchanged and unmerged.

## Runner fix

Actions run `44026704532` failed before browser acceptance, at Chromium installation. The downloaded job log states: `Playwright does not support chromium on ubuntu26.04-x64`. Playwright is locked to 1.56.1.

- Pin Chat UI job to `ubuntu-24.04`, consistent with the existing Cloudflare test job.
- Use Node-24-compatible checkout/setup-node v5 actions, retaining Node 22 for this test job.
- Add the new browser and identity suites to the existing Chat UI check and include their paths and package manifests in PR triggers.
- Let Playwright select its installed browser by default in `chat-upgrades-browser.test.js`; retain `FREEUPPER_CHROMIUM` for local/system-browser runs. The former `/usr/bin/chromium` default did not match GitHub-hosted installations.

No production markup, colors, composer behavior or other application code changed during reconciliation. The original approved chat replacements and hardening remain intact.

## SQL compatibility and data effects

The reviewed proposal remains `supabase/migrations/20261116172043_chat_activity_authorization.sql`, SHA-256 `ee0310640a51c7fecbd92249bcc3a47bf18602c4c5631b88e2b9388eb186e737`. It is not executed by the Chat UI workflow.

Saved production evidence matches conversation UUID identity/owner/creator columns, boolean group/note flags, JSONB permissions, membership uniqueness/foreign keys, required block/send helper signatures, enabled Realtime RLS and the existing non-all-tables publication. New activity objects were absent. This is structural compatibility, not hosted verification.

Installation creates only a new ephemeral activity table/private schema/helpers, grants/policies, indexes and publication membership. It does **not** recreate existing chat tables or run updates/deletes against profiles, Auth users, conversations, messages, receipts or group memberships. Runtime activity RPCs upsert/prune only activity state. The corrected role RPC can update membership roles when subsequently called by an authorized owner; installing its definition does not change membership rows.

Two intentional changes affect future existing operations: a trigger protects conversation identity/group permissions; the existing `set_member_role(uuid,uuid,text)` implementation and execution permissions are replaced to close its NULL-owner bypass. Review legitimate ownership-transfer/server operations before release.

Existing public conversation/message/membership RLS policies are not replaced. Named Realtime policies are dropped/recreated: `chat_activity_receive`, `chat_activity_send`, `chat_activity_receive_guard`, `chat_activity_send_guard`, `chat_activity_anon_guard`, `chat_activity_db_join`, `chat_activity_db_receive_guard`, `chat_activity_db_send_guard`, `chat_activity_db_anon_guard`. Saved production evidence had **zero** Realtime policies, so none existed to replace then. Fresh policy-name/definition comparison is required before applying; do not overwrite an unexpected same-name policy. Restrictive guards prevent broader permissive policies from reopening the activity namespaces. They do not secure unrelated namespaces or privileged service-role access.

Authorized activity is published through the authenticated RPC, not direct client Broadcast. Actor identity derives from verified `auth.uid()`, with private admission plus per-change membership RLS. Removed members must fail new admission and stop receiving future authorized rows on an existing socket. Already-authorized in-flight data cannot be recalled. Local evidence supports this design; hosted proof is outstanding.

## Staging baseline audit and readiness

The previously applied staging baseline `20261116195437_chat_canary_production_shape_baseline` is a scaffold, not the activity migration. Its unchanged source is `staging/bootstrap.STAGING-ONLY.sql`, raw-byte SHA-256 `a6179971e7af2a5aaccb9f4df9da62d0e0b4e2b8f70cd0f37f3d1bf810d27bbc`. That staging-only bootstrap and seed preparation remain local and are excluded from this PR to prevent accidental production application.

Exact object classes: six public tables (`profiles`, `conversations`, `conversation_members`, `messages`, `message_reads`, `blocks`), 29 named constraints and their constraint-backed indexes, one sequence (`blocks_id_seq`), nine public functions (`can_send_in_conversation`, `conversation_created_by`, `conversation_has_any_members`, `is_blocked_between`, `is_member_of_conversation`, `is_owner_or_admin_of_conversation`, `set_member_role`, `set_message_expiry`, `update_conversation_last_message`), 18 policies, two triggers (`trigger_update_conversation_last_message`, `trg_set_message_expiry`) and four publication additions (conversations, conversation_members, messages, message_reads). RLS is enabled on all six tables. Authenticated DML grants cover the five non-profile tables; profiles receive full-column SELECT and presence-column UPDATE. A schema-cache notification is included. No notification/push trigger or production rows were copied. `rls_auto_enable` was preexisting, not created by this migration.

The source is authoritative for each column, constraint and policy definition. Its baseline guard checks profiles/conversations, but the script is **not repeatable**: unconditional object creation/publication additions can conflict on reapplication. Do not rerun it.

Last saved staging audit: 14 preexisting Auth users, no profiles/conversations or seeded canary users; activity hardening was declined and its objects/policies were absent. No fresh counts are claimed. Empty public tables did not prove the project had no storage/Auth/Edge/cron dependencies; earlier staging privacy migrations existed. No complete pre-baseline dependency manifest was captured, so absence of conflicts with all prior functionality cannot be certified.

Specific risks: copied legacy role-RPC bypass remains until hardening; broad legacy conversation updates remain; receipt SELECT/INSERT policies warrant separate privacy/integrity review. Staging-only profile SELECT allows all columns and is not production profile privacy parity. The scaffold omits ancillary reaction/poll/private-media/full-app dependencies and cannot prove complete application compatibility. Use only expressly approved disposable fixtures; do not use existing users or real profile data as canaries.

**Staging testing: NO-GO today.** Structurally useful for targeted tests after approved dependency/drift review and hardening, but neither secured nor a verified full-app staging clone. No cleanup, seeding or migration is authorized by this report.

## Release gates and deployment order

1. Complete PR checks and review. Separately approve fresh read-only catalogs/configuration for both mapped projects; compare policies, function owners/ACLs/search paths, triggers, publication, Realtime settings and gateway/JWT configuration. Capture rollback metadata and verify no drift/name collisions. Do not reapply the staging bootstrap.
2. Obtain explicit staging-change approval. Apply only the reviewed activity-hardening transaction to staging, then validate object/grant/function parity. Approve disposable multi-user fixtures separately. Never copy production rows or use preexisting staging accounts without authorization.
3. Hosted canaries: direct participants, outsider, three-member group, revoked member with original socket/JWT and reconnect; body-ID/Broadcast injection; blocks; ordinary messaging/role/metadata operations; concurrent typing/recording/upload, switching, cancellation, failures, expiry, reconnect and expired/refreshing Auth. Measure fan-out/WAL lag against seven-second activity expiry and decide rate limits/retention. Record exact hosted versions and evidence.
4. Resolve separate legacy receipt policy risks and legitimate ownership-management compatibility. Implement/audit encrypted private view-once backend or explicitly accept new view-once sending unavailable. Keep current fail-closed gates; no public-media fallback. Private backend plan remains `PRIVATE-VIEW-ONCE-CONTRACT.md`.
5. Complete physical iPhone Safari, Android Chrome, installed PWA, background microphone/playback, real upload failures, VoiceOver/TalkBack and Firefox/WebKit checks. Chromium viewport automation is not physical-device evidence.
6. Only after explicit production approval: capture fresh rollback metadata; apply the reviewed production activity migration first, verify controlled canaries and normal messaging; then approve frontend/cache rollout. No merge/deployment is performed here. Existing main-push Cloudflare workflow can deploy, so merging this PR must remain blocked until release approval.

## Disable and rollback sequence

After separate approval, revoke activity publishing using `disable-activity.REVIEW.sql`; preserve normal messaging and wait for expiry after the last accepted write. Prefer a forward frontend patch retaining private-media fail-closed gates. Do not revert to the old unauthenticated Broadcast or plaintext view-once path.

`rollback.REVIEW.sql` removes activity publisher/snapshot/table/helper state only; activity rows are transient. It deliberately preserves corrected role management, conversation identity/permission guards, private schema and namespace quarantine. This is a feature rollback, not a byte-for-byte schema restoration. It does not remove the staging baseline. Never use CASCADE or a public-schema reset. Any baseline removal requires a fresh dependency/data inventory, ownership review and a separate approved object-scoped plan protecting the preexisting users and subsequent data.

## Verification status

Current rerun results are appended below. Database/JWT/Realtime execution is intentionally not repeated while SQL execution is on hold. Historical local results remain 11 SQL, six signed-JWT HTTP and seven actual Realtime checks passing, as documented in `TEST-RESULTS.md`; these are not new hosted results and counts overlap other runs.

**Production: NO-GO**, pending hosted authorization/load/device evidence, schema drift approval, receipt/ownership compatibility review and the private-media availability/security decision. **Review PR preparation: GO**; no production changes are authorized.

Current local command (Node 24.22.1, system Chromium via explicit override):

```sh
FREEUPPER_CHROMIUM=/usr/bin/chromium node --test \
  tests/chat-identity-integration.test.js tests/chat-premium-browser.acceptance.mjs \
  tests/freeupper-time.test.cjs tests/chat-upgrades-browser.test.js \
  tests/chat-activity-authenticated.test.js tests/chat-activity-realtime.test.js \
  tests/cloudflare.test.js tests/ui-sounds.test.js \
  tests/ui-sounds-interactions.test.js tests/theme.test.js
```

**99 tests: 95 passed, zero failed, four skipped** (opt-in local JWT integration, opt-in local Realtime integration, deployed Workers runtime and unconfigured WebKit theme). No SQL suite was executed in this review. All 20 chat-upgrade browser tests plus 11 premium acceptance tests (eight browser and three static checks) passed using Chromium automation, not physical devices. Syntax checks for chat.js/service-worker.js and `git diff --check` passed. Full output: `evidence/reconciliation-20261119.txt`. Required hosted GitHub checks are evaluated separately on the PR head.

### Full-suite integration follow-up

The first hosted broad run on `af06863` executed 591 checks: 574 passed, three failed, 14 skipped. All three failures were stale integration pins: Gallery's pre-upgrade chat fingerprints/cache URL and the PWA sound test's v36 cache name. The Gallery fixture now carries a narrow, explicitly sourced overlay for chat.html/chat.js from `4d2cb95` and the reviewed Chat UI workflow from `af06863`; every unrelated original fingerprint stays enforced. Cache checks retain all unrelated main pins, require the new chat URL in both HTML and precache, and reject the obsolete chat URL. The PWA browser test now expects v38 while still verifying old-cache removal and offline sound consumers. No application code or SQL changed to satisfy these tests.

Hosted Chat UI on `af06863` passed 37/37; Privacy V2 passed 102/102. The existing Cloudflare Git integration automatically built a branch preview after push; no deployment command was invoked and the production deploy job remains main-push-only. Final-head results are recorded in the PR body to avoid regenerating CI runs solely to update result documentation. Broad CI runs disposable PGlite SQL fixtures; no SQL is sent to either hosted Supabase project.

### CI time budget

On `15137ac`, Chat UI and Privacy V2 passed again and the full repository regression step passed. The existing ten-minute Cloudflare job was then cancelled by its time limit during WebKit dependency installation; its WebKit/runtime steps were not completed. The test job budget is increased to 20 minutes to accommodate the expanded browser/SQL suite plus fresh browser dependencies. No test is removed or skipped by this change. The narrow Gallery preservation overlay additionally fingerprints this reviewed CI-only workflow adjustment; the production deployment job and its gates are unchanged. Final checks rerun on the updated head.
