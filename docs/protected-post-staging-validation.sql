-- ISOLATED FREEUPPER STAGING ONLY. Execute after both REVIEW SQL files.
-- Run each test under distinct signed-in JWT contexts, not service_role.
-- Do not execute this script on the production Supabase project.

-- 1. Verify policies: no USING(true) SELECT policies survive.
SELECT policyname,cmd,qual FROM pg_policies
WHERE schemaname='public' AND tablename='posts' ORDER BY policyname;

-- 2. Verify privileged function signatures and SECURITY DEFINER flags.
SELECT proname,pg_get_function_identity_arguments(oid),prosecdef
FROM pg_proc WHERE pronamespace='public'::regnamespace
AND proname IN ('edit_post','record_share','search_posts','freeupper_can_view_post');

-- 3. For each fixture post and each viewer identity, assert:
-- public: anonymous can view if author public; private author only owner/active follower.
-- followers: owner and active follower only; anonymous/nonfollower denied.
-- friends: owner and two-way active followers only.
-- only_me: owner only.
-- is_deleted / is_hidden: nonowner denied even with active follows.
-- revoked follow: immediately denies SELECT, RPC and media access.

-- 4. record_share: wrong p_user_id must raise 42501, as must unauthenticated
-- calls and unauthorized post access. Duplicate share must not increment count.
-- 5. edit_post: nonowner rejected, no unintended public conversion on omitted
-- visibility, explicit restricted changes rejected pending secure media.
-- 6. search_posts: exclude hidden/deleted, non-public and private authors.
-- 7. Confirm Cloudinary authenticated URLs cannot be fetched without a valid
-- token; test byte ranges, expiry, revocation, and caching behavior.
-- 8. Verify post create, edit, delete, search, share, feeds and notifications.

-- STOP if any privileged RPC, view, realtime channel, edge function or CDN
-- still leaks restricted post rows or media. Do not promote to production.
