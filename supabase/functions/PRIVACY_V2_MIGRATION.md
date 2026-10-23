# Privacy V2 Edge migration — isolated branch

This branch is derived from `feature/post-privacy-v2-integration`. The two Edge function entrypoints are **fail-closed placeholders**, not replacements for the existing Vercel API. They have not been deployed. Do not redirect callers or remove Vercel functions yet.

## Existing endpoints

- `api/privacy-v2-publish.js`: draft create, status, visibility, publish, cancel, cleanup and staging acceptance
- `api/privacy-v2-upload-signature.js`: JWT identity, owned-draft reservation RPC, authenticated Cloudinary upload signing
- `api/privacy-v2-register-asset.js`: JWT identity, draft ownership, Cloudinary resource verification and registration RPC
- `api/post-media.js`: JWT identity, asset lookup, audience authorization, expiring Cloudinary private download and bounded Range proxy

## Required porting safeguards

1. Staging-only first: project `tagkrhvgcbnybiuyvjxt`; never point at production automatically.
2. Port production release gates explicitly; Vercel-specific environment checks cannot simply be copied to Edge.
3. Authenticate JWT using Supabase Auth and validate the asset/draft against server-side database records; never trust client-provided user IDs or Cloudinary public IDs.
4. Retain RPCs `protected_publish_transition`, `set_new_protected_visibility`, `authorize_protected_asset`, and release-status checks with their original permissions.
5. Keep Cloudinary secret server-side, authenticated upload type, durable reservation timestamps, and authenticated resource verification.
6. Preserve expiring private_download_url semantics, per-request authorization, no-store responses, byte-range validation, content-type and payload-size limits, and redirect prevention.
7. Port staging cleanup and acceptance worker authentication before moving the publish endpoint.
8. Update frontend callers only after staging integration tests pass; do not remove existing routes before verifying function count and deployment behavior.
9. Preserve public short links, SEO preview routes and the production public-only privacy gate.

## Acceptance

Run the existing `npm run test:post-media` regression suite, plus Edge-specific integration tests. Confirm owner, mutual and non-follower authorization, guest denial, expired URLs, revoked follow relationships, visibility changes, thumbnail access, video seeking and Cloudinary failures. Existing three-user results establish a baseline; they do not automatically validate the new runtime.
