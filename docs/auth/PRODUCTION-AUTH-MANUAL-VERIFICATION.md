# FreeUpper production Auth: safe manual verification

Project: **FreeUpper**, ref `jmjtqidirpmnegzvmiaq` (not Freeupperr Staging).
This checklist is read-only. Record the review date, administrator, redacted findings and pass/blocker
for each item. Do not press Save, change toggles, reveal/copy secrets, send test emails, generate
links, reset accounts, or attempt real-user authentication. Opening an existing configuration
panel is sufficient; close it without saving. If a panel has moved, use the named Authentication
section below rather than selecting another project.

The connected Supabase tools do not expose private Auth configuration. These settings have **not**
been independently verified by the coding agent. They are release gates, not known misconfigurations.
The public settings endpoint confirms email/Google enabled, signup enabled and confirmation required.

## 1. Site URL, redirects and Google

Open [Authentication → URL Configuration](https://supabase.com/dashboard/project/jmjtqidirpmnegzvmiaq/auth/url-configuration).

- Record the Site URL. It must be the intended canonical FreeUpper HTTPS origin, not localhost,
  a staging host, a retired Vercel deployment or the API gateway host.
- Read the existing redirect allowlist. This branch requests the following exact destinations:

  ```text
  https://freeupper.com/
  https://www.freeupper.com/
  https://freeupper.com/reset-password.html
  https://www.freeupper.com/reset-password.html
  ```

- Verify that existing allowlist rules cover those destinations and continue to cover the
  current-page return URLs used by existing Google OAuth. Record mismatches as blockers;
  do not replace existing rules or add broad wildcards during this review.
- Open [Authentication → Sign In / Providers](https://supabase.com/dashboard/project/jmjtqidirpmnegzvmiaq/auth/providers)
  and inspect Google. Record Enabled and credential-present booleans only. Do not reveal the
  client secret. Compare the displayed provider callback URI with the existing authorized redirect
  URI in Google Cloud Console → APIs & Services → Credentials → existing OAuth web client.
  Preserve the existing Supabase callback; do not substitute the password-reset page or change
  Google credentials. Do not run the OAuth consent flow against a real user to check this.

## 2. Email provider and password requirements

In the same Providers page, open **Email** and record:

- Enabled; whether new signups are allowed; whether email confirmation is required.
- Minimum password length, required character rules, compromised-password protection and any
  secure-password-change / reauthentication requirement shown.
- OTP/confirmation expiry and email-change security options.

The branch expects confirmation-required signup and also handles immediate-session signup.
Its recovery form requires at least eight characters; Supabase remains authoritative for stronger
requirements. Record a policy that cannot be satisfied or requires an unsupported nonce/challenge
as a blocker. Do not weaken the policy or disable confirmation to make a test pass.

## 3. SMTP and delivery

Open Authentication → **Email** → **SMTP Settings** (some dashboard versions place SMTP under
Email Templates). Inspect configuration without revealing credentials.

- Record Custom SMTP enabled/configured, sender-domain verification, sender address domain,
  TLS/port compatibility and whether credentials are present. Redact names/addresses as needed;
  never copy the password, API key or full SMTP connection string.
- If Custom SMTP is absent, check the current Supabase default-mail restrictions against intended
  recipients. Default-mail recipient restrictions are a potential blocker; do not assume normal
  public delivery merely because email authentication is enabled.
- In the configured email provider's existing delivery dashboard, inspect aggregate recent
  accepted/delivered/bounced/rejected counts and sender/DNS verification status. Do not open email
  bodies, export recipient lists, click live confirmation links or press Send test email.
- In Supabase Logs Explorer, filter Auth errors for email delivery / SMTP / send-email hook failures
  in the incident window. Share only error codes, redacted categories and counts, not emails,
  IPs, request bodies, credentials or token-bearing URLs.

No emails were sent by the automated tests; successful mock requests do not prove production delivery.

## 4. Confirmation and recovery email templates

Open [Authentication → Email Templates](https://supabase.com/dashboard/project/jmjtqidirpmnegzvmiaq/auth/templates)
and inspect **Confirm signup** and **Reset password**.

- Verify that links use the existing Supabase verification flow, normally `{{ .ConfirmationURL }}`.
  Record template-variable names and destination structure only; never copy a rendered link/token.
- Confirm that reset links result in a Supabase recovery session / `PASSWORD_RECOVERY` event
  at `/reset-password.html`. The branch uses the existing browser implicit flow and SDK URL
  processing. It does not introduce a custom `/auth/confirm` token-hash endpoint or PKCE migration.
- A custom OTP-only or token-hash/PKCE template that requires an unimplemented callback is a blocker.
- Record link expiry and any provider link-rewriting/tracking setting. Inspection of settings is
  allowed; clicking or generating live links is not part of this review.

## 5. CAPTCHA, rate limits and hooks

Open Authentication → **Security and Protection**, **Rate Limits**, and **Hooks**.

- Record whether CAPTCHA is required and the provider, without revealing its secret.
  This branch does not supply a CAPTCHA token. A requirement on signup, resend or recovery is
  a release blocker requiring a separate implementation; do not disable CAPTCHA.
- Record configured email-send, resend/OTP, signup, password-token and refresh rate limits and
  intervals. Compare aggregate 429/error-code counts with expected traffic. Do not test limits
  by sending production requests. The frontend cooldown is a UX control that can be bypassed
  by reloading or calling the API directly; only server limits provide abuse protection.
- Record which hooks are enabled: before-user-created, send-email, password-verification,
  custom-access-token and MFA hooks, where available. Record function identifiers and recent
  success/failure counts only. Do not reveal hook signing secrets or execute the functions.
- Review the enabled hooks' existing source read-only for unintended provider rejection,
  confirmation suppression, identity rewriting, or claims changes. Record concerns for a
  separate approved backend change; do not modify or redeploy hooks during this review.

## 6. Sessions, identities and database boundaries

Open Authentication → **Sessions / Settings** and record refresh rotation, inactivity/timebox,
single-session and password-change/recovery revocation policies shown. Do not change them or
revoke sessions. The frontend retains `sb-jmjtqidirpmnegzvmiaq-auth-token` and requests only local
signout after a password reset; Supabase's own revocation policy remains authoritative.

Do not browse or export individual users' sensitive data. The agent's aggregate read-only check
on 2026-11-16 found 73 Auth users, 73 profiles, zero missing/orphaned profiles, and zero duplicate
profile IDs. Local isolated identity tests check stable UUIDs, FreeUpper IDs, usernames, display
names, content references and repeated Google/email authentication. No migrations, identity-linking
calls, replacement-account logic or production mutations are part of this repair.

A second administrator can repeat aggregate integrity checks without retrieving IDs or secrets.
If inspection identifies a missing profile, existing identity mismatch, or unsupported policy,
record a blocker and investigate separately. Do not recreate accounts, mass-confirm users,
automatically link Google/email identities, or overwrite public identity fields.

## Approval record and later acceptance

For each section, record **verified / blocker / not accessible**, the date and redacted evidence.
An inaccessible item remains unverified. A screenshot or exported page containing a secret must
not be attached to the PR. Do not approve production rollout while a relevant setting remains
unverified or incompatible.

Only after separate approval, use isolated staging accounts to test inbox delivery, verification,
password recovery, Google return/cancel, session refresh, both production-shaped hostnames and PWA
upgrade. Production real-user authentication is excluded from this checklist.
