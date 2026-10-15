-- REVIEW ONLY. Do not run on production until tested against the real schema and existing RPCs.
-- Audience visibility: public, followers, friends, only_me.
-- Existing public posts remain public unless their creator is private.
-- IMPORTANT: replacing permissive SELECT policies is necessary because RLS policies are OR-combined.
CREATE OR REPLACE FUNCTION public.can_view_freeupper_post(p_author_id uuid, p_visibility text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT CASE
   WHEN auth.uid() = p_author_id THEN true
   WHEN NOT EXISTS (
     SELECT 1 FROM public.profiles a WHERE a.id = p_author_id
       AND a.suspended IS FALSE
       AND a.is_private IS NOT NULL
   ) THEN false
   WHEN p_visibility = 'only_me' THEN false
   WHEN p_visibility = 'public' THEN EXISTS (
     SELECT 1 FROM public.profiles a WHERE a.id = p_author_id AND a.is_private IS FALSE
   )
   WHEN p_visibility IN ('followers','friends') THEN
     EXISTS (
       SELECT 1 FROM public.follows f
       WHERE f.follower_id = auth.uid() AND f.following_id = p_author_id AND f.status = 'active'
     ) AND (
       p_visibility = 'followers' OR EXISTS (
         SELECT 1 FROM public.follows r
         WHERE r.follower_id = p_author_id AND r.following_id = auth.uid() AND r.status = 'active'
       )
     )
   ELSE false
 END;
$$;
-- IMPORTANT: final policy must also check posts.is_deleted IS FALSE and posts.is_hidden IS FALSE
-- and must be verified for existing moderation, feed and RPC behavior.
-- No DROP POLICY is included until all existing policies have been reviewed.
