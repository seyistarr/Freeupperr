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
