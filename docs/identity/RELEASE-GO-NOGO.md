> Historical preparation evidence. Current execution instructions and classifications are in [TWO-STAGE-RELEASE.md](TWO-STAGE-RELEASE.md); any former alias migration proposal is superseded.

# Identity release: go/no-go review

2026-11-09 UTC. Baseline main remains `23d4d84bca1a6f94b058c6b5d1c3eaf50449738a`; branch is `codex/default-identity`. Accepted preparation evidence was not rerun. This pass performed read-only checks and wrote local review documents only.

**NO-GO for production execution now.** The mandatory unresolved item is an authorized real Google signup/login canary and its permitted timing. The deployment sequence is now established without requiring a configuration change. Broad hosted Supabase parity differences are residual risks for this particular migration, not a reason to repeat the completed restore/regression work. Explicit release authorization is still required.

## Mandatory Google OAuth decision

The existing frontend calls `signInWithOAuth({provider:'google', options:{redirectTo:window.location.href}})` through the existing production gateway. No new OAuth architecture, client credential, or ID generator is needed.

A real Google signup creates production Auth/profile records. Even an existing-account login writes Auth sessions/last-sign-in state. Changing only `redirectTo` to a local or preview frontend does **not** isolate authentication: the configured Supabase project still performs the provider callback and stores the user/session. Therefore the requested real signup/login cannot be performed using the production configuration while the prohibition on production Auth writes remains in force.

The existing non-production project `tagkrhvgcbnybiuyvjxt` reports `external.google=false` through its public settings. No OAuth flow was initiated there. The production public-settings request returned HTTP 403, so no assertion is made about its current provider-enabled flag from that endpoint. No management endpoint returning OAuth secrets was requested; no client secret was extracted, copied, or displayed.

Safest future canary, after separate explicit authorization:

1. An operator identifies one authorized Google test account whose email is not already an Auth identity in the target project. Do not delete or unlink an existing account to force a signup. Do not use any ambiguous existing profile as a canary.
2. The operator confirms the existing Google provider is enabled and its currently registered Supabase callback is correct, without revealing the secret field. Use the already configured client; no OAuth configuration changes are needed for this production path.
3. Approve the schema step **and** the narrowly scoped canary Auth/profile/session writes. Keep main frozen. Apply only the guarded identity schema transaction, then test through the currently deployed FreeUpper page. The existing Google call is unchanged, so the old deployed page exercises the new backend trigger before the web release.
4. The account owner performs Google sign-in/consent/MFA in the normal browser. Supabase performs the secret-bearing code exchange; the agent does not collect passwords, OAuth codes, tokens, or client secrets.
5. Verify a genuinely new Auth UUID and one existing-generator FreeUpper ID; username/display_username equal `lower(freeupper_id)`; display name is `FreeUpper User`; profile completion remains unset. Sign out and sign in again with the same Google account; UUID, FreeUpper ID, names and creation timestamp must remain stable. Confirm provider is Google and no unexpected account linking occurred.
6. Retain only minimal pass/fail evidence and the test identity reference, without email/token exports. Do not automatically delete/recreate the test account or modify other users. If the canary fails, stop before pushing the web release; keep the privacy-safe defaults while reviewing the failure.

This is a staged release decision: permission for a controlled backend/canary stage does not imply permission to push or deploy the web stage. If real Google testing must precede **all** production DDL/Auth writes, an already authorized isolated OAuth project is required. The known staging project is not ready for that path; enabling a provider and registering an isolated callback would require a separately approved setup performed by the owner, without extracting the production secret. Neither path has been executed.

Reference: [Supabase Google sign-in and callback configuration](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [redirect allow list](https://supabase.com/docs/guides/auth/redirect-urls).

## Verified deployment ownership — correction to earlier report

Live Cloudflare GET requests now establish the commands, not just successful check names. Both Workers watch `seyistarr/Freeupperr`, branch `main`, repository root `/`, paths `*` with no exclusions.

| Path | Build command | Production deploy action |
| --- | --- | --- |
| Cloudflare `freeupper-web` | `npm run build:cloudflare` | **No publish.** `node -e "console.log('Production publishing is owned by GitHub Actions')"` |
| Cloudflare `freeupper-api` | `npm run test:api` | **Independent publish.** `npm run deploy:api` (`wrangler deploy --config cloudflare/api/wrangler.jsonc --keep-vars`) |
| GitHub Actions | Full `worker` build/test job | `deploy-production` publishes `freeupper-web` after `needs: worker`, on a main push, with `--keep-vars` |

The previous inference that the dashboard web build independently publishes production was incorrect. It currently does not. Web previews are enabled; API previews are disabled. Production trigger configuration is what establishes the ownership above; preview isolation is not inferred from a URL or name.

The GitHub web deployment uses environment `production` and concurrency group `freeupper-web-production`, `cancel-in-progress:false`. This serializes that GitHub deployment job only; it does not serialize API dashboard builds. No required-human-review rule is assumed merely because the environment is named production.

All 164 web and 161 API build records were checked: none was queued, initializing or running at this snapshot. Recent main GitHub runs were completed. Recheck queues immediately before an approved release; this is a point-in-time observation, not a lock.

Current rollback versions captured read-only:

- Web: `886220ef-913f-4906-8f18-c0e5f6203080` at 100%.
- API: `534a3ca6-815c-4b25-ab3a-fd59fa86e370` at 100%.

The identity branch changes neither API Worker source/config nor package manifests/lockfile relative to main. Its automatic API redeployment is expected to be semantically unchanged, but still needs observation. No dashboard trigger needs to be disabled merely to release this identity change. Prior Vercel discovery found no visible connected project; that limited visibility remains a residual risk, not a claim that every external account was inspected.

### Coordinated sequence, with current settings unchanged

1. Obtain explicit approval for the chosen Google test path and release stages. Reserve a window with no unrelated main pushes; capture current versions and confirm deployment queues are drained. No push, preview upload or rerun should be used as a probe now.
2. Recheck the read-only database guards. Apply only `/workspace/freeupper-validation/release-gates/release-default-identity.sql`, which commits `20261109051236_default_profile_identity` plus its history record atomically. Do not run `supabase db push`, replay old migration files, repair historical versions, or execute the existing-user scripts.
3. Run the authorized Google canary after the schema step, using the existing production OAuth configuration and deployed page. This makes provider/gateway behavior the final focused verification without secret extraction or a new OAuth configuration. Do not claim a canary pass before this happens.
4. After canary acceptance and explicit authorization for the web stage, push/merge the reviewed commit once. Cloudflare API independently runs its focused tests and may redeploy; dashboard web only builds/logs; GitHub alone publishes production web after its normal CI checks. Monitor both real publish paths. Their relative completion order is not guaranteed, so the schema must already be committed before the push. No production setting change is required for this sequence.
5. Verify released defaults, repeat login, explicit customization, incomplete-profile privacy, and version/PWA activation. Keep all existing-user migration manifests empty. Wait for both publish paths to settle before declaring success or rolling back.

Rollback: restore the captured prior web Worker version while retaining the safe database defaults. If needed, separately restore the API version after its independent build has stopped. Coordinate queues to prevent an in-flight build overwriting a rollback. No user-data rollback is needed or authorized because this release performs no existing-user migration. A database hotfix/rollback requires separate approval; do not restore the original email-derived Auth trigger automatically.

## Hosted parity: materiality for this migration

The accepted isolated tests used PostgreSQL 17.6, real GoTrue and restored production application DDL. Fresh production inspection still reports PostgreSQL 17.6. `auth.users.id` is UUID, `raw_user_meta_data` is JSONB, `auth.uid()`/`auth.role()` retain the expected claim-reading implementations, and core `gen_random_uuid()` and `sha256(bytea)` are present. The migration uses these stable database interfaces; it does not depend on a particular Google metadata name/email format for its defaults.

| Difference | Effect on this identity migration | Further isolated work? |
| --- | --- | --- |
| Supabase build versus upstream PostgreSQL 17.6 | Required SQL, UUID/hash functions, triggers, indexes and profile definitions match; source DDL was restored and tested | No broad restore needed |
| pgvector 0.8.7 in isolation versus 0.8.2 in production | No vector type, operator, index or extension change is made by the identity migration | No |
| Managed vault, pg_net and storage runtime not reproduced | No new identity function calls these services; existing application functions/triggers are unchanged | No for this scope |
| Hosted GoTrue version/config versus local v2.197.0 | Stable Auth insert interface is verified; Google callback, gateway redirect and provider account-linking remain the relevant untested runtime path | One real Google canary is necessary; generic Auth tests should not be repeated |
| Optional WebKit theme coverage skipped | This change adds no browser-specific OAuth implementation or redesign | Accepted residual; no repeat of the regression suite solely for this |

Exact hosted-stack parity is therefore **not a mandatory blocker for this specific DDL**. The real Google flow is material and remains unverified. Reassess only if the scope changes, production dependencies drift, or that canary exposes a provider-specific issue.

## Fresh schema compatibility and exclusions

Current read-only checks:

- **71 profiles, 71 distinct FreeUpper IDs**, zero malformed/missing IDs and zero default-username conflicts.
- **78 migration entries**, latest `20261031073211`; history fingerprint still `41fd94d8bcec559910015c315134796e`. The new migration and `identity_private` schema remain absent.
- Profile columns/defaults/ACL/RLS flags, relevant Auth/profile triggers, constraints, non-constraint indexes and policies exactly match the accepted snapshot. All **174 captured application functions**, including their ACLs/owners/signatures/bodies, are unchanged.
- The reviewed migration SHA-256 remains `286bb00938b215d59ea79eb752e89e68045a0141b595c719bbc7c3afd6c92d12`. The proposed targeted artifact remains compatible; it does not assume a fixed count of 70 profiles.
- All **original 44** profiles remain present and remain in the review set. Their sorted-ID fingerprint is still `a2da2279cc932e99de4458dac73ead3b`. The existing-user field manifest contains **no approval INSERTs**.
- There is now **one additional account with @ in an identity field**, making 45 current candidates. Its origin was not classified and it is excluded by default. The original immutable 44-account review file was not rewritten to imply that this new account was reviewed. All 45 current candidates remain untouched.

The higher profile and candidate counts are data changes, not a detected schema incompatibility; no assignment origin is inferred from them. There is no reason to repeat the 504 accepted regression passes or the completed migration tests. New evidence is limited to read-only production/configuration comparisons and this scope analysis.

## Final decision

**Mandatory before execution:** explicit staged release authorization, a named/authorized fresh Google test identity, and permission for its unavoidable Auth/profile/session writes (or a separately approved isolated OAuth environment if all testing must precede production changes). The production Google signup/login result is not yet available.

**Ready:** migration compatibility, fixed-set exclusion proof, deployment ownership and a no-settings-change coordinated sequence.

**Residual, not mandatory blockers for this scope:** unrelated managed-extension parity, unavailable exact hosted GoTrue version beyond the focused Google canary, accepted WebKit skip, and Vercel visibility outside connected scopes. These do not erase their limitations or imply unverified tests passed.

No accepted tests were repeated, no production/Auth records or settings were modified, and nothing was pushed, merged or deployed. Redacted configuration and fresh comparison evidence are under `/workspace/freeupper-validation/release-gates/blocker-*`.
