-- REVIEW ONLY. Not an automatically applied migration.
-- Preserve the authenticated boundary and its authenticated-only helper ACL.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $review$
DECLARE boundary record;
BEGIN
  SELECT * INTO boundary FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'posts'
    AND policyname = 'privacy_v2_restricted_post_read_boundary';
  IF NOT FOUND OR boundary.permissive <> 'RESTRICTIVE' OR boundary.cmd <> 'SELECT'
      OR boundary.roles <> ARRAY['anon','authenticated']::name[]
      OR md5(boundary.qual) <> 'f13f7817b7769d6d2ee938a82fe43d1f' THEN
    RAISE EXCEPTION 'Post read boundary changed; inspect before applying';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.posts'::regclass)
      OR has_function_privilege('anon', 'public.privacy_v2_approved_edge(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RLS/helper ACL differs from reviewed state';
  END IF;
END
$review$;

-- Only change which role uses the EXISTING expression. Do not rewrite it.
ALTER POLICY privacy_v2_restricted_post_read_boundary ON public.posts
  TO authenticated;

-- A separate restrictive policy cannot be bypassed by legacy USING (true)
-- permissive policies. It never references the authenticated-only helper.
CREATE POLICY privacy_v2_anonymous_public_post_read_boundary ON public.posts
  AS RESTRICTIVE FOR SELECT TO anon
  USING (
    publishing_state = 'published'
    AND visibility = 'public'
    AND is_deleted IS FALSE
    AND is_hidden IS FALSE
    AND EXISTS (
      SELECT 1 FROM public.profiles AS author
      WHERE author.id = posts.user_id
        AND author.is_private IS FALSE
        AND author.suspended IS FALSE
    )
  );
COMMIT;
