-- Synthetic local fixture of the relevant production definitions; no user data.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE SCHEMA privacy_v2_private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_private boolean, suspended boolean);
CREATE TABLE public.posts (
  id text PRIMARY KEY, user_id uuid, visibility text, publishing_state text,
  is_deleted boolean, is_hidden boolean
);
CREATE TABLE privacy_v2_private.approved_follows (follower uuid, following uuid);
REVOKE ALL ON SCHEMA privacy_v2_private FROM PUBLIC;
CREATE FUNCTION privacy_v2_private.approved_edge(p_follower uuid, p_following uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM privacy_v2_private.approved_follows WHERE follower=p_follower AND following=p_following)
$$;
CREATE FUNCTION public.privacy_v2_approved_edge(p_follower uuid, p_following uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND auth.uid() IN (p_follower,p_following)
    AND privacy_v2_private.approved_edge(p_follower,p_following)
$$;
REVOKE ALL ON FUNCTION public.privacy_v2_approved_edge(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.privacy_v2_approved_edge(uuid,uuid) TO authenticated;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.posts, public.profiles TO anon, authenticated;
CREATE POLICY legacy_public_read ON public.posts FOR SELECT USING (true);
CREATE POLICY privacy_v2_restricted_post_read_boundary ON public.posts AS RESTRICTIVE FOR SELECT TO anon, authenticated
USING (
  ((auth.uid() IS NOT NULL) AND (auth.uid() = user_id)) OR
  ((publishing_state = 'published'::text) AND (is_deleted IS FALSE) AND (is_hidden IS FALSE) AND
    ((visibility = 'public'::text) OR
      ((auth.uid() IS NOT NULL) AND (visibility = ANY (ARRAY['followers'::text, 'friends'::text])) AND
       privacy_v2_approved_edge(auth.uid(), user_id) AND
       ((visibility = 'followers'::text) OR privacy_v2_approved_edge(user_id, auth.uid())))))
);
