-- READ ONLY. Repeat immediately before approving/applying the proposed migration.
SELECT current_database(), current_user, version();
SELECT column_name,data_type,is_nullable,column_default
FROM information_schema.columns WHERE table_schema='public' AND table_name='posts'
ORDER BY ordinal_position;
SELECT p.oid::regprocedure AS signature,md5(p.prosrc) AS source_md5,p.prosecdef,p.proacl
FROM pg_proc p WHERE p.oid IN ('public.toggle_repost(uuid,text)'::regprocedure,'public.toggle_repost(uuid,uuid,text)'::regprocedure);
-- Expected pre-install hashes: e43b1aa6b3b9830cc2635ea85886b34c and 88c39cc3d310e4d8fb27b66910505d3c.
SELECT policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename='posts' ORDER BY policyname;
SELECT tgname,pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid IN ('public.posts'::regclass,'public.reposts'::regclass) AND NOT tgisinternal;
SELECT count(*) AS posts, count(*) FILTER(WHERE p.repost_count<>(SELECT count(*) FROM public.reposts r WHERE r.post_id=p.id)) AS plain_count_drift
FROM public.posts p;
-- Audited baseline: 120 posts, zero drift, no quoted_post_id or is_quote columns.
