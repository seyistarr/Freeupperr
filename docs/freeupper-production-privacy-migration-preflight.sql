-- FREEUPPER PRODUCTION PRIVACY PREFLIGHT — READ ONLY
-- Target: jmjtqidirpmnegzvmiaq
-- Run before reviewing any RLS/RPC migration. No writes.

-- 1. Existing audience distribution; do not change existing rows.
SELECT visibility, count(*) AS posts FROM public.posts GROUP BY visibility ORDER BY visibility;

-- 2. Existing RLS policies, including owner ALL policy and permissive SELECT.
SELECT policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('posts', 'profiles', 'follows')
ORDER BY tablename, policyname;

-- 3. Privileged function bodies and signatures, for exact replacement review.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('edit_post', 'record_share', 'search_posts')
ORDER BY p.proname;

-- 4. Private-account footprint; do not reveal user identifiers.
SELECT count(*) AS profiles, count(*) FILTER (WHERE is_private IS TRUE) AS private_profiles
FROM public.profiles;

-- 5. Validate columns required by the authorization design.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('posts','profiles','follows')
  AND column_name IN ('id','user_id','visibility','is_deleted','is_hidden','is_private',
                      'suspended','follower_id','following_id','status')
ORDER BY table_name,column_name;

-- PRECONDITIONS BEFORE ANY WRITE:
-- A. Explicitly choose whether existing public posts by private authors remain
--    follower-only. Current permissive SELECT policies do not enforce that.
-- B. Test feed/profile/search/public media regressions in a FreeUpper-isolated
--    environment, NOT the OTD/OCIDE staging project.
-- C. Audit all SECURITY DEFINER functions and direct post write paths.
-- D. Build rollback SQL restoring exact original policies and functions.
-- E. Obtain final explicit approval for the exact migration.
