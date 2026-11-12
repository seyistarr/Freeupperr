# Google canary initial signup verification

> Final status: [Google canary passed](GOOGLE-CANARY-PASSED.md). The onboarding hold was resolved and the owner confirmed customized identity preservation after final repeat login.

## Hold resolved by owner clarification

The owner confirmed selecting interests after signup without editing the profile. Read-only source review confirms onboarding.js calls index-feed.js saveOnboardingInterests on submission, which updates interests and onboarding_completed=true. It does not write profile_setup_completed_at; that separate field is set by explicit profile-editor save. The observed true/NULL state is expected. The initial hold below is historical and is cleared; the already authorized repeat-login check may proceed.

A fresh read-only canary check still shows the same UUID, FUID, default names and creation timestamp, with interest onboarding true and profile setup NULL. No profile reset or other write was made to resolve the hold. After the owner signs out and returns through Google, verify the database checkpoint before allowing customization.

Read-only verification of owner-reported signup, 2026-11-12. No test-profile modifications, subsequent login, deployment or Stage 2 operation was performed by the agent.

| Check | Result |
| --- | --- |
| Auth/profile UUID | d435ae41-f744-4dfe-af39-71b8c90d2a46, matching |
| FreeUpper ID | FU5BDE68F20877, unique and valid |
| Username / display_username | fu5bde68f20877 |
| Display name | FreeUpper User |
| New identity | UUID absent from pre-canary Auth inventory; created after baseline |
| Google linkage | One Google identity, zero other identities; email verified |
| Public identity fields contain canonical email | False |
| Email-based handle resolution | Zero rows |
| Safe current handle resolves to same UUID | True |
| Existing identity fingerprints | All 71 unchanged |
| Current Auth/profile totals | 72 / 72, exactly one new each |
| RLS / policies | Enabled / unchanged |
| Private schema access for public roles | Denied |

**Hold before repeat login/customization:** onboarding_completed is true while profile_setup_completed_at is NULL. The canary checklist expected incomplete onboarding before owner action. The production insert trigger still explicitly sets onboarding_completed false and profile_setup_completed_at NULL. Existing index-feed.js contains a separate explicit interest-onboarding completion update that sets onboarding_completed true; current evidence does not establish whether the owner completed that flow. Do not assume that the default-generation trigger marked the profile complete.

The SEO eligibility RPC returns false for this FUID, so the incomplete profile remains ineligible for public SEO indexing despite the interest-onboarding flag. No conclusion about other search surfaces is claimed by that check.

Ask whether the owner submitted/skipped an interests/welcome onboarding step after Google signup. If this explains the state, document that action and resume the already authorized repeat-login test; if not, investigate read-only and stop before further canary writes. Do not reset the flag to manufacture a pass.

After the hold is resolved, the owner should use FreeUpper Sign out, return to https://freeupper.com/, and Continue with Google with the same authorized account. Report the visible FUID/username/display name before editing. Read-only verification must confirm the same UUID, FUID, creation timestamp and names with no second identity/profile. Only after that checkpoint should the owner use Edit Profile to set an available non-email canary username and display name, report those public values, and repeat login to confirm persistence.

Raw email-free verification evidence is /workspace/freeupper-validation/identity-privacy/google-canary-01-signup.json. No canonical email, credential, token or session content was returned. Owner observed no Gmail address in the profile header; broader public-response privacy checks remain part of the canary completion checklist.
