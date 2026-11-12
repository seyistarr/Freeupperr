# Two-stage identity privacy release approval packet

> Stage 1 database migration was explicitly authorized and committed on 2026-11-12. See [STAGE1-PRODUCTION-RESULT.md](STAGE1-PRODUCTION-RESULT.md) for current status. The preparation evidence below is retained as reviewed; its pre-execution status and main commit are historical. Google canary, code publishing and Stage 2 remain unauthorized.

Prepared 2026-11-10 UTC on `codex/default-identity`. Read-only refresh confirms latest main is `23d4d84bca1a6f94b058c6b5d1c3eaf50449738a`.

**Ready for staged approval; NO-GO for execution without it.** No production writes, Auth changes, push, merge, deployment or settings changes have been performed. This packet supersedes earlier alias proposals and provenance-only migration classifications. The legacy migrate-reviewed.sql and rollback-reviewed.sql now fail closed.

## Stage 1

Use the existing profiles.freeupper_id column default and generator. There is no second ID generator. The trusted insert trigger supplies lower(freeupper_id) for username/display_username and FreeUpper User for display_name. Authentication UUIDs and existing profiles are retained; onboarding remains incomplete. Auth insertion retries known unique conflicts up to five times. Repeat login does not reset names.

The Auth trigger inserts only the existing UUID/avatar; browser signup/recovery no longer supplies email-derived public identity. Recovery uses conflict-ignore insertion and rereads the winning profile. Existing policies and immutable-ID protections remain. Updates validate changed identity fields, reserve the generated-handle namespace and preserve unrelated custom values.

Exact schema source: [20261109051236_default_profile_identity.sql](../../supabase/migrations/20261109051236_default_profile_identity.sql).

Approval artifact: /workspace/freeupper-validation/identity-privacy/stage1-proposed.sql.

| Artifact | SHA256 |
| --- | --- |
| Stage 1 source | f54e457b2d2096314e32afe90ecdf8becb0bc645fc30ea6ed0f9b820acee3af5 |
| Guarded Stage 1 transaction | 758c146504c07973890a00df1d647b8fb3ce342afcf27d0793494168a6dbef21 |
| Separate Stage 2 proposal | 7f2777a1093d0908f12e25d9b58d5efafd078604f30da45e9463a613fb99d089 |

Stage 1 changes database functions/triggers, creates the deny-access identity_private schema, and records only migration 20261109051236. It changes **zero existing profile rows**. The public resolver accepts safe current handles only; email inputs return no account. Stage 1 does not correct existing public email values; those remain pending Stage 2.

Production currently has 71 profiles, 71 unique valid FUIDs, no missing IDs or default-handle conflicts. The four relevant unique indexes are valid/ready. The accepted catalog comparison found all 174 existing application functions unchanged. The fresh history check remains 78 versions, latest 20261031073211, sorted-version MD5 41fd94d8bcec559910015c315134796e; identity_private remains absent. The wrapper checks history and profile preconditions and applies DDL plus its ledger entry atomically. Historical local migration timestamps differ from hosted history: **no blanket db push, repair, or replay**.

## Stage 2 dry run — separate approval

Classification independently compares each identity field, case sensitively, with auth.users.email and requires email_confirmed_at IS NOT NULL. User-supplied metadata is not evidence. Exact verified-email exposure is the approved criterion; this does not establish who originally chose the value.

| Proposed correction | Fields |
| --- | ---: |
| username to lower(existing freeupper_id) | 44 |
| display_name to FreeUpper User | 43 |
| display_username exposure removed | 7 |
| Total | 94 across 45 profiles |
| Ambiguous values excluded | 2 fields on 1 profile |

One auxiliary-only correction mirrors the preserved nonmatching custom canonical username. No nonmatching canonical name is replaced. The former 44-account ambiguity exclusion was based on the superseded provenance criterion; it is not the current classification. Across all three columns, 46 profiles have candidate values. The original 45 potential candidates were never an approved migration list.

The fresh read-only recheck exactly matches all saved field decisions and fingerprints. No private email values were returned or exported. The field-level review CSV is /workspace/freeupper-validation/identity-privacy/stage2-field-dry-run.csv; the concrete SQL is stage2-proposed.sql in that directory. It ends in **ROLLBACK**, not COMMIT.

One public post contains one UUID-bound mention entry with two exposed JSON properties. The proposal scrubs those properties only: **zero post text changes**. Existing offsets and other mention metadata remain. No confirmed comment references or nested known identity snapshots were found in the inspected post/message JSON fields. The post fingerprint was rechecked unchanged. New confirmed fields or references outside the manifest abort execution.

Stage 2 locks Auth users SHARE, then profiles SHARE ROW EXCLUSIVE, with a 5-second lock timeout and 60-second statement timeout; it briefly blocks Auth writes but does not modify Auth records. Post/reference scans also take scoped table locks. Exact fingerprints, verified matches, full-set membership, ID validity and username conflicts must pass. Private deny-all RLS backup tables retain before/after values; no public aliases are created. Existing backup tables prevent accidental rerun. Approval must cover the exact manifest and a COMMIT-enabled final artifact, plus private backup retention.

## Security and compatibility

No email-derived aliases, hashed lookup aliases or email redirects remain in this proposal. Old email-handle routes return a generic missing-profile result; resolver inputs return no rows. Stable UUID and existing /u/FU… links continue to identify the same accounts. Preserving an email-to-account redirect would create a discovery oracle, so those unsafe links are retired. This does not globally scrub arbitrary user-authored text or uncertain values.

Application changes are auth.js, api/profile-preview.js, profile.html, index.html and the service-worker cache version; tests and identity preparation scripts accompany them. Existing UUID-based posts, follows, messages, notifications and media relationships are not rewritten.

Evidence for the revised scope:

* Full regression: 509 tests, 508 passed, 0 failed, 1 optional WebKit skip.
* Focused run: 24 passed; final supplementary SQL guard tests: 8 passed. These overlap and are not additive coverage counts. The supplementary run covers the final guard and invoker adjustment after the full run.
* Real PostgreSQL 17.6 production-application-schema restore with synthetic rows: 20 checks passed, including 94-field migration, dry-run rollback, custom/ambiguous preservation, stable IDs/relationships and public-role denials.
* Official security-lint queries on migrated isolation: no new identity WARN/ERROR; two expected INFO findings for deny-all private backup tables. Actual authenticated ownership checks allowed the owner's edit and denied foreign edits; the validator is SECURITY INVOKER.
* Both Worker dry-run packages passed. Accepted earlier real Auth, email confirmation and separate-session collision evidence was not repeated.

Evidence is in /workspace/freeupper-validation/identity-privacy/. Local tests never used production rows. Managed pgvector/vault/pg_net/storage runtime differences do not affect these SQL dependencies; exact hosted GoTrue/provider runtime remains covered only by the pending Google canary. No broad restore repeat is necessary absent drift or a canary failure. WebKit availability and limited Vercel account visibility remain accepted residual risks.

## Google canary — mandatory prerequisite

An owner must provide an authorized dedicated Google account never registered in this project, and explicitly authorize its Auth/profile/identity/session writes. The operator handles consent/MFA in the normal browser. Do not extract secrets, passwords, OAuth codes or tokens. Use the existing provider and callback configuration; no configuration change is proposed.

After separately approved Stage 1 DDL, use the currently deployed normal Google signup flow before publishing web changes. Check one UUID/FUID, FreeUpper User, matching lowercase FUID handles, incomplete onboarding, and unchanged identities/names/creation time after sign-out and repeat login. Do not delete/recreate an existing identity to simulate signup. Stop before web release if this fails.

The known isolated project's Google provider is disabled; production public settings returned 403, so that endpoint did not establish its provider flag. No real Google flow has been executed. Testing before any production DDL/Auth write would instead require a separately authorized isolated OAuth setup.

## Coordinated release sequence requiring approval

1. Approve the exact Stage 1 SQL artifact and narrowly scoped canary writes. Freeze unrelated main pushes, drain deployment queues, recheck guards and capture current Worker versions.
2. Apply only the guarded Stage 1 transaction; verify ledger, functions, grants and zero existing-profile changes. Run the authorized Google canary.
3. After canary review and separate push/merge/deploy authorization, publish one reviewed code revision. Observe both deployment paths; do not change trigger configuration.
4. GitHub Actions runs the worker regression job, then deploy-production with needs: worker, main-only production environment and freeupper-web-production concurrency (cancel-in-progress false). It owns web publishing with --keep-vars.
5. Cloudflare freeupper-web independently builds main using npm run build:cloudflare, but its production deploy command only logs that GitHub Actions owns publishing. Its previews are enabled. Cloudflare freeupper-api independently runs npm run test:api then npm run deploy:api with --keep-vars; previews are disabled. API source/config is unchanged by this release, but its redeployment still needs observation.
6. Verify deployed web/API versions, service-worker refresh, new email/Google defaults, repeat login, custom-name editing, recovery, onboarding privacy and safe profile routes.
7. Recheck Stage 2 manifest after Stage 1/canary. Obtain separate approval for its exact records, reference scrub, COMMIT artifact and backup retention. Do not widen a stale manifest automatically.

No visible connected Vercel project was found in the prior scoped discovery; visibility outside connected accounts is not established. Cloudflare ownership details are documented in RELEASE-GO-NOGO.md; its prior migration-classification/alias recommendations are superseded here.

## Rollback and monitoring

Before commit, SQL failure rolls back atomically. After Stage 1, prefer a roll-forward repair while retaining privacy-safe defaults and email-input rejection. Reverting frontend versions does not require restoring the former email-leaking Auth trigger. Captured Worker rollback candidates are web 886220ef-913f-4906-8f18-c0e5f6203080 and API 534a3ca6-815c-4b25-ab3a-fd59fa86e370; recapture immediately before execution.

After Stage 2, keep corrected names and repair forward. The exceptional stage2-rollback.sql restores private email values and therefore requires separate explicit email-reexposure approval; it compares expected after-values to avoid overwriting later customization. It ends ROLLBACK by default. Backups remain private; retention/purge is a separately reviewed action.

Monitor signup/callback failures, 23505/23514 errors, lock timeouts, default-name/FUID consistency, incomplete onboarding, immutable IDs, unchanged custom profiles and counts. Verify old email lookups return no account, private backups remain inaccessible to anon/authenticated, the planned mention scrub leaves text unchanged, and existing follow/chat/media/notification operations retain UUID relationships. Observe independent API and web deployment queues and PWA cache activation.

**Outstanding mandatory blockers:** explicit staged production authorization; authorized fresh Google account and successful real signup/repeat-login canary; subsequent authorization for code publishing; separate Stage 2 manifest/commit approval. No production operation is authorized by this preparation report.
