# Isolated FreeUpper staging — Stage 1

Prepared on `feature/global-push-notification-settings`. PR #1 stays Draft. No cloud project creation, billing change, deployment, live SQL, or merge is authorized by Stage 1. The steps below that create/configure services or execute SQL require a later approval.

## Deployment safety

`vercel.json` disables Git deployments for this feature branch only. Do not remove that guard or manually redeploy the existing preview yet. Existing previews still contain the old production connections and are unsafe for functional tests.

After deployment approval, keep Preview on its own stable branch hostname. Never attach `www.freeupper.com`, promote a staging artifact, or change Production environment variables. Leave `main` and the current production deployment untouched.

`npm run build` generates `/runtime-config.js` from `VERCEL_ENV`; `NODE_ENV` is ignored. Missing/unknown deployment metadata fails. Preview and local development require `FREEUPPER_ENV=staging` plus every public staging value. Production uses the captured existing public configuration and its existing server-side `SUPABASE_ANON_KEY` for the profile APIs. Setting `FREEUPPER_ENV=staging` on a Production build is an error.

The frontend and both workers load the generated file; it contains only public values and is served without caching. Production artifacts reject preview origins. Staging Firebase values must agree on project/app/sender IDs; known production IDs, API key, VAPID key, public Supabase key and origins are rejected. Legacy anon JWTs must identify the staging project and `anon` role. Opaque publishable keys and Firebase API/VAPID keys cannot be proven to belong to a project offline: verify them through staging-only integration tests before release.

Staging notification destinations are constrained to `APP_ORIGIN`, including worker fallback/click navigation. Sender media URLs outside staging are stripped. Staging HTML public-site links are rewritten at build time; production HTML is preserved. Cloudinary API uploads are blocked in staging because the existing presets write to production. Supabase profile preview/OG APIs also use staging configuration rather than the old hardcoded database.

## New Supabase project — manual, after approval

1. In the Supabase dashboard, select the Free organization and choose New project, named **FreeUpper Staging**. Review the estimate; stop if payment/upgrade is required. Set a new database password in a password manager. A separate project is required; do not restore production data or use a data-copying branch.
2. Record the new 20-character project reference and `https://<ref>.supabase.co` URL. Obtain its public publishable key (or matching legacy anon key). Never put the secret/service-role key into Vercel public variables.
3. Verify the dashboard/project reference before setup. Generate a fresh SQL review file locally:

   `node scripts/prepare-staging-db.mjs --project-ref <staging-ref> --output <private-review-directory>`

   This command writes files only; it does not connect to a database. It rejects the production reference. Do not execute `schema.sql.template` directly.
4. Review the generated SQL and apply it only to a fresh staging project's SQL Editor, after separate approval. It is transactional and refuses an existing FreeUpper schema. It creates no users, passwords, sessions, tokens, messages or media. The two outbound webhook triggers are created **disabled**. The SQL is prepared, not yet execution-validated against a fresh hosted project.
5. Required platform dependencies: managed `auth.users`, roles `anon`/`authenticated`/`service_role`, schemas `extensions` and `vault`, the `supabase_realtime` publication, and Vault's `decrypted_secrets` view. The package prepares `uuid-ossp`, `pgcrypto`, `pg_trgm`, `vector`, and `pg_net` from verified extension names/schemas. Supabase-managed Auth/Storage/Vault schemas are not copied or replaced. Check extension availability/versions in the new project first.
6. Run the read-only `supabase/staging/verify.sql`. Confirm all 57 public tables have RLS, owner policies exist for settings/tokens, signup creates profiles, expected Realtime tables are published, and both push webhook triggers show `D`.
7. Under Authentication → URL Configuration, set Site URL to the stable staging origin. Add that exact origin and redirect paths used by the app, or `<staging-origin>/**` restricted to this single staging hostname. Google login currently redirects to the current page. Include `/reset-password.html` for password recovery. Do not allow production domains or a wildcard across all Vercel projects.
8. Enable Email authentication. Retain email confirmation for the full signup test. The built-in email service is restricted to organization team addresses and two messages/hour. Use two authorized test addresses or an separately approved isolated SMTP provider. Disabling confirmation is acceptable only for a limited staging test and leaves the confirmation flow unverified.
9. Enable the Google provider using a new staging OAuth client, described below. Store the OAuth client secret only in staging Supabase Auth configuration.
10. Create the two accounts using staging signup, with usernames `stage_test_a` and `stage_test_b`. Use your own test mailboxes and unique test passwords. Do not insert `auth.users` yourself. After signup tests, disable new signups in staging while conducting the remaining tests unless a test needs them.
11. Optional synthetic conversation fixtures can be prepared with:

    `node scripts/prepare-staging-fixtures.mjs --project-ref <staging-ref> --user-a <staging-auth-uuid-a> --user-b <staging-auth-uuid-b> --output <private-fixtures.sql>`

    This also writes files only. SQL checks the named staging profiles and disabled outbound triggers. It inserts only default settings, a test conversation and a synthetic message. It creates no Auth users or push tokens. Tokens must come from the two actual staging devices. Inspect the staging target again before executing.

## Database package scope and remaining dependencies

Catalog capture on 2026-10-13 includes 57 tables, 94 application functions, 205 constraints, 197 policies, 21 triggers, one view, 12 sequences (including two identities), indexes, explicit column/table/function/sequence grants, ownership of ordinary sequences, and Realtime publication/replica identity. Sequence current values and production rows were excluded. The two webhook URLs became staging placeholders; staging generation adds a Vault-backed secret header. No private keys, JWTs, passwords, user IDs or production webhook URLs occur in the metadata/template.

The full repository migration history is incomplete, so this package is a catalog-derived staging baseline rather than a claimed production migration rebuild. Fresh-project SQL execution, extension compatibility and authenticated RLS behavior remain unverified until staging exists. Supabase Auth provider settings, SMTP, project-level Data API configuration, grants on managed schemas, Realtime project configuration, external integrations and application reference data are not exported. Empty sounds/interests/market-category/feature-flag tables may need separately reviewed synthetic reference fixtures for unrelated flows; no production reference rows have been copied. The repository also calls `find_similar_posts` from `image-embedding.js`, but that RPC is absent from the inspected database catalog. Its definition must be obtained and reviewed separately for the image similarity/recommendation path; it is not invented in this package and is not required by the notification sender.

No Supabase Storage buckets were present at inspection. Do not create broad Storage policies to compensate. Avatar/chat/create/studio/market uploads currently use Cloudinary; those uploads are blocked in staging. A separate Cloudinary destination requires later review. Image/media workflows are outside this initial notification validation until isolated storage is configured.

Existing application security-definer functions, policies and the view are captured as they exist; this does not certify the entire application's authorization model. Account-isolation tests must use real staging user JWTs, not service-role requests. Verify A cannot read/update B's settings or SELECT/INSERT/UPDATE/DELETE B's token rows. Verify conversation membership and chat mutes still apply.

## New Firebase project and Google OAuth — manual, after approval

1. Create **FreeUpper Staging** in Firebase with a unique project ID. Select Spark; do not link a billing account or enable optional Analytics, Firestore, Storage, Hosting, App Hosting or Cloud Functions.
2. In Project settings → General, register a Web app. Record its Firebase web config. The storage bucket field is a configuration identifier; notification testing does not require creating a bucket.
3. In Project settings → Cloud Messaging, verify Firebase Cloud Messaging API (HTTP v1) is enabled. Confirm FCM Registration API is enabled in the corresponding Google Cloud project; new Firebase projects normally enable it automatically.
4. Generate a **new** Web Push certificate/VAPID pair. Copy only the public key into public configuration; do not import the production pair.
5. Create a dedicated staging sender service account in Google Cloud IAM. Grant `roles/firebasecloudmessaging.admin` on the staging project, or a narrower custom role with `cloudmessaging.messages.create`. Do not grant Owner/Editor and do not reuse the production account.
6. If organization policy allows JSON keys, generate and retain the staging key in private encrypted storage. A policy prohibiting key creation is a blocker for the current sender implementation; do not bypass it or enable billing to work around it. Never commit the key or paste it in chat.
7. In the staging Google Cloud project, configure Google Auth Platform with a testing audience containing only the two tester Google accounts; request only `openid`, email and profile scopes. Create a Web application OAuth client. Authorized JavaScript origin: the stable staging origin. Authorized redirect URI: `https://<staging-ref>.supabase.co/auth/v1/callback`. Enter this client ID/secret in staging Supabase's Google provider. Firebase Authentication is not used for FreeUpper login.

## Vercel Preview — manual, after deployment approval

1. Keep the existing Vercel project/domain bindings unchanged. Enable access to System Environment Variables so Vercel supplies `VERCEL_ENV`, `VERCEL_URL`, and `VERCEL_BRANCH_URL`.
2. Add the variables in `config/staging.env.example` to **Preview only**, scoped to `feature/global-push-notification-settings`. Do not edit Production variables. `APP_ORIGIN` should be the stable HTTPS branch hostname, without path/trailing slash. The build additionally accepts the generated deployment and branch origins from Vercel metadata.
3. Supply every value from the new staging projects. Do not copy production values. `SUPABASE_PUBLISHABLE_KEY` is public; `SUPABASE_SERVICE_ROLE_KEY`, OAuth client secrets and Firebase service-account JSON must never be added here.
4. The repository selects `npm run build`; keep the static site's current routing/output behavior. Do not use `NODE_ENV` to select credentials. Local builds must explicitly set `VERCEL_ENV=development` and the same public staging variables in the invoking shell; the builder does not automatically load an `.env` file.
5. Only after separate approval, remove the feature-branch auto-deployment guard or approve a manual Preview deployment. Do not promote it or use a Production target. Confirm built `runtime-config.js` contains the staging project IDs, and the browser network panel shows only staging Supabase/FCM project traffic.
6. Keep Preview protected. Authenticate both test devices to the preview. Validate protection works in the installed iPhone app and for worker/config requests. Do not publish bypass tokens or disable production protection. Clear any old preview site data that may have come from the earlier unsafe preview before testing.

## Prepared Edge Function and webhook authentication

The original deployed v23 sender has `verify_jwt=false`. Its two database hooks post unsigned JSON with only `Content-Type`. The inspected handler accepts `table` and `record` without verifying caller identity, signature, persisted event identity, or caller ownership, then uses service-role database access and a Firebase service account. A party reaching this public endpoint can forge event payloads, potentially spoof notifications to known recipient/conversation IDs and consume resources. Global opt-out/mute checks reduce delivery but do not authenticate the event. CORS is not authentication. Enabling JWT verification alone would break the current unsigned database hooks.

Production remains unchanged; the prepared production code preserves this model. Treat hardening it as a separate release/security decision. Prefer authenticated database-to-function calls, a rotated webhook secret or signed requests, validation against persisted records, request limits, and minimal log retention. Do not put service-role credentials in webhook source or public clients.

The prepared staging path requires `STAGING_WEBHOOK_SECRET` and the `x-freeupper-staging-secret` header. An unauthenticated request receives 401 before event handling. The production path does not add this requirement. `verify_jwt=false` is retained in the prepared configuration; staging has its own explicit application-level gate.

For a later approved staging function deployment, required values are:

| Location | Values |
| --- | --- |
| Supabase-provided runtime | Staging `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Staging Edge secrets | `APP_ENV=staging`, `APP_ORIGIN=<stable-staging-origin>`, `FIREBASE_PROJECT_ID=<staging-id>`, `FIREBASE_SERVICE_ACCOUNT_JSON=<private-staging-JSON>`, `STAGING_WEBHOOK_SECRET=<random value of at least 32 characters>` |
| Staging Vault | Secret named `freeupper_staging_webhook_secret`, with exactly the same webhook secret |

Create the random secret privately, retain it encrypted, and set it using the secure dashboards/approved secret tooling. Do not paste it into migration SQL, shell arguments/history, GitHub or chat. Vault values are not included in this package.

After a separately approved staging deployment, verify missing/wrong secret returns 401; inspect both trigger function definitions for the correct staging URL and Vault header; confirm both triggers remain disabled; verify the sender's service account `project_id` agrees with staging Firebase; send one authenticated synthetic event to a test account. Only after those checks and activation approval should both webhook triggers be enabled in staging. Never enable them in production as part of staging setup. Never point staging at the production sender as a shortcut.

## Validation and release gates

Run `npm test` locally. Automated tests cover exact production configuration fingerprint, sender scope reconstruction, missing/production/mismatched Preview values, secret exclusion, staging worker navigation/media, shared Firebase setup, webhook authentication, SQL object inventories, owner policies, disabled triggers, and fixture guards, alongside the existing global push/sign-out/mute regressions. Tests use synthetic data and mocked SDK/network dependencies; they do not send notifications or execute SQL.

Later, test account A on desktop and installed iPhone; test B in a separate desktop profile. Verify signup/email/Google login, logout and returned/thrown logout failures, prompt dismissal/reload/denial, iPhone installation guidance, A's account-wide Off on both devices and pre-existing tokens, B's independent setting, re-enable only with device permission, JSONB key preservation, chat mute, foreground/background delivery, badge counts and encoded links that stay on staging. Repeat A sign-out/sign-in and account switching; inspect only synthetic staging records.

Release blockers: no staging projects/credentials yet; schema not applied to a fresh project; opaque key binding not verified; OAuth/email/protected-PWA setup untested; native permission/iPhone/FCM tests pending; media storage remains isolated by disabling uploads; current production sender ignores global opt-out until its separately approved update is deployed. Best-effort token cleanup can still leave a logged-out device eligible for pushes while its account is enabled; already accepted FCM messages cannot be recalled.

## Cost and approval checkpoints

The inspected Supabase organization is Free. Current Free pricing includes two active projects, 500 MB database, 1 GB Storage and 500,000 monthly Edge invocations; projects can pause after inactivity. Confirm eligibility/estimate at creation, and do not upgrade or select paid branching. Firebase FCM is no-cost on Spark; do not link Blaze billing. Existing Vercel build quotas/protection capabilities and Google project/key-creation quotas still apply. SMTP or separate media hosting may have costs and require approval.

Sources reviewed: [Supabase pricing](https://supabase.com/pricing), [SMTP limits](https://supabase.com/docs/guides/auth/auth-smtp), [Google OAuth setup](https://supabase.com/docs/guides/auth/social-login/auth-google), [Firebase pricing](https://firebase.google.com/pricing), [FCM web setup](https://firebase.google.com/docs/cloud-messaging/web/get-started), [FCM IAM roles](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging), [Vercel environment metadata](https://vercel.com/docs/environment-variables/system-environment-variables), [branch deployment control](https://vercel.com/docs/project-configuration/git-configuration), [Edge authentication](https://supabase.com/docs/guides/functions/auth).
