# Hide All Posts correction

## Confirmed production diagnosis (2026-10-28)

`settings.html` calls `SettingsAPI.updateFlags`, which PATCHes `profiles` with an ID filter through the Supabase client configured in `auth.js` for `https://api.freeupper.com`. The gateway preserves the caller's Authorization JWT, replaces only the apikey with its fixed anon key, and forwards to `jmjtqidirpmnegzvmiaq.supabase.co`. Supabase validates the JWT and chooses `authenticated` for signed-in requests; missing Authorization falls back to `anon`. No elevated gateway credential is used.

Production has RLS enabled, an owner UPDATE policy with both `USING (auth.uid() = id)` and `WITH CHECK (auth.uid() = id)`, and column-scoped profile SELECT privileges. The legacy permissive policy `Admins can update any profile` directly SELECTs `profiles.is_admin`, a column `authenticated` cannot SELECT. Planning the UPDATE therefore fails before the owner policy can authorize it. A production `BEGIN; SET LOCAL ROLE authenticated; EXPLAIN UPDATE ... WHERE id = <nonexistent UUID>; ROLLBACK` reproduced SQLSTATE 42501 without modifying rows. All profile privacy toggles using the same UPDATE path are affected. This was a database-role reproduction, not a signed-in browser/JWT test.

## Review SQL and security impact

Apply the exact transaction in `hide-all-posts.REVIEW.sql` only after explicit approval. It is intentionally outside automatic migrations.

* The existing administrator policy uses the already deployed `is_admin_user(auth.uid())` helper, restricted to `authenticated`. The owner policy is retained. No table/column grants are added and RLS stays enabled. No new SECURITY DEFINER functions are introduced; existing functions keep their privilege model and ACLs.
* A new restrictive SELECT policy adds hide-all enforcement to every direct `posts` read. Owners pass this additional condition; all existing audience, publication, verification and retirement policies still apply.
* Existing definer RPCs bypass post RLS, so the public short-link resolver, reverse short-code lookup, SEO metadata/video, sitemap, search and protected-media authorization explicitly check the setting. Public-only RPCs remain public-only. Protected-media authorization retains the verified viewer and original followers/mutuals rules.
* Posts, media records, visibility/audience values and follow relationships are not rewritten or deleted. Disabling the flag removes only the additional hiding restriction.

The UI requires a returned matching owner ID before updating local cache or displaying success. Zero-row updates are failures. Hide All Posts disables the switch during persistence and restores its previous state on failure.

The post preview and sitemap handlers now specify no-store. The Cloudflare adapter already forces private/no-store for dynamic handlers. Feeds, profile posts, direct UUID reads and embedded post reads use post RLS. Public short links/previews use the reviewed public RPCs; protected playback uses `authorize_protected_asset`. The audited `repost_feed_items` view contains repost identities and comments, not original post bodies; clients fetch the post through RLS. Existing definer interaction/count RPCs are outside this post-body read correction.

## Verification

Isolated PGlite regression tests reproduce the original profile permission error, apply the exact review SQL, and check owner persistence, denied follower/unrelated/anonymous updates, preserved protected-column denial, Public/Followers/Mutuals/Only Me visibility, hide/unhide restoration, retained rows, public RPC denial and protected media denial. VM tests verify no cache update before persistence, zero-row failure, error propagation and switch rollback. Gateway tests verify JWT forwarding without escalation.

Production SQL is not applied. Signed-in production account testing is pending approval/application and available account sessions. No production JWT was inspected or used. After application, verify with an actual owner session and separate follower, mutual, unrelated and anonymous sessions; check feeds, search, profile, direct UUID/short links, playback, reload persistence, disable restoration, and cross-owner update denial. Existing downloaded content and previously issued media URLs cannot be recalled by a database flag.
