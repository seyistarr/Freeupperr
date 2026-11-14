# Google full-name release on the latest working chat main

2026-11-14. Local integration and read-only production discovery only. No push, production deployment, database migration, profile mutation, Stage 2 execution or production canary repetition.

## Exact baseline and scope

Main: `dddd80073914cb6b16f87d50e67cf4b82d911fca`, newer than the requested starting point `9948dbb`.

Branch: `codex/google-full-name-integrated-dddd800`.

A fresh worktree was created from main. Only the original approved implementation `ab2ffa1ae0a031c433979e7cefa609d712df2061` was cherry-picked (local commit `bbbd1be`). Older integration/harness changes from `bce6c83` were not copied over the current main fixtures. The final review commit adds only this document and a warning on the original preparation review; its exact SHA is in the final report and local release manifest.

Since the previous baseline `5b166c4`, main added `0bf3ad3`, `d98166b`, `9948dbb`, `64c6159`, `9a7e6e3`, `defaa4f`, `70797ff`, `99b8550`, `911f56a`, `1397afe`, `a577b2e`, and `dddd800`. Review includes current inbox recovery for embedded-query failures, non-blocking presence/auxiliary lookups, latest media/poll/lavender styling, saved/starred media actions, current chat fixtures, the stable account-switch assertion, and CI's supported Ubuntu 24.04 WebKit runner.

**`chat.html` and `chat.js` are byte-for-byte identical to latest main.** Current chat tests, the UI-sounds cache-key test, navigation tests, workflow files and dependencies are also unchanged. There were no cherry-pick conflicts or harness edits. The latest working chat application was not modified or replaced.

## Exact changed files against main

- `supabase/migrations/20261112174353_google_signup_display_name.sql`: exact approved source, included in version control only; already applied in production.
- `tests/google-display-name.test.js`: original approved isolated database tests.
- `docs/identity/google-display-name-rollback.sql`: original approved rollback reference; not executed.
- `docs/identity/GOOGLE-FULL-NAME-REVIEW.md`: original review, now clearly marked historical/applied and linked here.
- This review file, `docs/identity/GOOGLE-FULL-NAME-FINAL-REVIEW.md`.

No runtime/application, chat UI, authentication client, Worker source, PWA source, deployment configuration or database protection differs from main beyond archiving the already applied migration source.

## Identity and production compatibility

New Google profiles initialize their display name from protected Google identity data, sanitized to the existing 2–40 character rule. Email/markup/local-part values and unusable names retain FreeUpper User. The username and auxiliary mirror remain lower(existing database-generated freeupper_id). Email signup defaults remain unchanged. Only a new Auth-user INSERT queues initialization; repeat logins, refresh, provider updates and identity linking cannot reset existing names. Existing customization and completion flags remain protected; IDs and usernames are never regenerated.

Fresh read-only Supabase checks against `jmjtqidirpmnegzvmiaq` confirm:

- History has **80 entries**, including `20261112174353_google_signup_display_name`.
- The Google-name trigger is enabled, DEFERRABLE and INITIALLY DEFERRED on Auth-user INSERT.
- The installed function body matches the reviewed source; profiles RLS is enabled.
- anon/authenticated cannot use identity_private or execute the initializer.
- SHA-256 recomputed inside production from the recorded migration source equals the local approved SQL hash:

`8917fa8a41f3ff30ddb06f155e6520186e2f98779f42d0cbb573cb1fe16e59bd`

No Auth records, sessions, private OAuth data or existing profile values were fetched or changed in these compatibility checks. The earlier completed production verification remains evidence of preservation of all 72 then-existing identities. No fresh identity-count claim or new end-to-end Google full-name canary is made here.

## Validation

- Focused Google-name/default identity/Auth/routing/chat/browser acceptance: **34 passed, 0 failed, 0 skipped**. Current-main chat fixtures required no edits.
- Complete regression: **525 tests: 524 passed, 0 failed, 1 optional WebKit skip**, 292.2 seconds.
- Web build, web Worker dry-run and API Worker dry-run packaging: passed.
- Current chat syntax/byte identity and unchanged deployment/runtime scope: passed.
- Installed migration/source SHA-256 match: passed.
- The full regression exercises PWA offline navigation, account/draft boundaries, service-worker cache exclusions, profile navigation/cache/privacy, posts/search, chat identity/UUID relationships and existing user preservation.
- Google signup/login preservation is tested with isolated Auth/identity-row and browser adapters, not a new production Google account. The accepted live canary was not repeated.

Evidence: `/workspace/freeupper-validation/google-final-dddd800/` (focused/regression/packaging logs, production hash evidence, GitHub job metadata, and current deployment versions).

## Current publication state and operational risk

[Latest-main GitHub workflow 43456054383](https://github.com/seyistarr/Freeupperr/actions/runs/43456054383) completed successfully, including `worker` and `deploy-production`. Its web deployment log records version `653182dc-7c54-4ca3-82d7-630757b8d36f`, which matches the active production web version. Therefore the latest main chat commits are already web-published; this release must retain that exact working source.

Read-only Cloudflare metadata:

| Worker | Active version | Created UTC |
| --- | --- | --- |
| freeupper-web | `653182dc-7c54-4ca3-82d7-630757b8d36f` | 2026-11-13 15:53 |
| freeupper-api | `534046bf-afdc-4289-9986-fe67288bf930` | 2026-11-13 12:13 |

**Outstanding operational risk:** latest observed independent API build `51b33a3b-befc-4f6c-a32e-005381c55709` (commit `a577b2e`) passed all 11 API tests, then failed its version-upload request with Cloudflare code **10013**, “An unknown error has occurred.” This was not an API test failure. The currently serving API version remains active; API source/config/dependencies have no changes in this candidate. A local dry-run cannot prove that hosted upload error is resolved. No production retry, token/setting change, Wrangler upgrade or manual deploy was attempted. The provider-side upload risk must be resolved or explicitly accepted in the publishing approval, with a stop/recovery boundary if it recurs. Do not treat local packaging success as proof that both hosted publishers will succeed.

Live build triggers remain main/all-paths:

- Cloudflare web: `npm run build:cloudflare`; deploy command only logs that GitHub Actions owns production publishing.
- GitHub: `worker` on supported Ubuntu 24.04 runs tests/packaging and WebKit gates, then production `deploy-production` publishes web with `--keep-vars`. The existing `freeupper-web-production` concurrency gate is unchanged.
- API: independent `npm run test:api` then `npm run deploy:api`. It can finish/fail before the GitHub web job. No automatic SQL migration exists in either pipeline.

The currently observed builds are stopped, not running. Capture queues/versions again at publication. Optional local WebKit coverage and candidate remote CI remain separate from the passing latest-main hosted WebKit gate. No new security/dependency remediation is bundled into this release.

## Exact publication procedure — requires a new tip approval

1. Review the final integrated tip and known Cloudflare API upload risk. Obtain explicit approval for the exact SHA and both automatic production deployment effects. No previous tip approval applies.
2. Fetch main immediately before publication. Require `dddd80073914cb6b16f87d50e67cf4b82d911fca`; otherwise stop and reconcile again. Require clean reviewed tip, `git merge-base --is-ancestor origin/main <approved-tip>`, unchanged chat blob IDs and the approved migration source hash.
3. Recapture GitHub/Cloudflare queues and active rollback versions. Retain current working chat web version. Use the verified installed-migration evidence; do not apply SQL, run db push, replay migration history or invoke Stage 2. Any further DB check is read-only and scoped to separate release authorization.
4. Publish the approved SHA as a single non-force fast-forward update: `git push origin <approved-tip>:refs/heads/main`. Do not push the old ab2ffa1 or bce6c83 tips, intermediate commits, or invoke an independent manual deployment.
5. Monitor the independent API build/test/upload and GitHub worker → production web deployment. Require both production versions to correspond to the approved revision. Stop further retries/actions and report any mandatory failure, including recurrence of Cloudflare 10013. Publishing approval should explicitly cover cancelling pending release jobs and restoring captured versions on a mandatory failure. If API upload fails while web is still pending, use that approved recovery scope to cancel the pending web release before activation; if web already activated, restore its captured working-chat version as authorized. Do not retry an API upload or alter settings as an unreviewed workaround.
6. Read-only verify deployed web/API health, Google/email Auth settings/routes, username/FUID/UUID routing, email-handle rejection, profile/post/search availability, current chat asset hashes, safe navigation, PWA service-worker/cache refresh and privacy exclusions. No new Auth identities, login canary, profile customization or existing-user update.
7. Record results and stop. Stage 2 remains a separate operation; its old migration-history baseline must be refreshed before any separately approved correction.

## Rollback

Before activation, leave the existing working production version serving. After activation, coordinate any in-flight GitHub/Cloudflare queues, then use only explicitly authorized recovery to restore the web version captured immediately before release and, independently if necessary, the captured API version. Current preparation versions are listed above. Recheck health and chat afterward. Do not force-push or invent an unreviewed recovery commit that restarts publishers.

Retain the already installed Google-name trigger and Stage 1 privacy protections. Web/API recovery does not undo Supabase DDL. The reference database rollback SHA-256 remains `3ef068c03c58fb4aa46fe9ffe57b5669f8ad4d5f0b2f4d527e74ce8d45bf2324`; executing it requires separate database authorization and preserves all already-created/custom names and permanent IDs.
