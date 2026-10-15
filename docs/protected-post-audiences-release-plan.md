# Protected post audiences — implementation and release gate

Branch: `feature/protected-post-audiences`. Production remains public-only until all gates pass.

## Visibility contract
- `public`: accessible according to public-account and existing moderation rules.
- `followers`: owner or accepted follower; never trust a caller-supplied user ID.
- `friends`: owner or mutually accepted followers (UI label **Mutuals**).
- `only_me`: owner only.
- Existing public posts remain public; no bulk media rewrite.

## Required implementation sequence
1. Confirm production schema, actual `follows.status` values, all SELECT/UPDATE/ALL policies, `SECURITY DEFINER` functions, views, storage paths and public profile/account rules.
2. Build a transaction-safe RLS migration replacing *all* permissive `posts` SELECT policies; retain owner writes and enforce audience authorization with trusted `auth.uid()`. Audit privileged functions including `edit_post`, `search_posts`, and `record_share` so they cannot bypass visibility. Preserve private-account behavior.
3. Add server-controlled media registration/upload and protected Cloudinary assets for restricted posts. Store public IDs server-side. Deliver restricted assets only through authenticated authorization checks and short-lived URLs/proxy. Do not accept arbitrary client-supplied media public IDs. Block legacy public-media-to-restricted transitions until assets are safely migrated.
4. Ensure feed, profile, search, shares, embeds, notifications, sounds, and caching respect the same audience check. Clear cached media/URLs when access is revoked; never index restricted posts.
5. Enable audience choices in `create.html` and `studio.html` only after protected media upload and server validation work. Public remains default.
6. Test as owner, follower, nonfollower, mutual, blocked user, signed-out visitor, and revoked follower; test direct REST/RPC reads, media URL playback, signed URL expiry, edits, deletes, and access revocation. Test real authenticated publishing in isolated FreeUpper environment; clean up synthetic fixtures.
7. Confirm Vercel production and GitHub SHA, run all CI checks, review rollback, obtain release approval, then merge narrowly to `main`.

## Stop conditions
- Never enable restricted options while Cloudinary public URLs are returned.
- Do not reuse OTD/OCIDE staging Supabase for FreeUpper tests.
- No direct production test post without a dedicated test account and explicit cleanup plan.
- Do not merge the experimental privacy review branch wholesale.

## Current verified state
- Production public-only trigger enabled; 100 existing posts public at last audit.
- Client public-only guard deployed at main commit `d8850ed3ef635a173f261e301c9aee40fb087f28`.
- Authenticated end-to-end publishing test **not yet completed**.
