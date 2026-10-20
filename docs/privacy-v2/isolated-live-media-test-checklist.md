# Privacy V2 — isolated live delivery release gate

Status: **BLOCKED until real isolated credentials and authenticated assets are available.**
This document is a test plan, not evidence that live Cloudinary delivery passed.

## Isolation
- Git branch: `feature/post-privacy-v2-integration`; PR #9 remains draft.
- Supabase staging project: `tagkrhvgcbnybiuyvjxt`, isolated `privacy_test` schema.
- Cloudinary staging cloud: `sxdcqs5x`.
- Do not use production Supabase service keys, production Cloudinary keys, or existing publicly uploaded user assets.
- Staging endpoint remains disabled until an independently reviewed preview deployment is configured.

## Required staging-only configuration
Set only on the dedicated preview branch/environment:
- `FREEUPPER_PROTECTED_MEDIA_DELIVERY=enabled-in-isolated-staging`
- `FREEUPPER_MEDIA_TEST_ENV=isolated-freeupper-staging`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from the **staging** Supabase project.
- `CLOUDINARY_CLOUD_NAME=sxdcqs5x`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` from the **staging** Cloudinary account.
- Never commit any credentials.

**Prerequisite:** verify that the staging Supabase API exposes the intended `privacy_test` schema to the server-side service-role client. A missing exposed schema must fail closed; do not work around it by pointing at production.

## Genuine media fixture
1. Upload a disposable image and video with Cloudinary delivery type `authenticated` in staging.
2. Verify Cloudinary's returned immutable asset ID, public ID, resource type, and format.
3. Create matching synthetic post/media registry rows only in staging, ensuring `owner_id` equals the post author and `status='ready'`.
4. Use a real staging auth user/session; synthetic UUIDs alone are not authentication tokens.

## Required HTTP checks
- GET without Bearer token, invalid/expired token, invalid asset UUID, missing asset, pending asset: denied.
- Owner: allowed for valid nondeleted, nonhidden post.
- Approved follower: allowed on Followers post; pending, blocked and unrelated viewers: denied.
- Mutual follower: allowed on Mutuals post; one-way follower: denied.
- Only Me: owner allowed; all other viewers denied.
- Private-account public post: approved follower allowed, stranger denied.
- Deleted, hidden, suspended author, mismatched asset owner: denied.
- Public Cloudinary `upload` delivery type: denied.
- POST and other unsupported methods: HTTP 405.
- Range request for authenticated video: valid 206 and expected bytes; malformed range denied.
- No caching, no indexing, no leaked signed URLs in API response or logs.

## Cloudinary bypass checks (mandatory)
- Try the direct public delivery URL for each authenticated asset **without** a signature: must fail.
- Try guessed thumbnails, transformed derivatives, resized versions and video poster URLs without a signature: must fail.
- Try the short-lived signed download URL after expiration: must fail.
- Check that the browser never receives permanent public Cloudinary URLs for restricted posts.
- Existing unsigned/public FreeUpper uploads cannot be made private by database RLS. Do not enable nonpublic publishing until asset migration/rehousing and derived-media handling are validated.

## Release decision
Keep the existing production guard rejecting nonpublic post publishing. Do not merge PR #9 or enable private-media delivery on production until all live tests are recorded with request status, evidence, and reviewer approval.
