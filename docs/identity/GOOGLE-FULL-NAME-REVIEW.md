# Google full name initialization — original preparation review

**Current status (2026-11-14):** This migration is already installed and verified in production. Do not execute its SQL again. The execution instructions below are historical preparation evidence. See [the latest integration and publishing review](GOOGLE-FULL-NAME-FINAL-REVIEW.md).

Prepared from production main `2f0363f485c8b9936bc532a2b23a256923d4447c` on branch `codex/google-full-name`. Local preparation only: no push, deployment, production DDL/data writes, Stage 2 execution, additional test accounts or repeat live canary.

## Result

New Google OAuth registrations use the provider's full name as `profiles.display_name` when usable. The username and auxiliary username remain `lower(freeupper_id)`, using the unchanged database generator. Email registrations retain `FreeUpper User`.

All existing profiles, including existing Google users whose display name is still `FreeUpper User`, are excluded. No attempt is made to infer prior customization. Repeat login, refresh, identity linking and provider metadata changes cannot invoke the new initializer.

The existing profile, settings, feed, search and chat UI reads profile identity fields; no visual, routing, JavaScript, Worker, PWA cache or deployment configuration change is required.

## Changed files

- `supabase/migrations/20261112174353_google_signup_display_name.sql`: one private trigger function and one deferred Auth-user INSERT trigger.
- `tests/google-display-name.test.js`: nine database tests covering initialization order, fallback/sanitization, email signup, repeat-login/linking behavior, customization preservation, uniqueness, access boundaries and rollback.
- `docs/identity/google-display-name-rollback.sql`: tested removal of the new trigger/function, preserving all existing profile values.
- This review document.

## Trust and transaction timing

Supabase Auth's Google flow creates the Auth user and profile before its Google identity in the same transaction. Reading `auth.identities` from the existing immediate profile INSERT trigger would miss the new identity. A deferred constraint trigger on `auth.users` INSERT reads the provider identity at transaction end, after it exists and before signup commits.

Only users initially created with server-managed `raw_app_meta_data.provider = google` qualify, and a protected Google `auth.identities.identity_data` row must exist. Browser-editable `raw_user_meta_data` is never used for the name. Source is `full_name`, with `name` as fallback when the former is absent/blank/non-string. No token, secret or provider email is copied to public data.

Whitespace is normalized; control characters, invisible separators and bidi overrides are removed. Names must be 2–40 PostgreSQL characters, matching the current validator. Email-like values (any `@`), markup delimiters and values equal to either the Auth or provider email local part are rejected. Oversized/unusable names keep `FreeUpper User`; no email-based fallback or truncation occurs.

The UPDATE guard requires the untouched default display name, canonical generated username, auxiliary mirror and NULL profile completion timestamp. Any in-transaction customization is preserved. The existing update validator remains enabled; no uniqueness, permanent-ID, onboarding, completion, RLS or authorization logic changes. The function is SECURITY DEFINER only to read protected provider data and update this same newly inserted user's profile, has an empty search path, fully qualified tables and revoked PUBLIC/anon/authenticated execution. It accepts no public arguments and is in the already private schema.

## Read-only production compatibility

Production has the Stage 1 migration and expected immediate Auth/profile triggers; the proposed trigger is absent. Required Auth columns and types match. The intended migration role (`postgres`) has the necessary Auth trigger, identity SELECT, profile UPDATE and private-schema CREATE privileges. Both browser roles lack INSERT/UPDATE access to Auth users and identities. No production user/provider payloads or private emails were fetched for this work.

Official Supabase identity documentation and current Auth implementation were checked:

- https://supabase.com/docs/guides/auth/identities
- https://github.com/supabase/auth/blob/master/internal/api/external.go (`CreateAccount` inserts user then provider identity; existing-account path updates metadata)
- https://github.com/supabase/auth/blob/master/internal/api/signup.go (`ToUserModel` sets the initial provider)
- https://github.com/supabase/auth/blob/master/internal/api/user.go (user metadata update path)

The changelog was reviewed, including the CLI v3 change. CLI 3.1.0 generated the migration filename; no hosted CLI apply/push was run. The actual hosted Auth build is not pinned by this source inspection. The deferred trigger's expected order is covered in isolated tests; no new end-to-end Google authorization was performed.

## Validation

- Focused: **17 passed, 0 failed, 0 skipped**, including nine new database tests and existing browser/Auth/default-identity tests.
- Ten official Supabase security lint queries on the isolated PGlite fixture: **zero new findings**; before/after application RLS policies identical. These are local checks, not a claim that hosted advisers ran against an installed production change.
- Full regression: **525 tests: 524 passed, 0 failed, 1 optional WebKit skip**, 300.0 seconds. Includes profile rendering, search/routing, chat, posts, privacy, relationships and PWA coverage.
- Final nine-test database recheck: **9 passed**, including signup under a restricted synthetic Auth-backend role; its deferred trigger can read provider data and initialize the profile without giving that role public API access to the function.
- Web build and both web/API Worker dry-run packages: passed. These are local packages; no Worker was published.
- `git diff --check`: passed.
- The completed production Google canary was not repeated. Login preservation tests simulate Auth/provider row updates in an isolated database and do not claim to be live Google login tests.

An initial sandbox run could not open browser/network sockets or spawn the build's git subprocess. A server started from the incomplete build was stopped; incomplete test runs are not accepted evidence. The final run uses the successfully built local Worker and Chromium outside that restricted sandbox.

Evidence: `/workspace/freeupper-validation/google-full-name/` (`focused-final.log`, `regression-final.log`, `security-results.json`, `database-final.log`, `packaging-results.json`). The existing Stage 2 artifacts remain separate and unchanged.

## SQL artifacts

Migration SHA-256:

`8917fa8a41f3ff30ddb06f155e6520186e2f98779f42d0cbb573cb1fe16e59bd`

Rollback SHA-256:

`3ef068c03c58fb4aa46fe9ffe57b5669f8ad4d5f0b2f4d527e74ce8d45bf2324`

## Approval and execution sequence

1. Review the exact local release commit and migration above. Explicit production migration and publication approval are still required.
2. Immediately before release, fetch main again, compare the baseline and SQL hash, confirm Stage 1 function/trigger definitions and required Auth schema/grants remain compatible, and confirm the new trigger/migration version is absent. Stop on drift.
3. Retain a private aggregate/opaque fingerprint baseline for existing profile identities and permanent IDs. Use a quiet release window and a short session lock timeout. A new trigger on Auth users needs a brief DDL lock and can temporarily wait behind ongoing signup transactions.
4. Apply only this reviewed SQL transaction through the established controlled migration procedure; record version `20261112174353` exactly once in migration history using the approved runner. Do not use blanket `supabase db push`, replay historical migrations or execute Stage 2. The transaction creates objects only; it performs no backfill and affects zero existing profile identities.
5. Verify trigger `tgdeferrable/tginitdeferred` are true, function execution is denied to public browser roles, Stage 1 triggers/constraints/RLS and existing identity fingerprints are unchanged, and normal application health remains good. Google/email signup must retain normal Auth completion. Stop on unexpected behavior.
6. The existing UI consumes the new database value automatically; no independent frontend/API deployment is necessary to enable it. Publishing the code to main still invokes the repository's existing GitHub web deployment and independent API build triggers, so obtain publication approval separately and coordinate those queues if/when publishing. Do not change their settings.
7. Observe signup error rates and existing read-only profile/search/post/API health. Future authorized new Google signups should receive the trusted name or safe fallback; email signups should retain the safe default. Any additional live account test requires its own authorization; do not repeat the accepted canary as though it tests this new migration.

If this migration is released before Stage 2, refresh Stage 2's production schema/history baseline and regenerate/review its guarded SQL hash before execution. The prior Stage 2 artifact must not be blindly reused after migration-history drift.

## Rollback

A migration error before commit rolls back the new objects atomically. After commit, execute only the reviewed rollback SQL with separate operational authorization: it removes the deferred trigger and private function. Subsequent new accounts return to Stage 1's `FreeUpper User` default. Already-created Google names and custom names remain intact; no account, identity, username or permanent ID is deleted/reset. Record the rollback in the migration audit trail rather than pretending the application occurred neither in schema history nor production.

Reverting web/API deployments alone cannot undo this database trigger. Stage 2 remains unexecuted and requires separate review/approval.
