-- REVIEW ONLY. Full rollback restores the pre-review behavior, including its known defects.
-- Never roll back while any account relies on Hide All Posts: old definer RPCs would expose it.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $safe$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Run as postgres'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles WHERE hide_all_posts IS TRUE) THEN
  RAISE EXCEPTION 'Unsafe rollback: hidden accounts exist; retain restrictions and forward-fix'; END IF;
END $safe$;
DO $drift$
DECLARE r record; p pg_proc%rowtype;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.get_public_post_by_short_code(text)','de81ad44c4fc845e501df9304b31b7eb','02189be851f4229815419aca0f8796b0','{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
  ('public.get_public_post_seo_metadata(text)','3cfeae08bc95a4f105c3d7f0438d5d42','4d9de5e5925f46d969e2e0a234cb0518','{postgres=X/postgres,anon=X/postgres}'),
  ('public.get_public_short_code_for_post(uuid)','1680652ae8ca4a0e094ee3055342a325','4c0772245f33ebb0fd4f995c55207f77','{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
  ('public.get_public_video_seo(text)','c8a37a67b49e75b91eae09cbebac1f3f','c337cfc7f69a698128159a0dc242316d','{postgres=X/postgres,anon=X/postgres}'),
  ('public.list_public_post_sitemap(text, integer)','98cba16df2c304b87811700a9350fbba','5d80b384b5750f76e7a745bf85019c07','{postgres=X/postgres,anon=X/postgres}'),
  ('public.authorize_protected_asset(uuid, uuid)','be73c14f3859e25e3a59808cdf38b059','8e900ee6519aae25d66fbcbb31bbf17d','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.search_posts(text, integer)','e0e526f7d8c7d085917e55873ba92300','b4e1b9551497eb8474e3278df1fb2b41','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.get_sound_stats(text)','5fc973873667363f4f3eeaa8e8daccbe','4f5c5b8bee198745b1d21223b5b7dc37',NULL),
  ('public.get_bookmarks()','1823d2f9d2f97bdd99885da57765d0e6','e9153c81e8f5c450962350ca5873fc32','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.get_notifications(integer, integer)','7d6c25d34e8e9f1bbf4ecb726879e318','47a0fbe1862a51bfefa4bee06d7d41fc','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.add_view(uuid, uuid, text)','b47fc2ffd910673d759c21cc5df68f93','d17b41136cb19b37ac88b39b5ca3ee9b','{=X/postgres,postgres=X/postgres,authenticated=X/postgres,anon=X/postgres}'),
  ('public.record_share(uuid, uuid)','5d67756349e840259c526a9adecc0bcd','afb8586fa2fdd14ea337d4d9c42d280d',NULL),
  ('public.toggle_bookmark(uuid)','3aa83ce41b7307d3467dcabbeb7cfe72','04432e262b954d74096aefe3327bb18c','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_bookmark(uuid, uuid)','cd56817f7cdba0d69a64c1056301867c','987068677816def406a04367faa74227','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_comment_like(uuid)','43f7074c4f08f897c1a25b5385548127','01ca304c9f327aa810ddc4a86db32932','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_comment_like(uuid, uuid)','125441df9cb24c6033cdfe3588f27880','6f789edaf055119bb387029397806758','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_post_like(uuid)','8960ffeee6d28ba9390f5a64cf83270f','5b22c866e172f925071b6e8302234484','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_repost(uuid, text)','d0789a849868be848b9b0027e53e1ed1','6fcd759ae10005b6c6c501b36362738c','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.toggle_repost(uuid, uuid, text)','88c39cc3d310e4d8fb27b66910505d3c','b1b303e3c2d7b042153306b23e4f19fe','{postgres=X/postgres,authenticated=X/postgres}'),
  ('privacy_v2_private.restricted_notification_guard()','cba86b90278043550b6cae9536b7abdf','7581ffb1ef475fc78a795279c4197060','{postgres=X/postgres}'),
  ('public.is_admin_user(uuid)','b72a1212383e261665fc8d67867c677a','b72a1212383e261665fc8d67867c677a','{postgres=X/postgres,authenticated=X/postgres}'),
  ('privacy_v2_private.approved_edge(uuid, uuid)','c4114be6c6021f9df10c4315951399d6','c4114be6c6021f9df10c4315951399d6','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.permanent_post_readable(uuid, uuid)','57de72527f4285d545c2f8fae6df9d3f','57de72527f4285d545c2f8fae6df9d3f','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.verification_post_readable(uuid, uuid)','8c220cdb0d7bad54cd1ac61b4da3b0f2','8c220cdb0d7bad54cd1ac61b4da3b0f2','{postgres=X/postgres,authenticated=X/postgres}')
 ) AS expected(signature,original_body,reviewed_body,acl) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
  IF p.oid IS NULL OR pg_get_userbyid(p.proowner)<>'postgres' OR md5(replace(p.prosrc,chr(13)||chr(10),chr(10))) NOT IN (r.original_body,r.reviewed_body)
   OR p.proacl::text IS DISTINCT FROM r.acl THEN RAISE EXCEPTION 'Unreviewed function drift: %',r.signature; END IF;
 END LOOP;
END $drift$;
CREATE OR REPLACE FUNCTION public.get_public_post_by_short_code(p_code text)
 RETURNS TABLE(id uuid, media_type text, title text, description text, content text, media_url text, thumbnail_url text, text_template_id text, short_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.id, p.media_type, p.title, p.description, p.content,
         p.media_url, p.thumbnail_url, p.text_template_id, l.code
  from public.post_short_links l
  join public.posts p on p.id = l.post_id
  join public.profiles u on u.id = p.user_id
  where l.code = p_code
    and p.visibility = 'public'
    and coalesce(p.is_deleted, false) = false
    and coalesce(p.is_hidden, false) = false
    and coalesce(u.is_private, true) = false
  limit 1
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_post_seo_metadata(p_code text)
 RETURNS TABLE(author_name text, author_username text, published_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(nullif(trim(u.display_name), ''), u.username),
        u.username, p.created_at
 from public.post_short_links l
 join public.posts p on p.id = l.post_id
 join public.profiles u on u.id = p.user_id
 where l.code = p_code
   and p.visibility = 'public'
   and coalesce(p.is_deleted, false) = false
   and coalesce(p.is_hidden, false) = false
   and coalesce(u.is_private, true) = false
   and coalesce(u.suspended, false) = false
   and nullif(trim(coalesce(u.username, '')), '') is not null
   and p.created_at is not null
 limit 1
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_short_code_for_post(p_post_id uuid)
 RETURNS TABLE(short_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select l.code
  from public.post_short_links l
  join public.posts p on p.id = l.post_id
  join public.profiles u on u.id = p.user_id
  where p.id = p_post_id
    and p.visibility = 'public'
    and coalesce(p.is_deleted, false) = false
    and coalesce(p.is_hidden, false) = false
    and coalesce(u.is_private, true) = false
  limit 1
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_video_seo(p_code text)
 RETURNS TABLE(published_at timestamp with time zone, public_video_url text, public_thumbnail_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select p.created_at, case when p.media_url ~ '^https://res[.]cloudinary[.]com/[^ ]+/video/upload/' then p.media_url else null end, case when p.thumbnail_url ~ '^https://(res[.]cloudinary[.]com|jmjtqidirpmnegzvmiaq[.]supabase[.]co)/' then p.thumbnail_url else null end from public.post_short_links l join public.posts p on p.id=l.post_id join public.profiles u on u.id=p.user_id where l.code=p_code and p.media_type='video' and p.visibility='public' and coalesce(p.is_deleted,false)=false and coalesce(p.is_hidden,false)=false and coalesce(u.is_private,true)=false and coalesce(u.suspended,false)=false limit 1 $function$
;
CREATE OR REPLACE FUNCTION public.list_public_post_sitemap(p_after text DEFAULT ''::text, p_limit integer DEFAULT 1000)
 RETURNS TABLE(short_code text, media_type text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select l.code, p.media_type, p.created_at
  from public.post_short_links l
  join public.posts p on p.id = l.post_id
  join public.profiles u on u.id = p.user_id
  where l.code > coalesce(p_after, '')
    and p.visibility = 'public'
    and coalesce(p.is_deleted, false) = false
    and coalesce(p.is_hidden, false) = false
    and coalesce(u.is_private, true) = false
    and coalesce(u.suspended, false) = false
    and nullif(trim(coalesce(u.username, '')), '') is not null
  order by l.code
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
$function$
;
CREATE OR REPLACE FUNCTION public.authorize_protected_asset(p_asset uuid, p_viewer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT p_viewer IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.post_media_assets a
  JOIN public.posts p ON p.id=a.post_id AND p.user_id=a.owner_id
  JOIN public.profiles owner_profile ON owner_profile.id=p.user_id
  WHERE a.id=p_asset AND a.status='ready' AND a.delivery_type='authenticated'
   AND p.publishing_state='published' AND p.is_deleted IS FALSE AND p.is_hidden IS FALSE
   AND owner_profile.suspended IS FALSE
   AND jsonb_typeof(p.media)='array'
   AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p.media) m
    WHERE m->>'asset_id'=a.id::text OR m->>'thumbnail_asset_id'=a.id::text
   )
   AND (
    p.user_id=p_viewer
    OR (p.visibility='followers' AND privacy_v2_private.approved_edge(p_viewer,p.user_id))
    OR (p.visibility='friends' AND privacy_v2_private.approved_edge(p_viewer,p.user_id)
      AND privacy_v2_private.approved_edge(p.user_id,p_viewer))
   )
 );
$function$
;
CREATE OR REPLACE FUNCTION public.search_posts(query text, limit_count integer DEFAULT 20)
 RETURNS TABLE(id uuid, title text, content text, created_at timestamp with time zone, display_name text, username text, avatar_url text, verified_status text, relevance real)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 RETURN QUERY SELECT p.id,p.title,p.content,p.created_at,pr.display_name,pr.username,pr.avatar_url,pr.verified_status,
 ts_rank_cd(to_tsvector('english',COALESCE(p.title,'')||' '||COALESCE(p.content,'')),plainto_tsquery('english',query)) AS relevance
 FROM public.posts p JOIN public.profiles pr ON p.user_id=pr.id
 WHERE p.is_deleted IS FALSE AND p.is_hidden IS FALSE AND p.visibility='public'
 AND pr.is_private IS FALSE AND pr.suspended IS FALSE
 AND to_tsvector('english',COALESCE(p.title,'')||' '||COALESCE(p.content,'')) @@ plainto_tsquery('english',query)
 ORDER BY relevance DESC LIMIT LEAST(GREATEST(COALESCE(limit_count,20),1),100);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_sound_stats(p_sound_id text)
 RETURNS TABLE(video_count bigint, total_uses bigint, total_likes bigint, total_shares bigint)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  select
    count(*) filter (where p.sound_id = p_sound_id) as video_count,
    coalesce((select usage_count from sounds where id = p_sound_id), 0) as total_uses,
    coalesce(sum(p.like_count) filter (where p.sound_id = p_sound_id), 0) as total_likes,
    coalesce(sum(p.share_count) filter (where p.sound_id = p_sound_id), 0) as total_shares
  from posts p
  where p.sound_id = p_sound_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_bookmarks()
 RETURNS TABLE(post_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY SELECT bookmarks.post_id FROM bookmarks WHERE user_id = auth.uid() ORDER BY created_at DESC;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_notifications(limit_count integer DEFAULT 20, offset_count integer DEFAULT 0)
 RETURNS TABLE(id bigint, type text, actor_id uuid, actor_name text, actor_avatar text, post_id uuid, comment_id uuid, read boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    n.id,
    n.type,
    n.actor_id,
    pr.display_name AS actor_name,
    pr.avatar_url AS actor_avatar,
    n.post_id,
    n.comment_id,
    n.read,
    n.created_at
  FROM notifications n
  LEFT JOIN profiles pr ON n.actor_id = pr.id
  WHERE n.receiver_id = auth.uid()
  ORDER BY n.created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.add_view(p_post_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_session_id text DEFAULT NULL::text)
 RETURNS TABLE(counted boolean, views bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_auth_user_id uuid;
  v_lock_key bigint;
  v_last_view timestamptz;
  v_counted boolean := false;
  v_views bigint := 0;
  v_session_id text;
BEGIN
  -- ==============================================================
  -- VALIDATE POST
  -- ==============================================================
  IF p_post_id IS NULL THEN
    RETURN QUERY SELECT false, 0::bigint;
    RETURN;
  END IF;

  -- ==============================================================
  -- HARDEN p_user_id: never trust a caller-supplied UUID as proof
  -- of identity. This function is SECURITY DEFINER, so an arbitrary
  -- p_user_id could otherwise be used to inflate/attribute views to
  -- any account. auth.uid() is the actual verified identity of the
  -- Supabase session making the call.
  -- ==============================================================
  v_auth_user_id := auth.uid();

  -- ==============================================================
  -- NO VIEWER IDENTITY AT ALL — nothing to dedupe against
  -- ==============================================================
  v_session_id := NULLIF(trim(COALESCE(p_session_id, '')), '');

  IF v_auth_user_id IS NULL AND v_session_id IS NULL THEN
    -- ─── FIX: qualify posts.views with alias "p" to avoid ambiguity
    -- with the RETURNS TABLE output column also named "views" ───────
    SELECT COALESCE(p.views, 0) INTO v_views FROM public.posts p WHERE p.id = p_post_id;
    RETURN QUERY SELECT false, v_views;
    RETURN;
  END IF;

  -- ==============================================================
  -- ADVISORY LOCK per (post, viewer)
  -- ==============================================================
  v_lock_key := hashtextextended(
    p_post_id::text || ':' || COALESCE(v_auth_user_id::text, v_session_id),
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ==============================================================
  -- FIND THIS VIEWER'S LAST VIEW OF THIS POST
  -- ==============================================================
  IF v_auth_user_id IS NOT NULL THEN
    SELECT MAX(pv.viewed_at) INTO v_last_view
    FROM public.post_views pv
    WHERE pv.post_id = p_post_id AND pv.user_id = v_auth_user_id;
  ELSE
    SELECT MAX(pv.viewed_at) INTO v_last_view
    FROM public.post_views pv
    WHERE pv.post_id = p_post_id AND pv.session_id = v_session_id;
  END IF;

  -- ==============================================================
  -- EXACT ROLLING 24-HOUR WINDOW
  -- ==============================================================
  IF v_last_view IS NULL OR v_last_view <= now() - interval '24 hours' THEN
    INSERT INTO public.post_views (post_id, user_id, session_id, viewed_at)
    VALUES (
      p_post_id,
      v_auth_user_id,
      CASE WHEN v_auth_user_id IS NULL THEN v_session_id ELSE NULL END,
      now()
    );

    -- ─── FIX: qualify BOTH sides — target column via alias "p" so
    -- "views" inside COALESCE(views, 0) can't resolve to the
    -- RETURNS TABLE output variable "views" instead of the column ───
    UPDATE public.posts AS p
    SET views = COALESCE(p.views, 0) + 1
    WHERE p.id = p_post_id;

    v_counted := true;
  END IF;

  -- ==============================================================
  -- RETURN AUTHORITATIVE COUNT
  -- ─── FIX: qualified here too, for the same reason ─────────────
  -- ==============================================================
  SELECT COALESCE(p.views, 0) INTO v_views FROM public.posts p WHERE p.id = p_post_id;

  RETURN QUERY SELECT v_counted, v_views;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.record_share(p_post_id uuid, p_user_id uuid)
 RETURNS TABLE(already_shared boolean, count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_exists boolean; v_count integer;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
  RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.posts p
  WHERE p.id=p_post_id AND p.is_deleted IS FALSE AND p.is_hidden IS FALSE
  AND p.visibility='public'
  AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id=p.user_id
    AND pr.suspended IS FALSE AND (pr.is_private IS FALSE OR p.user_id=auth.uid()
    OR EXISTS(SELECT 1 FROM public.follows f WHERE f.follower_id=auth.uid()
    AND f.following_id=p.user_id AND f.status='active')))
 ) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.shares s WHERE s.post_id=p_post_id AND s.user_id=p_user_id) INTO v_exists;
 IF v_exists THEN
  SELECT p.share_count INTO v_count FROM public.posts p WHERE p.id=p_post_id;
  RETURN QUERY SELECT true,v_count;
 ELSE
  INSERT INTO public.shares(post_id,user_id,created_at) VALUES(p_post_id,p_user_id,now())
  ON CONFLICT (user_id,post_id) DO NOTHING;
  IF FOUND THEN
   UPDATE public.posts p SET share_count=COALESCE(p.share_count,0)+1 WHERE p.id=p_post_id RETURNING p.share_count INTO v_count;
   RETURN QUERY SELECT false,v_count;
  ELSE
   SELECT p.share_count INTO v_count FROM public.posts p WHERE p.id=p_post_id;
   RETURN QUERY SELECT true,v_count;
  END IF;
 END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.toggle_bookmark(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  exists_bookmark BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT EXISTS(SELECT 1 FROM bookmarks WHERE post_id = p_post_id AND user_id = v_user_id)
  INTO exists_bookmark;
  IF exists_bookmark THEN
    DELETE FROM bookmarks WHERE post_id = p_post_id AND user_id = v_user_id;
  ELSE
    INSERT INTO bookmarks (post_id, user_id) VALUES (p_post_id, v_user_id);
  END IF;
  RETURN NOT exists_bookmark;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.toggle_bookmark(p_post_id uuid, p_user_id uuid)
 RETURNS TABLE(bookmarked boolean, count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_exists boolean; v_count integer;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
  RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.bookmarks b WHERE b.post_id=p_post_id AND b.user_id=p_user_id) INTO v_exists;
 IF v_exists THEN
  DELETE FROM public.bookmarks b WHERE b.post_id=p_post_id AND b.user_id=p_user_id;
  UPDATE public.posts p SET bookmark_count=greatest(0,coalesce(p.bookmark_count,0)-1) WHERE p.id=p_post_id RETURNING p.bookmark_count INTO v_count;
  RETURN QUERY SELECT false,v_count;
 ELSE
  INSERT INTO public.bookmarks(post_id,user_id,created_at) VALUES(p_post_id,p_user_id,now());
  UPDATE public.posts p SET bookmark_count=coalesce(p.bookmark_count,0)+1 WHERE p.id=p_post_id RETURNING p.bookmark_count INTO v_count;
  RETURN QUERY SELECT true,v_count;
 END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.toggle_comment_like(p_comment_id uuid)
 RETURNS TABLE(liked boolean, new_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_exists boolean;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (select 1 from comments where id = p_comment_id) then
    raise exception 'Comment not found';
  end if;

  select exists(
    select 1 from comment_likes where comment_id = p_comment_id and user_id = v_user_id
  ) into v_exists;

  if v_exists then
    delete from comment_likes where comment_id = p_comment_id and user_id = v_user_id;
    update comments set like_count = greatest(0, like_count - 1) where id = p_comment_id returning like_count into v_count;
    return query select false, v_count;
  else
    insert into comment_likes (comment_id, user_id) values (p_comment_id, v_user_id);
    update comments set like_count = like_count + 1 where id = p_comment_id returning like_count into v_count;
    return query select true, v_count;
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.toggle_comment_like(p_comment_id uuid, p_user_id uuid)
 RETURNS TABLE(liked boolean, count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_exists boolean; v_count integer;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
  RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.comment_likes cl WHERE cl.comment_id=p_comment_id AND cl.user_id=p_user_id) INTO v_exists;
 IF v_exists THEN
  DELETE FROM public.comment_likes cl WHERE cl.comment_id=p_comment_id AND cl.user_id=p_user_id;
  UPDATE public.comments c SET like_count=greatest(0,coalesce(c.like_count,0)-1) WHERE c.id=p_comment_id RETURNING c.like_count INTO v_count;
  RETURN QUERY SELECT false,v_count;
 ELSE
  INSERT INTO public.comment_likes(comment_id,user_id,created_at) VALUES(p_comment_id,p_user_id,now());
  UPDATE public.comments c SET like_count=coalesce(c.like_count,0)+1 WHERE c.id=p_comment_id RETURNING c.like_count INTO v_count;
  RETURN QUERY SELECT true,v_count;
 END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.toggle_post_like(p_post_id uuid)
 RETURNS TABLE(liked boolean, new_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  exists_like boolean;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (select 1 from posts where id = p_post_id) then
    raise exception 'Post not found';
  end if;

  select exists(
    select 1 from post_likes where post_id = p_post_id and user_id = v_user_id
  ) into exists_like;

  if exists_like then
    delete from post_likes where post_id = p_post_id and user_id = v_user_id;
    update posts set like_count = greatest(0, like_count - 1) where id = p_post_id returning like_count into v_count;
    return query select false, v_count;
  else
    insert into post_likes (post_id, user_id) values (p_post_id, v_user_id);
    update posts set like_count = like_count + 1 where id = p_post_id returning like_count into v_count;
    return query select true, v_count;
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.toggle_repost(p_post_id uuid, p_comment text DEFAULT ''::text)
 RETURNS TABLE(reposted boolean, new_count integer, repost_comment text, reposted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_exists boolean;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (select 1 from posts where id = p_post_id) then
    raise exception 'Post not found';
  end if;

  select exists(
    select 1 from reposts where post_id = p_post_id and user_id = v_user_id
  ) into v_exists;

  if v_exists then
    delete from reposts where post_id = p_post_id and user_id = v_user_id;
    update posts set repost_count = greatest(0, repost_count - 1) where id = p_post_id returning repost_count into v_count;
    return query select false, v_count, ''::text, null::timestamptz;
  else
    insert into reposts (post_id, user_id, comment) values (p_post_id, v_user_id, coalesce(p_comment, ''));
    update posts set repost_count = repost_count + 1 where id = p_post_id returning repost_count into v_count;
    return query select true, v_count, coalesce(p_comment, ''), now();
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.toggle_repost(p_post_id uuid, p_user_id uuid, p_comment text DEFAULT ''::text)
 RETURNS TABLE(reposted boolean, count integer, out_comment text, out_time timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_exists boolean; v_count integer; v_time timestamptz;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
  RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.reposts r WHERE r.post_id=p_post_id AND r.user_id=p_user_id) INTO v_exists;
 IF v_exists THEN
  DELETE FROM public.reposts r WHERE r.post_id=p_post_id AND r.user_id=p_user_id;
  UPDATE public.posts p SET repost_count=greatest(0,coalesce(p.repost_count,0)-1) WHERE p.id=p_post_id RETURNING p.repost_count INTO v_count;
  RETURN QUERY SELECT false,v_count,''::text,null::timestamptz;
 ELSE
  v_time:=now();
  INSERT INTO public.reposts(post_id,user_id,comment,created_at) VALUES(p_post_id,p_user_id,coalesce(p_comment,''),v_time);
  UPDATE public.posts p SET repost_count=coalesce(p.repost_count,0)+1 WHERE p.id=p_post_id RETURNING p.repost_count INTO v_count;
  RETURN QUERY SELECT true,v_count,coalesce(p_comment,''),v_time;
 END IF;
END $function$
;
CREATE OR REPLACE FUNCTION privacy_v2_private.restricted_notification_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.posts%rowtype; parent_id uuid;
BEGIN
 parent_id:=NEW.post_id;
 IF parent_id IS NULL AND NEW.comment_id IS NOT NULL THEN
  SELECT post_id INTO parent_id FROM public.comments WHERE id=NEW.comment_id;
 END IF;
 IF parent_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO p FROM public.posts WHERE id=parent_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF p.visibility='public' THEN RETURN NEW; END IF;
 IF p.publishing_state<>'published' OR p.is_hidden IS DISTINCT FROM false OR p.is_deleted IS DISTINCT FROM false
 OR NOT (p.user_id=NEW.receiver_id OR
  (p.visibility='followers' AND privacy_v2_private.approved_edge(NEW.receiver_id,p.user_id)) OR
  (p.visibility='friends' AND privacy_v2_private.approved_edge(NEW.receiver_id,p.user_id) AND privacy_v2_private.approved_edge(p.user_id,NEW.receiver_id)))
 THEN RETURN NULL; END IF;
 NEW.post_id:=parent_id;
 RETURN NEW;
END $function$
;
DROP FUNCTION IF EXISTS privacy_v2_private.session_post_readable(uuid);
DROP POLICY IF EXISTS posts_hide_all_posts_boundary ON public.posts;
DROP POLICY "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile" ON public.profiles FOR UPDATE TO public
 USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_admin=true));
COMMIT;
