> Historical preparation evidence. Current execution instructions and classifications are in [TWO-STAGE-RELEASE.md](TWO-STAGE-RELEASE.md); any former alias migration proposal is superseded.

# Default identity — final release readiness

2026-11-09 UTC. This supersedes the earlier report's outstanding-gate and test-result sections. **No production deployment, production DDL, production Auth account creation, migration-history repair, or existing-user update was performed.** No branch was pushed. All 44 ambiguous accounts remain excluded.

Main was fetched again and remains `23d4d84bca1a6f94b058c6b5d1c3eaf50449738a`. Work remains on `codex/default-identity`. The reviewed application implementation and migration were not changed during this verification pass; reusable verification and release-preparation scripts were added under `scripts/identity/`.

## Readiness decision

The production application-schema restore, real local email Auth, separate-session concurrency, collision recovery, private alias access boundaries, targeted migration transaction, and regression gates passed. **Production is not cleared for deployment.** Google OAuth is unverified because no isolated OAuth client credentials or authorized Google test account are available. Exact hosted Supabase/managed-extension parity and deployment connections outside the available account scopes remain unverified. These limitations must be resolved or explicitly accepted in a subsequent release decision; this report is not deployment authorization.

| Gate | Result |
| --- | --- |
| Real Supabase Auth email signup/login/refresh | Passed with GoTrue v2.197.0 against restored production application DDL |
| Confirmation-required email signup | 8 checks passed: actual SMTP delivery to local Mailpit, no session before confirmation, unconfirmed login denied, real verification callback, login afterward, unchanged profile/UUID |
| Google OAuth registration/login | Blocked: no isolated Google client credentials or authorized test identity; no fake Google login is counted as a real pass |
| Concurrent registrations | Eight concurrent real GoTrue registrations passed; 24 independent psql clients used 24 distinct PostgreSQL backend PIDs and created unique profiles |
| Forced concurrent ID collision | Six independent backends succeeded; four lock waiters observed; eleven default evaluations produced six unique IDs/usernames after five retries |
| Repeated collision failure | Real Auth registration failed atomically after bounded retries without a partial Auth user |
| Production application-schema restore | Passed twice, without production rows: 79 tables, 174 application functions, 289 constraints, 111 non-constraint indexes, 214 RLS policies, 42 triggers including the Auth callback, plus view/sequences/grants/default ACL metadata |
| Security/RLS advisers | Production Supabase adviser captured; ten official Supabase lint queries ran after migration on the isolated restore, with no execution errors and no new identity WARN/ERROR findings |
| Alias API boundaries | 17 real PostgREST checks passed for anon and a real GoTrue JWT; private tables/schema/functions denied; no wildcard enumeration; old handle absent from returned identity |
| Deployment triggers | GitHub Actions and both Cloudflare Workers Builds paths observed on current main; no Vercel project visible in connected scopes |
| Migration order/history | 78 production entries reconciled against 12 local files; exact guarded single-migration artifact tested with atomic history registration |
| Existing users and exclusions | Existing synthetic profile remained byte-for-byte unchanged through migration/login/refresh; current 44-account review set matches the original set hash |
| Final focused tests | **20 passed, 0 failed, 0 skipped** |
| Complete regression suite | **504 passed, 0 failed, 1 skipped**; 505 tests, 307.5 seconds |
| Worker build/packaging | Web and API dry runs passed; neither was uploaded |

The 21 real Auth/database integration assertions, 17 API assertions, eight email-confirmation assertions, and collision-race check are separate from the Node test counts. Do not add them as unique regression tests. The Node skip is optional WebKit theme coverage; its Linux dependencies are unavailable. Chromium and local Worker runtime checks passed.

## Production baseline and isolation limits

The authoritative schema was read directly from `jmjtqidirpmnegzvmiaq`, not staging. Production still has 70 profiles. Current migration history ends at `20261031073211_prevent_self_relationships`. The proposed `identity_private` schema is absent in production.

The restored application schemas are `public`, `privacy_v2_private`, and `otd`. Application DDL, constraints, function bodies, indexes, policies, triggers, object grants, schema ACLs and default-ACL metadata were captured without application rows. GoTrue initialized its own local `auth` schema; production Auth users, identities, credentials and sessions were never copied. The production `auth.users` profile-creation trigger and Auth helper function definitions were restored against that local managed schema.

Local PostgreSQL is upstream 17.6, matching production's PostgreSQL minor version; production's Supabase build is 17.6.1.141. The matching full Supabase image exceeded available disk capacity. The successful local application restore uses pgvector 0.8.7; production has 0.8.2. The identity migration does not modify vector behavior, but exact binary parity is not claimed. Managed vault, pg_net workers, storage APIs, production email delivery and hosted Google configuration were not reproduced. Their runtime behavior is not a passing result of this restore. The production Auth health route returned 403 through the existing gateway, so the production GoTrue version remains unconfirmed; no gateway bypass was attempted.

Local services were PostgreSQL 17.6, GoTrue v2.197.0, PostgREST v16.5, and Mailpit v1.33.1. Credentials were generated for these services only; test mail used `example.test` recipients and never left the local mailbox. Both auto-confirm and confirmation-required registration paths were tested. No paid Supabase branch/project was created.

## Security findings and alias guarantees

Production's adviser reported these existing categories:

| Category | Findings | Remediation/reference |
| --- | ---: | --- |
| RLS enabled without policies | 27 INFO | [Supabase lint 0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) |
| Mutable function search_path | 29 WARN | [Supabase lint 0011](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) |
| Extension in public | 2 WARN | [Supabase lint 0014](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) |
| Anon-executable SECURITY DEFINER functions | 44 WARN | [Supabase lint 0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) |
| Authenticated-executable SECURITY DEFINER functions | 92 WARN | [Supabase lint 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) |
| Leaked-password protection disabled | 1 WARN | [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |

These findings are not all distinct vulnerabilities; several describe intentionally restricted RPCs or intentionally inaccessible tables. They are not silently fixed by this release. The isolated post-migration checks reduce mutable-search-path findings to 28 and executable-definer findings to 43/91 because `handle_new_user` is hardened. Two new INFO notices are expected: alias and backup tables have RLS enabled with no policies, deliberately denying ordinary users. No identity-specific WARN or ERROR was found.

Actual API tests verify:

- Neither anon nor authenticated can select aliases or plaintext rollback values, select `identity_private` through Accept-Profile, or invoke private trigger functions/the Auth trigger function.
- The public resolver retains its existing restricted return contract, returns the current handle rather than the old email-derived string, and accepts no wildcard enumeration.
- All 214 pre-existing application RLS policies remained unchanged by the migration.

**Compatibility has a deliberate privacy limit:** exact former-handle resolution associates a caller-supplied known old handle with the current public profile. It prevents listing/returning old handles, but does not hide that association from someone who already supplies the exact value. No production aliases are created in this release, because no existing fields are approved for migration. Existing excluded profiles may still expose their current legacy values through existing profile behavior; no global removal of email-derived identities is claimed.

## Exclusion proof

The original review set and current production set both contain **44** FreeUpper IDs. The MD5 of the sorted comma-separated public IDs is `a2da2279cc932e99de4458dac73ead3b` in both checks. No email values were exported. Confirmed automatic-migration counts remain **0 username fields and 0 display-name fields**; the earlier 43/42 email matches remain unverified candidates. The field-level migration manifest remains empty. No candidate is promoted because these verification tests passed.

## Deployment trigger verification

Current main has successful checks from:

1. GitHub Actions `worker`, followed by `deploy-production`, run [42533565976](https://github.com/seyistarr/Freeupperr/actions/runs/42533565976). The repository workflow builds/tests, then deploys `freeupper-web` on a push to main with variables retained.
2. Cloudflare Workers Builds for [freeupper-web](https://dash.cloudflare.com/f531b9f9d79d612ddee4e0de01f12324/workers/services/view/freeupper-web/production/builds/a58a4f8e-ea91-4a78-be26-514b53b452f2).
3. Cloudflare Workers Builds for [freeupper-api](https://dash.cloudflare.com/f531b9f9d79d612ddee4e0de01f12324/workers/services/view/freeupper-api/production/builds/da7f6ee9-5b93-4d5f-ac01-f691c7c0da16).

Both dashboard Builds completed before the GitHub deployment stage. Consequently, pushing main can deploy independently of the repository test gate and can redeploy the API Worker even though this feature changes no API gateway logic. Do not rely on GitHub's production job as the only deployment control. No Cloudflare dashboard settings were changed.

Vercel project searches by repository/name and a full visible team-project list returned zero projects in both the connected personal scope and `seyistarr's projects` (`team_V6feGIkHBGzO4k0xBbcjnvMj`). Current commit checks/statuses show no Vercel deployment. `vercel.json` and npm Vercel commands remain in the repo. Connections under another inaccessible account or organization cannot be ruled out; the owner must confirm those scopes before release. No Vercel project was linked, unlinked, or deployed.

## Reconciled migration history and exact proposed order

Production has **78** history entries. Local history has **12** files including the new identity migration. Eight versions match; 70 production versions are absent locally. These local historical filenames have differently timestamped production equivalents and must **not** be replayed:

| Local file version | Production equivalent | Reason to retain production state |
| --- | --- | --- |
| `20261015000000` profile setup | `20261015142317` profile setup completion | Completion/SEO components already exist |
| `20261027194500` post sitemap | `20261027215657` public post sitemap | Production also has later discovery/privacy changes; replay could regress those |
| `20261027233000` video SEO | `20261027222126` public video SEO | Existing function already deployed under a different version |

No old versions were marked applied/reverted and no migration repair was run. **Do not run a blanket `supabase db push` or replay repository history.**

A concrete single-release artifact is prepared outside source control at `/workspace/freeupper-validation/release-gates/release-default-identity.sql`. Generate it with:

```sh
python3 scripts/identity/prepare-release.py /workspace/freeupper-validation/release-gates/production-migrations.json --output /workspace/freeupper-validation/release-gates/release-default-identity.sql
```

The reviewed source is `supabase/migrations/20261109051236_default_profile_identity.sql`, SHA-256 `286bb00938b215d59ea79eb752e89e68045a0141b595c719bbc7c3afd6c92d12`. The artifact locks profiles, checks the exact captured 78-version history fingerprint (`41fd94d8bcec559910015c315134796e`), refuses an existing identity schema or invalid/conflicting IDs, applies only this DDL, and registers **`20261109051236_default_profile_identity`** in the same transaction. It has bounded lock/statement timeouts. It contains no profile UPDATE/DELETE/backfill.

The artifact passed against the second empty application-schema restore with a synthetic existing profile: history became 79 entries, the existing profile was identical, and the private backup table remained empty. A second application was rejected by the history guard. This was not production execution.

After blockers are resolved and explicit release approval is received, the exact order is:

1. Re-fetch main; recheck production schema/history, dry-run counts and all 44 exclusions. Regenerate/review the artifact if anything changed. Capture protected backups plus current function/trigger definitions, ACLs, migration ledger, Cloudflare immutable Worker versions, and deployment queues.
2. Coordinate **all three** observed deployment paths and any owner-confirmed Vercel path. Prevent an automatic push deployment from racing the database change. Changing these settings requires its own approved operation; none has been changed here.
3. Apply only the reviewed guarded identity SQL artifact to the explicitly verified production project. The schema and its one history entry commit together. Do not run either existing-user data script.
4. Perform the approved post-schema verification below. Old clients are compatible because the INSERT trigger overrides old email-derived metadata before a public profile is stored.
5. Only after schema verification, push/merge and deploy the reviewed web commit through the coordinated release path. Account for the dashboard API Worker build, even if its code is unchanged. Confirm both Workers' versions and retained variables.
6. Verify the web/PWA update, existing logins, onboarding/customization, privacy and relationships. Monitor signup failures. Existing-user migration remains a separate, unapproved operation with zero approved fields.

## Post-release verification procedure — proposed only

Use dedicated authorized test identities only after production test writes are explicitly approved. Do not use any of the 44 ambiguous accounts as test subjects.

- New email signup before confirmation: UUID equals Auth user ID; existing database ID is populated once; username/display_username equal `lower(freeupper_id)`; display name is `FreeUpper User`; both completion states remain incomplete. Confirm email and log in; identity stays unchanged.
- Repeat with an isolated authorized Google identity once its OAuth gate is complete. Subsequent Google logins, password logins and refreshes must preserve custom names and UUIDs.
- Customize one test profile through existing Edit Profile; verify normal rules and explicit completion behavior. Interests onboarding remains separate from profile setup.
- Check canonical FreeUpper-ID URLs, username lookup, current mention suggestions, saved UUID mentions, sharing, search, posts, follower relationships and messages without rewriting stored content.
- Check guest/private/incomplete profile previews and sitemaps. Confirm incomplete profiles remain noindex/anonymized and existing privacy policies/column grants are unchanged.
- Verify public/authorized APIs cannot enumerate private aliases or backups. The real production alias and backup tables must remain empty for this release.
- Recheck the 44-account set, production profile counts and migration history. No existing IDs, identity fields, timestamps, content, relationships or media should have been rewritten by the release.

## Rollback

The preferred application rollback restores the recorded previous `freeupper-web` version while retaining the database's privacy-safe defaults. Old web clients still work with those defaults. Coordinate pending GitHub/dashboard builds first so an in-flight build does not immediately overwrite the rollback. Restore the previous API Worker version too if its independently triggered build introduced a regression. Cloudflare rollback does not roll back Supabase.

There is no existing-user data rollback to execute for this release: no field manifest is approved and no production rows are migrated. Keep `migrate-reviewed.sql` and `rollback-reviewed.sql` inactive. They still end with ROLLBACK and have field/stale-value/customization guards.

If database behavior itself fails, stop the release and review a narrow transactional hotfix using the captured definitions and ledger. Retain safe INSERT defaults where possible. Do not automatically restore the former email-derived Auth trigger, drop rollback evidence, delete/recreate accounts, or mark the ledger reverted while new objects remain. Any database rollback or production hotfix requires explicit approval, just like deployment.

## Remaining blockers and evidence

- Google OAuth client credentials and an authorized isolated Google identity are unavailable. Real provider registration/login remains unverified.
- Exact managed Supabase stack parity was not achieved because the matching image exceeded disk capacity. Application-schema/real Auth tests passed with the versions and limitations above; a hosted disposable restore or larger environment is needed for strict hosted-version parity.
- Cloudflare dashboard trigger configuration and any Vercel connections outside the visible account scope require owner confirmation/coordination before pushing.
- WebKit's optional test remains skipped for missing system libraries. No WebKit pass is claimed.
- The pre-existing production adviser findings remain for separate review. No new identity-specific WARN/ERROR appeared in the isolated official lint runs.

Logs, catalog snapshots, reconciliation, adviser output and JSON results are under `/workspace/freeupper-validation/release-gates/`. Production schema snapshots and test credentials were kept outside Git; no private email values or authentication secrets were added to source. Task-created test services and credentials are cleaned up after evidence capture. No production release or existing-user data change is authorized by this document.
