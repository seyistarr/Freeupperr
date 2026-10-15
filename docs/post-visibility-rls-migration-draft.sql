-- REVIEW ONLY: proposed atomic post RLS migration; DO NOT DEPLOY until
-- privileged RPCs, share policies, media URLs and feed integration are audited.
BEGIN;
CREATE OR REPLACE FUNCTION public.can_view_freeupper_post(p_author_id uuid,p_visibility text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT CASE
 WHEN auth.uid()=p_author_id THEN true
 WHEN NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_author_id AND p.suspended IS FALSE AND p.is_private IS NOT NULL) THEN false
 WHEN p_visibility='only_me' THEN false
 WHEN p_visibility='public' THEN EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_author_id AND p.is_private IS FALSE)
 WHEN p_visibility IN ('followers','friends') THEN
 EXISTS(SELECT 1 FROM public.follows f WHERE f.follower_id=auth.uid() AND f.following_id=p_author_id AND f.status='active')
 AND (p_visibility='followers' OR EXISTS(SELECT 1 FROM public.follows f WHERE f.follower_id=p_author_id AND f.following_id=auth.uid() AND f.status='active'))
 ELSE false END
$$;
REVOKE ALL ON FUNCTION public.can_view_freeupper_post(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_freeupper_post(uuid,text) TO anon,authenticated;
-- Existing FOR ALL owner policy also grants SELECT to owners; retain intentionally.
-- Its owner visibility overrides hidden/deleted exclusions for owners.
-- If hidden/deleted should be invisible to owners, revise the ALL policy separately.
DROP POLICY IF EXISTS "Anyone can view posts" ON public.posts;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.posts;
DROP POLICY IF EXISTS "Posts are viewable by everyone" ON public.posts;
DROP POLICY IF EXISTS "Public read posts" ON public.posts;
CREATE POLICY "Posts readable by permitted audience" ON public.posts
FOR SELECT TO anon,authenticated USING (
  is_deleted IS FALSE AND is_hidden IS FALSE
  AND public.can_view_freeupper_post(user_id,visibility)
);
COMMIT;

-- PRODUCT DECISION REQUIRED: For a private author, should legacy Everyone posts
-- be visible to approved followers? Current draft denies them, while the
-- previously agreed private-account model suggests approved followers should see them.
-- Resolve this before deploying or adding final regression tests.
