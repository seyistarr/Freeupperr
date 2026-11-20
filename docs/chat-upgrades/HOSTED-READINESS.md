# Post-migration hosted readiness — 2026-11-20

**Release recommendation: NO-GO until approved isolated authenticated canaries complete. PR #41 remains unmerged; no production deployment or private view-once enablement is performed.** The database migrations are now applied; do not request or run them again.

## Verified migration tracking

Production: `jmjtqidirpmnegzvmiaq`. SELECT-only migration history confirms:

| Review draft version | Recorded production version | Migration | SHA-256 |
| --- | --- | --- | --- |
| `20261116172043` | `20261120113353` | `chat_activity_authorization` | `ee0310640a51c7fecbd92249bcc3a47bf18602c4c5631b88e2b9388eb186e737` |
| `20261119192845` | `20261120113401` | `chat_receipts_metadata_hardening` | `9ec033e257f9d8552e77b67d6dd328be04b095c1e5ed307ec32541343a7e0326` |

Each recorded statement is byte-for-byte identical to the reviewed local SQL. Reconciliation renames the two repository files to the recorded production versions, preserves every SQL byte, removes the old runnable draft paths and updates active test imports. `migration-version-map.json` records provenance. SQL comments retain their original draft IDs intentionally to preserve applied content. Historical reports keep draft references; they are not replay instructions.

No SQL replay, migration repair/remote history edit, data seed, membership change or cleanup occurs. This aligns only the two chat migrations; it is not a blanket repair of older repository/database history. Do not use a blanket push or `--include-all` to paper over unrelated historical differences.

## Actual hosted read-only results

- All **21** deployed function bodies exactly match the approved migration bodies. Owners, empty search paths, SECURITY INVOKER wrappers/private definers and removal of PUBLIC/anon execution grants are verified.
- The post-migration security advisor reports no findings for the five targeted public role/group/invite/request RPCs. Other project-wide findings are outside this scoped result (`production-postmigration-advisors.json`).
- RLS is enabled on the expected conversation/member/receipt/activity and managed Realtime relations. Receipt unrestricted SELECT is replaced; restrictive membership/write/anonymous guards are present. Legacy own-row receipt SELECT remains bounded by the restrictive membership guard.
- Authenticated activity access has SELECT only; no direct INSERT/UPDATE/DELETE grant. Anonymous roles have no activity/receipt data privileges. The receipt table's legacy authenticated DELETE grant remains, but restrictive DELETE RLS denies it; cleanup must not loosen this guard.
- Private schema USAGE exists for authenticated policy/helper execution; browser roles cannot CREATE there, and anonymous USAGE is denied. Activity PK/source uniqueness, expiry checks, FKs, indexes, DEFAULT replica identity and publication membership are present.
- Both direct Supabase and FreeUpper's gateway refused anonymous activity-table, receipt-table and snapshot-RPC reads with SQLSTATE `42501`; invalid JWTs were rejected with `PGRST301`. Both actual hosted private Realtime joins were refused with permission-denial responses. **10 read-only negative checks passed**, with no publish, account creation, message, receipt insert or membership mutation.

Evidence: `production-postmigration-readonly.json`, `production-postmigration-privileges.json`, `evidence/hosted-readonly-20261120.json`. Reproducible optional probe: `FREEUPPER_HOSTED_READONLY=1 node scripts/chat-verification/hosted-readonly.mjs`. It uses published anonymous configuration, verifies the project reference, performs only GETs/private admission, requests zero data rows, and does not print keys or tokens. It must not be described as authenticated-user acceptance.

The initial combined catalog request had a SQL syntax error; it made no changes and the corrected SELECT succeeded. An initial probe expected HTTP 403, while PostgREST maps anonymous SQL permission denial to HTTP 401; the corrected probe requires SQLSTATE 42501 rather than accepting an arbitrary authentication failure. Neither issue was a data-exposure finding or a bypassed security gate.

## Fixture inventory and blocked tests

No known marked canary accounts or matching candidate conversations were found. The search covered known admin/user `chat_canary_run` markers, the admin-purpose marker and previous fixture naming. It does not prove that differently named disposable accounts do not exist. Do not use unmarked accounts without explicit identification.

Authenticated hosted participant success, outsider denial with a real user JWT, member removal while a socket stays open, reconnection after revocation, authorized receipt upsert/visibility, admin/approval transitions, block changes, activity publication, hosted source concurrency and media lifecycle **have not been run**. They require accounts and fixture writes; the user explicitly withheld approval for creating/inserting/revoking/modifying production data. Do not simulate these as production SQL roles or insert-and-rollback records to evade that restriction.

The exact proposed three-account/two-participant/outsider fixture set, D/G/N conversations, test sequence, isolation controls, cleanup assertions and approval boundaries are in [HOSTED-CANARY-PLAN.md](HOSTED-CANARY-PLAN.md). No credentials are generated or stored in this report. Hosted three-or-more-member summaries require an additional explicitly approved participant; physical iPhone/Android/PWA, real media transfers/microphone and screen-reader behavior remain untested.

## UI, compatibility and checks

Reconciliation changes migration paths, verification tooling, evidence and documentation, not chat.html/chat.js/CSS/service-worker behavior. Approved layout, navigation, composer, media, voice, replies and group functionality remain at the reviewed candidate. PR #40's insecure duplicate remains excluded and private view-once sending remains fail-closed in the candidate. Production frontend is not deployed from this PR.

At source head `0a3fb58`, all required GitHub checks passed: Chat UI 37; Privacy V2 102; full regressions 590 passed/14 skipped; WebKit navigation 33; Workers runtime 17; combined required gate passed. These overlapping counts are not a unique-test total. The 14 skips and local opt-in evidence are described in PR #41. New reconciliation-head results must be checked separately and recorded in that PR; previous-head green status is not substituted.

Current local reconciliation checks passed: 26 migration/security checks and 37 Chromium browser/identity checks, with zero failures/skips. Outputs are `evidence/postmigration-local-security.txt` and `evidence/postmigration-ui.txt`. Local migration/security tests are disposable PGlite tests, not migration replay against production. Tracking tests enforce byte-identical production statements and no duplicate runnable draft migrations. Approved UI hashes and targeted browser checks verify no interface changes; no physical-device passes are claimed.

## Remaining release gates

1. Final reconciliation-head GitHub checks and code review.
2. Separate approval/access for the clearly identified isolated production fixture lifecycle; no existing real data may be used or changed.
3. Hosted authenticated authorization/receipt/Realtime/revocation and compatibility acceptance, with recorded failures/skips and bounded cleanup. Stop on any failed safety gate; do not relax security controls.
4. Separate release approval before merging. No merge/deploy command is executed here. Existing Git integration may automatically build branch previews on push; this is not the main-push production deployment.

Database rollback/disable remains the existing reviewed forward-safe procedure; migration tracking reconciliation itself needs no database rollback. Never replay the old draft versions or remove deployed security policies to reconcile history.
