# Email authentication repair — Phase 2 review

> Historical Phase 2 report. See [the 2026-11-16 PR readiness review](PR-READINESS-REVIEW.md)
> for the subsequent security fixes, timeout investigation, final checks and manual configuration checklist.

Review date: 2026-11-15. Local feature branch: `fix/email-auth-confirmation-recovery`.
Baseline: GitHub main `b943598eeb6cac1a6ab06b3235254f0c38581be1`. A final read-only fetch confirmed main has not advanced.

## Production access and remaining blockers

Read-only checks confirmed production project `jmjtqidirpmnegzvmiaq` is ACTIVE_HEALTHY.
`GET https://api.freeupper.com/auth/v1/settings` confirms email and Google providers are enabled,
signup is enabled, and `mailer_autoconfirm` is false (confirmation required).

Private configuration could not be verified: the connected Supabase tool catalog exposes no
Auth configuration read endpoint; `get_project` returns infrastructure metadata only. There is
no Supabase management credential in this environment. No private credentials, password hashes,
confirmation tokens, or user accounts were retrieved. No configuration values were changed.

Before release, an authorized administrator must inspect the following (redacted settings only):

- SMTP provider enabled, sender verified, delivery/bounce diagnostics, and recipient restrictions.
- Site URL and redirect allowlist. The new frontend requests its own origin `/` for signup/resend
  and `/reset-password.html` for recovery. Both `https://freeupper.com` and
  `https://www.freeupper.com` forms need compatible configuration or a deliberate canonical-host policy.
- Confirmation and recovery templates must support the existing Supabase browser implicit flow.
  No custom `/auth/confirm` token-hash endpoint or PKCE migration is introduced here.
- Password policy, CAPTCHA requirements, send-email/password-verification hooks and their failures.
- Actual email/request rate limits and retry intervals. The frontend respects SDK-exposed retry
  seconds when supplied, otherwise applies a 60-second email cooldown. The server remains authoritative.

These are release verification blockers, not confirmed misconfigurations. No production emails
were sent, no real-user authentication attempted, and no hosted test resources were created.

## Changed behavior and files

| File | Change |
| --- | --- |
| `auth.js` | Explicit pending-confirmation state, resend and recovery requests, cooldowns, safe messages, pending-action restoration, profile-load retry, auth-state race guards and SDK callback deferral. |
| `reset-password.html` | Loads the dedicated recovery controller, initially disables password fields, provides persistent status and a new-link entry point. |
| `reset-password.js` | Recovery initialization without a fixed delay; valid recovery context required, account rechecked before update, retryable errors, local-scope signout. |
| `index-feed.js` | Onboarding completes only after a successful update returning the expected profile row; rejects RLS errors and zero-row updates. |
| `onboarding.js` | Failed saves keep the overlay open and re-enable retry; concurrent saves are guarded. |
| `service-worker.js` | New cache generation so installed clients replace cached authentication and onboarding assets. |
| `package.json` | Adds `npm run test:auth`. No dependency versions or lockfile changes. |
| `tests/email-auth.test.js`, `tests/helpers/email-auth-fixture.js` | Browser and VM regression fixtures; all external browser requests are blocked. |
| Existing identity/API/Gallery/PWA sound tests | Adjust expected signup redirect arguments, follow extracted recovery script, update the cache-generation assertions, and allow the explicitly authorized auth.js change while retaining unrelated fingerprints. |

Profiles are read from the existing server-created row. Profile-load failures never create a new
Auth account or write a replacement profile. UUIDs, FreeUpper IDs, usernames, metadata, content,
Google provider and Google redirect behavior are preserved. No identity-linking API is called.
The current Supabase storage key is unchanged. OTD Auth, database schema, migrations, API gateway
routing and production configuration are unchanged.

## Validation

The final focused authentication suite passed **55/55**, with no failures or skips
(`npm run test:auth`). This includes 27 new authentication/onboarding regressions and existing
email/Google identity, collision, RLS and API gateway checks. The cache and PWA interaction
regressions passed **6/6**, with no skips.

The first broad repository run completed 581 tests: 566 passed, 12 were intentionally skipped,
and three assertions failed because they still expected client profile upserts or the previous
cache generation. Those assertions were corrected and passed targeted reruns. Complete reruns of the final branch encountered an existing, unchanged browser geometry fixture's
120-second limit (first with process parallelism, then with the repository's sequential runner).
The timed-out runs were stopped and their local test processes cleaned up. That same geometry
fixture passed the first complete run in 75.5 seconds and its application files are unchanged.
No unrelated timeout threshold or layout code was changed to conceal this result.

**Historical validation limitation at `0c8d5ee`:** there was no clean final all-repository run.
This was subsequently resolved; see the linked PR readiness review for the clean mandatory results. The completed broad run
and green final focused reruns are the available evidence. Rerun the full command below in CI
or a dedicated environment before merging. The 55 final auth checks and six PWA/cache checks
have no failures or skips; all three obsolete assertions from the completed broad run are
covered by those successful reruns.

Other checks passed:

- `node --check auth.js`, `reset-password.js`, `index-feed.js`, and `onboarding.js`.
- `git diff --check`.
- `npm run build:cloudflare`: includes the extracted recovery controller in the static asset package.
- Project-local Wrangler `deploy --dry-run --outdir .wrangler/test-build`: local compilation and
  packaging succeeded, explicitly exited without upload or deployment.
- Generated `auth.js` and `reset-password.js` match the final working source.

Reproduction commands (local fixtures only):

```sh
npm ci --ignore-scripts --cache /tmp/freeupper-npm-cache
npm run test:auth
node --test --test-isolation=none --test-concurrency=1 tests/gallery-main-preservation.test.js tests/ui-sounds-interactions-browser.test.js
npm run build:cloudflare
WRANGLER_SEND_METRICS=false npx --no-install wrangler deploy --dry-run --outdir .wrangler/test-build
FREEUPPER_TEST_BUNDLE=.wrangler/test-build FREEUPPER_CHROMIUM=/usr/bin/chromium node --test --test-isolation=none --test-concurrency=1 tests/*.test.js tests/*.test.cjs
```

The `/usr/bin/chromium` executable is environment-specific. The test browser fixture intercepts
all non-local requests. Database regressions use isolated PGlite instances. No production
credentials or hosted projects are required. Optional external-server/offline-matrix checks
are reported as skipped rather than represented as passed.

New coverage includes confirmation-required and immediate-session signup, confirmation callback,
resend/cooldown/429, password login/errors, exactly-once pending action, profile failure/retry,
stale profile responses after logout, initial guest session behavior, logged-out recovery request, invalid/expired recovery,
recovery initialization race, Google redirect/error, account changes during recovery, password
update errors, and onboarding save errors/zero affected rows/UI retry.

## Deployment risks and acceptance

- Obtain a clean full-suite CI run and verify the private Auth settings above before deploying. Frontend fixes cannot repair
  an SMTP outage, disallowed redirect, incompatible email template, or required CAPTCHA by themselves.
- Signup/resend supplies a redirect explicitly. An unallowlisted redirect may fall back to Site URL;
  mock tests cannot establish delivery or production callback correctness.
- Google uses the same provider and current-page redirect as main; test consent/cancel/return with
  an approved staging identity before release. Do not re-register Google users to add passwords.
- Missing profiles now produce an explicit retry state rather than client-side profile upsert.
  Persistent missing rows require a separately approved backend investigation, never replacement accounts.
- Recovery requires an SDK PASSWORD_RECOVERY event or a short-lived same-tab marker from such an event.
  Legacy or custom templates need acceptance testing. Recovery success requests local signout only;
  Supabase's own password-change session policy remains authoritative.
- Old installed clients require the new service worker generation. Verify online and installed-PWA
  transitions; no API/session response caching is introduced.
- Protected action callbacks remain in memory only. They can resume once in the current page;
  arbitrary callbacks are not serialized across OAuth redirects, refreshes, or email tabs.

Staging acceptance must cover signup → inbox → verification → unchanged identity/profile → reload,
login and token refresh, linked and Google-only users, recovery → password update → subsequent login,
profile-network failure/retry, onboarding persistence, both hostnames, and installed-PWA upgrade.
Use approved isolated accounts and infrastructure. Production accounts must not be recreated,
automatically linked, mass-confirmed, or reset as part of this change.

This initial phase did not authorize remote publication. The subsequent user request authorizes
pushing the feature branch and opening a PR only after mandatory checks pass. Merge, deployment,
production Supabase mutation and real-user authentication remain prohibited.

## References

- [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords)
- [Resend confirmation](https://supabase.com/docs/reference/javascript/auth-resend)
- [Password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Wrangler local dry run](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
