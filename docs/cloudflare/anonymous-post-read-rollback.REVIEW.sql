-- REVIEW ONLY. Restores the previous fail-closed (but broken anonymous-read)
-- state. No data, RLS enablement or function permissions are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER POLICY privacy_v2_restricted_post_read_boundary ON public.posts
  TO anon, authenticated;
DROP POLICY privacy_v2_anonymous_public_post_read_boundary ON public.posts;
COMMIT;
