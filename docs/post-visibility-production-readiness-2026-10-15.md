# FreeUpper privacy release candidate audit — 2026-10-15

Status: **BLOCKED — do not merge review branch to main or deploy post visibility selectors.**

## Scope reviewed
Compared main against post-visibility-privacy-review (95 commits ahead, 32 changed files). Inspected create.html, studio.html, posts.js, search.js, api/post-media.js, docs/post-visibility-rls-migration-draft.sql, docs/post-media-registry-migration-draft.sql and release gates.

## Immediate blockers
1. **Malformed registry SQL**: docs/post-media-registry-migration-draft.sql has an incomplete format CHECK, duplicate DDL after COMMIT and mismatched parentheses. Never execute this draft.
2. **Frontend audience selectors ahead of enforcement**: create.html and studio.html offer followers/only_me while the production RLS and Cloudinary access restrictions are not in place. Deploying these screens alone risks misleading users about privacy.
3. **Protected-media endpoint remains intentionally disabled**: api/post-media.js returns 503 even after successful authorization. Do not switch existing uploads to authenticated/private delivery before playback is implemented and tested.
4. **Existing Cloudinary public URLs**: changing row visibility cannot revoke already-public media URLs or cached derivatives.
5. **RLS migration is incomplete**: existing SELECT/ALL policies and privileged RPCs (edit_post, record_share, search_posts) must be inventoried and corrected together. The current draft does not guarantee fail-closed behavior.
6. **Test isolation**: staging DB fixtures were mistakenly created in tagkrhvgcbnybiuyvjxt, reserved for OTD/OCIDE. Do not run further FreeUpper tests there. Clean up only with explicit authorization.
7. **Database integration test unverified**: tests/staging/post-media-db-integration.test.js has not run with a dedicated FreeUpper staging database; GitHub workflow skip without a secret is not a pass.
8. **Full product regression pending**: Home, Video, Profile, Create, Studio, search, sharing, thumbnails, feed caching and unauthorized media access require real environment validation.

## Proposed safe release split
- **Hold**: create.html, studio.html, posts.js and search.js changes that expose audience controls or assume new RLS.
- **Hold**: protected-media API and migration drafts until functional delivery and auth integration pass end-to-end.
- **Optional documentation/test-only PR**: docs and tests can be considered separately after removing stale or malformed drafts and any workflow that might access the OTD/OCIDE staging environment. Even this requires CI and diff review.
- **Do not merge the 95-commit branch wholesale.**

## Release sequence
1. Create dedicated FreeUpper privacy staging database; keep OTD/OCIDE staging separate.
2. Audit real production schema and SECURITY DEFINER functions read-only; draft a tested, reversible migration.
3. Repair SQL drafts; implement secure upload, signed delivery, cache/thumbnail handling, and legacy media migration.
4. Run JWT-authenticated endpoint and real user visibility/revocation tests in FreeUpper staging.
5. Validate complete frontend flows and rollback.
6. Present a minimal reviewed PR for explicit approval before merging to main.

No production SQL, Cloudinary permissions, deployment or main-branch changes are authorized by this document.
