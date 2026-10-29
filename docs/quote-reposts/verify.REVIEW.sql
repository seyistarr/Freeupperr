-- READ ONLY, AFTER the approved migration. This file does not publish posts.
SELECT public.quote_repost_status(); -- schemaVersion 1, readEnabled true, publishingEnabled false
SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name='posts' AND column_name IN ('quoted_post_id','is_quote');
SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.posts'::regclass
AND conname IN ('posts_quoted_post_id_fkey','posts_quote_shape');
SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='posts_quoted_post_id_idx';
SELECT count(*) AS counter_drift FROM public.posts p
WHERE p.repost_count IS DISTINCT FROM privacy_v2_private.expected_repost_count(p.id); -- zero
SELECT relrowsecurity FROM pg_class WHERE oid='public.posts'::regclass; -- true
SELECT policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename='posts' ORDER BY policyname; -- existing policies identical to audit; one added restrictive INSERT quote check
SELECT has_function_privilege('anon','public.create_quote_post(uuid,uuid,jsonb)','execute') AS anon_can_publish,
 has_function_privilege('authenticated','public.create_quote_post(uuid,uuid,jsonb)','execute') AS user_can_call;
-- Expected false,true. Calling while the rollout is disabled must still fail.
SELECT proname,prosecdef,proconfig,proacl FROM pg_proc
WHERE pronamespace IN ('public'::regnamespace,'privacy_v2_private'::regnamespace)
AND (proname LIKE '%quote%' OR proname IN ('expected_repost_count','refresh_repost_counts','canonical_repost_count'));
SELECT * FROM public.load_quote_references(ARRAY[]::uuid[]); -- zero rows
SELECT public.get_quotable_post('00000000-0000-0000-0000-000000000000'); -- null
