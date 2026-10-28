-- Read-only, post-application catalog verification. Does not impersonate a signed-in user.
BEGIN READ ONLY;
DO $verify$
DECLARE r record; p pg_proc%rowtype;
BEGIN
 IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.profiles'::regclass)
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.posts'::regclass) THEN RAISE EXCEPTION 'RLS disabled'; END IF;
 IF has_table_privilege('authenticated','public.profiles','SELECT')
 OR has_column_privilege('authenticated','public.profiles','is_admin','SELECT')
 OR has_column_privilege('authenticated','public.profiles','phone','SELECT') THEN RAISE EXCEPTION 'Profile privacy grants broadened'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='posts'
 AND policyname='posts_hide_all_posts_boundary' AND permissive='RESTRICTIVE' AND cmd='SELECT'
 AND roles::text='{anon,authenticated}') THEN RAISE EXCEPTION 'Hide boundary missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
 AND policyname='profiles_owner_update' AND qual='(auth.uid() = id)' AND with_check='(auth.uid() = id)') THEN RAISE EXCEPTION 'Owner policy changed'; END IF;
 IF has_function_privilege('anon','public.authorize_protected_asset(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.authorize_protected_asset(uuid,uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.authorize_protected_asset(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Media ACL invalid'; END IF;
 IF has_function_privilege('anon','privacy_v2_private.session_post_readable(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','privacy_v2_private.session_post_readable(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Private helper exposed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
 AND policyname='Admins can update any profile' AND roles::text='{authenticated}'
 AND qual LIKE '%is_admin_user%' AND with_check=qual) THEN RAISE EXCEPTION 'Administrator policy invalid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='privacy_v2_private.session_post_readable(uuid)'::regprocedure
 AND NOT prosecdef AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=""']
 AND md5(prosrc)='ef65660bf8943550f50feaaa7159f758') THEN RAISE EXCEPTION 'Private helper security metadata invalid'; END IF;
 FOR r IN SELECT * FROM (VALUES
  ('public.get_public_post_by_short_code(text)','02189be851f4229815419aca0f8796b0',true,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
  ('public.get_public_post_seo_metadata(text)','4d9de5e5925f46d969e2e0a234cb0518',true,'{postgres=X/postgres,anon=X/postgres}'),
  ('public.get_public_short_code_for_post(uuid)','4c0772245f33ebb0fd4f995c55207f77',true,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
  ('public.get_public_video_seo(text)','c337cfc7f69a698128159a0dc242316d',true,'{postgres=X/postgres,anon=X/postgres}'),
  ('public.list_public_post_sitemap(text, integer)','5d80b384b5750f76e7a745bf85019c07',true,'{postgres=X/postgres,anon=X/postgres}'),
  ('public.authorize_protected_asset(uuid, uuid)','8e900ee6519aae25d66fbcbb31bbf17d',true,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.search_posts(text, integer)','b4e1b9551497eb8474e3278df1fb2b41',false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.get_sound_stats(text)','4f5c5b8bee198745b1d21223b5b7dc37',false,NULL),
  ('public.get_bookmarks()','e9153c81e8f5c450962350ca5873fc32',false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.get_notifications(integer, integer)','47a0fbe1862a51bfefa4bee06d7d41fc',false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.add_view(uuid, uuid, text)','d17b41136cb19b37ac88b39b5ca3ee9b',true,'{=X/postgres,postgres=X/postgres,authenticated=X/postgres,anon=X/postgres}'),
  ('public.record_share(uuid, uuid)','afb8586fa2fdd14ea337d4d9c42d280d',true,NULL),
  ('public.toggle_bookmark(uuid)','04432e262b954d74096aefe3327bb18c',true,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_bookmark(uuid, uuid)','987068677816def406a04367faa74227',true,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_comment_like(uuid)','01ca304c9f327aa810ddc4a86db32932',true,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_comment_like(uuid, uuid)','6f789edaf055119bb387029397806758',true,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_post_like(uuid)','5b22c866e172f925071b6e8302234484',true,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_repost(uuid, text)','6fcd759ae10005b6c6c501b36362738c',true,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_repost(uuid, uuid, text)','b1b303e3c2d7b042153306b23e4f19fe',true,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('privacy_v2_private.restricted_notification_guard()','7581ffb1ef475fc78a795279c4197060',true,'{postgres=X/postgres}')
 ) AS expected(signature,body_hash,is_definer,acl) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
  IF p.oid IS NULL OR pg_get_userbyid(p.proowner)<>'postgres' OR md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))<>r.body_hash
   OR p.prosecdef IS DISTINCT FROM r.is_definer OR p.proacl::text IS DISTINCT FROM r.acl
   OR p.proconfig IS NULL THEN RAISE EXCEPTION 'Function verification failed: %',r.signature; END IF;
 END LOOP;
END $verify$;
SELECT 'Hide All Posts catalog checks passed; verify with actual account sessions separately' AS result;
COMMIT;
