# FreeUpper post visibility rollout gate

Status: **BLOCKED — do not deploy audience selectors or RLS yet.**

## Verified production findings
- posts RLS is enabled but multiple SELECT policies have USING (true).
- posts.visibility currently defaults to 'public'; Create/Studio previously did not send visibility.
- follows.status uses 'active' for existing relationships.
- public.search_posts is SECURITY DEFINER and filters is_deleted=false and visibility='public', but **does not filter private/suspended authors or hidden posts**. It can leak posts even after RLS is corrected.
- Public Cloudinary delivery URLs may bypass post-row access checks.

## Release requirements
1. Inventory and update all SECURITY DEFINER RPCs and public views that expose post content, especially search_posts.
2. Audit Cloudinary delivery, transformation, CDN caches, and signed/private assets. Don't claim Only me privacy for public media URLs.
3. Verify follow approval transitions and existing private accounts.
4. Create one transaction-safe migration replacing *all* permissive read policies; preserve owner writes and moderation rules.
5. Enforce both post visibility and author privacy. Deny deleted/hidden/suspended content to ordinary viewers.
6. Test anon, owner, unrelated user, pending follower, active follower, mutual follower, private author, suspended author, and changed audience.
7. Verify Home, Video, Profile, Create, Studio, share previews, search, SEO, and media URLs before merging.
8. Consider disabling or hiding new audience selectors until the database and media protections ship atomically.

No production SQL changes are authorized by this document.

## Privileged RPC audit (2026-10-15)
- **edit_post**: SECURITY DEFINER, ownership check exists; p_visibility text DEFAULT 'public'. A content-only edit can reset a restricted post to public. Fix by preserving visibility unless explicitly changed and validating the allowed audience.
- **record_share**: SECURITY DEFINER, accepts caller-supplied p_user_id, no auth.uid() equality check and no post visibility check. Requires authorization and audience check before sharing.
- **search_posts**: SECURITY DEFINER, lacks private/suspended author and hidden checks. Must be updated before privacy launch.
- **toggle_repost**, **delete_post**, and other privileged RPCs: require independent inspection; existence of SECURITY DEFINER is not itself proof of an exploit.
- The 9 isolated staging audience tests validate decision logic only; they do not test full RLS policy interactions or public media URLs.

## Isolated sharing authorization tests
- Staging project: tagkrhvgcbnybiuyvjxt, schema post_visibility_test.
- 12/12 synthetic decision cases passed: public, pending/active/mutual followers, private account, only_me, hidden/deleted, suspended and anonymous.
- Fixture rows were wrapped in BEGIN/ROLLBACK; no production changes.
- These are decision-function tests, not tests of actual record_share writes, RLS, CDN access or authenticated JWT identity.

## Private account legacy Everyone regression
- Product decision: existing Everyone posts on a private account are accessible to approved active followers and the owner, not the general public.
- Isolated staging PostgreSQL RLS tests passed: approved follower allowed; pending follower, stranger and anon denied.
- Tests used transaction-scoped synthetic fixtures; no production mutation.
- Remaining: full production-compatible migration tests, SECURITY DEFINER RPC audits, share-table RLS, Cloudinary protected delivery, UI integration and end-to-end tests.

## Cloudinary sampled media audit (2026-10-15)
- Cloudinary list_images returned recent FreeUpper post images with type=upload and access_control=[{access_type:anonymous}].
- Cloudinary list_videos sampled 10 recent videos; all 10 reported anonymous delivery access.
- Create and Studio use unsigned upload presets and persist Cloudinary secure_url; URL-based access can bypass post RLS.
- Block production rollout of private media visibility until protected delivery architecture is implemented and verified.
- Recommended: server-issued short-lived signed delivery URLs for authorized viewers, authenticated/private assets, secure upload flow, and revoke/cache strategy when changing audience.
- Migration must account for already-public URLs: merely changing database visibility or moving media to a protected URL does not automatically invalidate previously shared or cached public URLs.
- Avoid changing live Cloudinary asset access controls before a tested migration plan; doing so can break existing posts.

## Cloudinary asset inventory (2026-10-15)
- Connected Cloudinary image inventory: sampled post images have type=upload and access_control=[{access_type:anonymous}], with direct res.cloudinary.com delivery URLs. These are not protected assets.
- Video inventory query did not yield verifiable records; do not infer video access settings.
- The Create and Studio client-side unsigned upload flow receives and stores secure_url. HTTPS does not imply authorization.
- Release blocker: design authenticated media delivery and secure thumbnails/derived transformations; protect or replace legacy public URLs, invalidate caches and consider already copied links. Access revocation must be tested.
- Do not switch Cloudinary assets to authenticated/private delivery without a tested migration and working signed playback path, or existing media may break.

## Protected media JavaScript tests (2026-10-15)
- 25 protected-media tests passed under Node.js 22 in an isolated local runner (15 audience decision tests, 10 mocked database-access tests), 0 failures.
- GitHub Actions run for the branch has not been confirmed; local execution is not CI confirmation.
- No Cloudinary signed delivery, authenticated live endpoint, public-URL revocation, or end-to-end browser testing has passed yet.
