-- REVIEW ONLY. Do not apply until Cloudinary and RPC release gates pass.
-- Production inventory 2026-10-20: four SELECT USING(true) policies, owner ALL.
BEGIN;
DO $$
BEGIN
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public'
   AND tablename='posts' AND cmd='SELECT' AND qual='true') <> 4
 THEN RAISE EXCEPTION 'Unexpected SELECT policy inventory'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public'
   AND tablename='posts' AND cmd='ALL') <> 1
 THEN RAISE EXCEPTION 'Unexpected ALL policy inventory'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
   AND tablename='posts' AND cmd IN ('ALL','SELECT')
   AND policyname NOT IN ('Users can manage own posts',
     'Anyone can view posts','Enable read access for all users',
     'Posts are viewable by everyone','Public read posts'))
 THEN RAISE EXCEPTION 'Unexpected posts read policy'; END IF;
END $;
DROP POLICY "Anyone can view posts" ON public.posts;
DROP POLICY "Enable read access for all users" ON public.posts;
DROP POLICY "Posts are viewable by everyone" ON public.posts;
DROP POLICY "Public read posts" ON public.posts;
CREATE POLICY "Privacy V2 audience read" ON public.posts
FOR SELECT TO PUBLIC USING (
  is_deleted IS FALSE AND is_hidden IS FALSE AND EXISTS (
    SELECT 1 FROM public.profiles a
    WHERE a.id=posts.user_id AND a.suspended IS FALSE AND (
      (posts.visibility='public' AND (a.is_private IS FALSE OR EXISTS (
        SELECT 1 FROM public.follows f WHERE f.follower_id=auth.uid()
          AND f.following_id=posts.user_id AND f.status='active')))
      OR (posts.visibility='followers' AND EXISTS (
        SELECT 1 FROM public.follows f WHERE f.follower_id=auth.uid()
          AND f.following_id=posts.user_id AND f.status='active'))
      OR (posts.visibility='friends' AND EXISTS (
        SELECT 1 FROM public.follows f WHERE f.follower_id=auth.uid()
          AND f.following_id=posts.user_id AND f.status='active')
        AND EXISTS (
        SELECT 1 FROM public.follows f WHERE f.follower_id=posts.user_id
          AND f.following_id=auth.uid() AND f.status='active'))
    )
  )
);
COMMIT;
-- Known limitations: owner ALL bypasses SELECT checks; review blocked-user
-- semantics, profile/follows RLS, SECURITY DEFINER RPCs, media URLs and video.
