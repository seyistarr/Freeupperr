# Stage 1 production database result

2026-11-12 UTC. **Approved Stage 1 database migration committed successfully. Stop at the Google canary authorization boundary.**

| Item | Result |
| --- | --- |
| Latest fetched production main | `8ef95c3274de9930d687fed7da39c352d490423e` |
| Implementation working branch | `codex/default-identity`, local changes retained |
| Target | Supabase `jmjtqidirpmnegzvmiaq` |
| Exact approved artifact | `/workspace/freeupper-validation/identity-privacy/stage1-proposed.sql` |
| Artifact SHA256 | `758c146504c07973890a00df1d647b8fb3ce342afcf27d0793494168a6dbef21` |
| Migration | `20261109051236_default_profile_identity` |
| Migration history | 78 → 79 entries; one new reviewed entry |
| Existing profiles | 71 → 71 |
| Existing identity fingerprints | All 71 unchanged |
| Existing Auth count and UUID fingerprint | Unchanged |
| Username conflicts / malformed IDs | 0 / 0 |

The exact artifact was submitted in one SQL API transaction. Only the psql client instruction `\set ON_ERROR_STOP on` was omitted for transport; SQL statements were unchanged. The ledger's embedded source MD5 is `6ba41b861f0c3c6054d12ee0cfefe7e2`, matching the reviewed artifact. No blanket push or historical replay was used.

## Mandatory preflight results

Main advanced from 23d4d84 through four chat-only commits. Identity source and deployment files did not change. All 174 accepted application functions matched their prior definitions/owners/ACLs before execution. Profile column defaults, grants, RLS flags, five policies, constraints, existing indexes and Auth/profile triggers matched the reviewed catalog after normalizing snapshot representation. All relevant indexes were valid and ready.

The existing FUID default remains FU plus twelve uppercase UUID-derived hexadecimal characters. The migration reuses that default, unique indexes and bounded retries for the known new-profile uniqueness conflicts. Accepted separate-session contention tests were not repeated.

The reviewed resolver preserves its return contract, suspension filter and grants while rejecting email inputs. It does not add aliases or expose new tables. The approved SQL has no existing-profile UPDATE/DELETE statements. Atomic failure rollback and privacy-preserving roll-forward procedures were ready before execution.

## Post-migration verification

Fingerprints cover UUID, FUID, username, display_name, display_username, creation timestamp and onboarding/profile-completion state. Every existing profile matched. All 45 existing candidate profiles remain untouched.

Only the two reviewed existing functions changed: handle_new_user and get_public_profile_by_username. The new insert/update triggers are enabled; existing protection/counter/update triggers remain enabled. Profile RLS flags, policies, indexes and resolver ACLs remain unchanged. Private schema access is denied to anon/authenticated; its two trigger functions are invokers, and no private tables or aliases were created. Direct public execution of handle_new_user was revoked as reviewed.

All current canonical Auth email inputs return zero resolver rows, without exporting emails. Every eligible safe current handle still resolves to the expected UUID. An actual anon-role read-only check rejected an email input and private schema access.

Read-only HTTP checks returned 200 for the web homepage, profile page, API health, Supabase Auth health and public post/profile reads. The API's email-handle lookup returned an empty result. An initial anonymous search probe returned 401: inspection confirmed this is the unchanged authenticated-only grant, not a regression. Search then passed in a read-only authenticated-role database transaction.

Security advisers report no new findings: mutable-search-path warnings fell 29 → 28 and public definer-execution warnings fell 44 → 43 for anon and 92 → 91 for authenticated. Other existing findings remain unchanged. This is not a claim that the broader pre-existing security backlog is resolved. [Supabase adviser guidance](https://supabase.com/docs/guides/database/database-linter).

No mandatory verification failed, no unexpected persistent change was found, and no rollback was required. Auth health and database invariants passed; a real account login/signup was deliberately not attempted.

## Next authorization boundary

The Google canary is prepared using FreeUpper's existing normal provider flow. A fresh owner-authorized dedicated Google account has not been supplied, and Auth/profile/session writes for it are not authorized. Once identified, obtain explicit canary approval before opening signup. The owner handles consent, verification and MFA; no client secret, password, OAuth code or token is to be collected.

Verify new defaults, email privacy, stable UUID/FUID and names after repeat login, and profile customization under the approved canary scope. No test account was created by this release.

Frontend deployment is **not ready for execution approval yet**: the real Google canary remains pending, and the local identity changes must be reconciled with the new chat main before presenting the final exact publishing commit(s). No push, merge, code commit, web deployment, API Worker deployment or trigger configuration change occurred.

After canary success, present the final code revision and coordinated GitHub web/independent Cloudflare API sequence for separate approval. Do not treat this database result as permission to publish.

Stage 2 remains entirely separate and unexecuted: the prior dry-run proposed 94 fields across 45 profiles, excluding two ambiguous fields on one account, plus one mention-metadata scrub. Its manifest must be rechecked and separately approved before any existing-user changes.

## Monitoring and recovery

Continue observing Auth callback/signup errors, uniqueness/constraint errors, lock timeouts, default identity consistency and incomplete-onboarding state. Verify the canary without resetting real users. Keep monitoring profile, post, search and UUID-based relationship behavior.

The SQL transaction has committed; a Worker rollback cannot undo it. If a later issue appears, stop publishing and prefer a reviewed roll-forward repair that preserves safe defaults and email-input rejection. Do not restore the email-leaking trigger, delete accounts or overwrite existing identities. Any further production SQL beyond this completed migration requires its corresponding authorization.

Private operational evidence is under `/workspace/freeupper-validation/identity-privacy/`: stage1-before.json, stage1-after.json, stage1-live-preflight.json, stage1-live-catalog.json, stage1-after-functions.json, stage1-http-verification.json, stage1-rpc-verification.json and stage1-execution-summary.json. Fingerprints contain no plaintext email values. The RPC evidence retains the initial expected anonymous 401 rather than hiding the probe outcome.
