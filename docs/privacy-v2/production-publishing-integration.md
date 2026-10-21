# Privacy V2 protected publishing API integration (production disabled)

This branch isolates the production API integration from PR #9's staging and legacy-media work. **Do not enable restricted publishing or merge PR #9 wholesale.**

## Existing production dependencies verified 2026-10-21
- `public.post_media_assets` exists, RLS enabled, service-role access only.
- `privacy_v2_private.follow_approvals` and `approved_edge` exist.
- Restrictive post SELECT policy installed for Public/owner/approved Followers/approved Mutuals.
- `public.authorize_protected_asset(uuid,uuid)` exists, service-role-only.
- `public.protected_first_release_status()` exists and returns `delivery=false`; production delivery stays disabled.
- Existing production posts remain Public.

## Production publishing prerequisites NOT satisfied
1. `public.protected_publish_transition` is not installed. The upload-signature and publishing routes in PR #9 require it for owned drafts and reserved media slots.
2. The production registry differs from staging's reserved-slot schema. Reconcile field names, uniqueness and ownership invariants before porting the registration route.
3. The production release-status function has no approved `publishing=true` state. The runtime intentionally rejects publication.
4. Audit all current INSERT/UPDATE/RPC post-write paths and add an enforceable private-publish guard before any UI activation. Post SELECT RLS alone does not secure writes.
5. Review Cloudinary authenticated delivery, exact asset IDs, signed uploads, and poster/thumbnail variants before publishing.
6. Confirm follow approval is issued only by the target owner, with revocation on unfollow; current registry backfill does not itself enforce future writes.
7. Port the minimal dependency closure of `api/privacy-v2-{publish,register-asset,upload-signature}.js` and `lib/protected-media/publishing-runtime.js`, excluding staging-only routes and configuration.
8. Production-only smoke checks are required for deployed endpoints and DB privileges; reuse the already passed 18 staging audience cases rather than repeating them.

## Activation
Keep Vercel protected publishing variables unset and the DB release flag disabled until the above are complete and verified. Do not convert legacy Public Cloudinary URLs as part of protected-first publishing.
