-- REVIEW ONLY: not ready for production. Privileged RPCs and protected media are not hardened.
BEGIN;
CREATE OR REPLACE FUNCTION public.freeupper_can_view_post(p_author uuid,p_visibility text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
 SELECT CASE
 WHEN auth.uid() = p_author THEN true
 WHEN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_author AND p.suspended IS FALSE) THEN false
 WHEN p_visibility = 'only_me' THEN false
 WHEN p_visibility NOT IN ('public','followers','friends') OR p_visibility IS NULL THEN false
 WHEN p_visibility = 'public' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_author AND p.is_private IS FALSE) THEN true
 WHEN auth.uid() IS NULL THEN false
 ELSE EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id=auth.uid() AND f.following_id=p_author AND f.status='active')
 AND (p_visibility <> 'friends' OR EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id=p_author AND f.following_id=auth.uid() AND f.status='active')) END;
$fn$;
REVOKE ALL ON FUNCTION public.freeupper_can_view_post(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freeupper_can_view_post(uuid,text) TO anon,authenticated;
DROP POLICY IF EXISTS "Anyone can view posts" ON public.posts;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.posts;
DROP POLICY IF EXISTS "Posts are viewable by everyone" ON public.posts;
DROP POLICY IF EXISTS "Public read posts" ON public.posts;
CREATE POLICY "FreeUpper permitted post audiences" ON public.posts FOR SELECT TO anon,authenticated
USING (is_deleted IS FALSE AND is_hidden IS FALSE AND public.freeupper_can_view_post(user_id,visibility));
COMMIT;
-- Owner ALL policy remains intentionally. Not a complete security release.
