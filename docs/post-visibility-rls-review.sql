-- REVIEW ONLY: security design, not approved for deployment.
-- RLS policy evaluation is permissive/OR; all unrestricted SELECT policies must be removed atomically.
-- SECURITY DEFINER functions need explicit EXECUTE grants, search_path restrictions, and access testing.
-- Public media URLs may remain directly accessible after database access is restricted;
-- protected media requires signed delivery/private storage and cache invalidation.
-- Audit SECURITY DEFINER RPCs, views, search indexes, realtime, and storage access before rollout.
-- Existing posts: public visibility is the current default, but private author overrides it.
-- Hide/deletion and suspended-author exclusions belong in the policy predicate.
-- Follow requests with status other than 'active' do not grant access.
-- Author account privacy cannot be bypassed by public post visibility.
-- Admin moderation access must be designed separately, not via unrestricted SELECT.

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
