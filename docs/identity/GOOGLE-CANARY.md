# Stage 1 Google OAuth canary

> Completed: [GOOGLE-CANARY-PASSED.md](GOOGLE-CANARY-PASSED.md). The steps and pending status below are retained as historical preparation evidence; do not repeat the canary.

2026-11-12 UTC. **Canary authorized; awaiting owner signup.** The owner explicitly authorized account label freeupper-google-canary-01 for one fresh Google identity/profile, signup/logout/repeat-login sessions and canary-only customization. No signup or login has been initiated by the agent. No deployment or Stage 2 operation is authorized.

## Current checks

Production migration 20261109051236 is present with the expected embedded source MD5 6ba41b861f0c3c6054d12ee0cfefe7e2. All 71 existing identity fingerprints match the post-migration evidence. Profile RLS is enabled, all five policies are unchanged, identity functions match, relevant triggers are enabled, and there are zero invalid IDs or username conflicts. Anon/authenticated have no private-schema access.

The deployed https://freeupper.com/auth.js was read without starting OAuth: it still contains Continue with Google, provider google and redirectTo window.location.href. The first default-user-agent request received 403; retry with the prior successful verification user-agent returned 200. This is not an OAuth result. No credentials or provider settings were changed.

## Required authorization

The authorization above is sufficient; do not request it again for the same scoped canary. The owner selects the dedicated fresh Google account personally and does not share credentials.

The label alone does not identify a canonical Auth email. Instead of requesting that private email, an email-free pre-signup inventory of all 71 Auth UUIDs was captured. After the owner reports the public FUID, require its canonical Auth UUID to be absent from that inventory and created within the canary window, with the Google identity bound to it. If it is an existing identity or linking is unexpected, stop; never delete or unlink it to manufacture signup.

Authorization-time read-only checks passed: migration present, 71 profiles and 71 Auth UUIDs, all prior identity fingerprints unchanged, RLS enabled and policies unchanged. Evidence: /workspace/freeupper-validation/identity-privacy/google-canary-01-before.json. It contains no email values.

## Exact owner instructions — perform only after approval

1. Open a private/incognito browser window and navigate directly to https://freeupper.com/ with no query string or fragment.
2. Open FreeUpper's existing sign-in/signup dialog and choose **Continue with Google**.
3. On Google's own page, personally select the authorized test account. Complete any password, consent, verification and MFA steps yourself. Do not share codes, credentials, callback URLs, cookies or browser storage.
4. Allow the normal return to FreeUpper. If Google, Supabase or FreeUpper displays an error, stop and report only its non-sensitive message. Do not bypass warnings or substitute another account.
5. Before editing or completing onboarding, record the public FreeUpper ID and visible default display name/handle. Report the public ID and pass/fail observations; avoid screenshots containing email or callback parameters.
6. Wait for the read-only database checks below. Then use FreeUpper's own **Sign out**, return to the homepage, and choose **Continue with Google** with the same account. Again complete any required verification personally.
7. After identity stability is verified, use the existing Edit Profile flow to choose an available non-email canary username and display name. Do not post, message, follow users or upload media. If another repeat login is needed to verify customization persists, keep it within the approved canary session scope.

## Verification checklist

Before signup, retain current email-free fingerprints and the absence of the privately identified test identity. After each owner checkpoint, perform read-only scoped checks:

* Exactly one new canonical Auth UUID, with Google identity bound to that UUID and profiles.id equal to it; no unintended provider linking.
* One unique existing-generator FUID matching FU plus twelve uppercase hexadecimal characters. No second ID or frontend suffix.
* Before customization: display_name FreeUpper User; username and display_username equal lower(freeupper_id).
* No public identity field or public profile response exposes the test account's verified email; check rendered profile/handle, safe FUID links and resolver/API behavior without exporting the email. Email-based handle lookup returns no account.
* Default generation leaves onboarding_completed false and profile_setup_completed_at NULL. Do not complete onboarding merely to make the defaults visible.
* On repeat login: same Auth UUID, FUID, creation timestamp and initial names; profile count does not increase again.
* Customization succeeds under existing account rules, and the selected non-email names remain after repeat login. Capture the default assertions before customizing.
* All pre-existing 71 identity fingerprints remain unchanged. Policies, RLS flags, function definitions/grants and private-schema denials remain unchanged.
* Confirm the temporary/incomplete account retains the existing indexing/discoverability protections through relevant SEO/search surfaces.

Store only pass/fail, public FUID, UUID where operationally needed, counts and private fingerprints. Do not record private email values, OAuth codes, tokens or session material. Do not delete/recreate the test account afterward without separate approval.

## Decision

The canary result is **PENDING OWNER SIGNUP**, not a pass or failure. Database readiness passed and scoped write approval is recorded. The owner must complete the normal Google flow before result verification can proceed.

Frontend release is not ready for final execution approval until the real signup, repeat login, privacy and customization checks pass. Then reconcile the local identity changes with latest main, present exact publishing commit(s), and obtain separate approval for the coordinated GitHub web/Cloudflare API sequence. Stop on canary failure; no deployment, existing-user reset or Stage 2 execution.
