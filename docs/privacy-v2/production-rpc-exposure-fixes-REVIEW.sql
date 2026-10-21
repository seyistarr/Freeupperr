-- REVIEW ONLY: catalog-backed fixes, not executed against production.
-- Apply AFTER production-boundaries, production-follow-approval and audience RLS review migrations.
-- Source fingerprint checks deliberately abort on schema/function drift.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'jmjtqidirpmnegzvmiaq'
 OR current_setting('freeupper.privacy_v2_reviewed_release',true) IS DISTINCT FROM 'approved-production-migration'
 THEN RAISE EXCEPTION 'Explicit production migration approval required'; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION privacy_v2_private.can_view_post_for(p_id uuid,p_viewer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.posts p JOIN public.profiles a ON a.id=p.user_id
 WHERE p.id=p_id AND p.publishing_state='published' AND p.is_hidden=false AND p.is_deleted=false AND a.suspended=false AND
 (p.user_id=p_viewer OR (p.visibility='public' AND a.is_private=false) OR
 (p.visibility IN ('public','followers','friends') AND privacy_v2_private.approved_edge(p_viewer,p.user_id) AND
 (p.visibility<>'friends' OR privacy_v2_private.approved_edge(p.user_id,p_viewer)))))
$$;
REVOKE ALL ON FUNCTION privacy_v2_private.can_view_post_for(uuid,uuid) FROM PUBLIC,anon,authenticated;
-- Explicit predicates remain effective inside legacy SECURITY DEFINER bodies.
-- They never use caller-supplied p_user_id as authentication.
DO $$ BEGIN IF to_regprocedure('public.toggle_post_like(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.toggle_post_like(uuid)'))) <> 'fbb2f7d332a90ceb5fdd426fb68785dd' THEN RAISE EXCEPTION 'Review source drift: toggle_post_like(uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.toggle_post_like(p_post_id uuid)
 RETURNS TABLE(liked boolean, new_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp

AS $function$
declare
  v_user_id uuid := auth.uid();
  exists_like boolean;
  v_count integer;
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF NOT privacy_v2_private.can_view_post_for(p_post_id,auth.uid()) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501'; END IF;
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
$function$;

REVOKE ALL ON FUNCTION public.toggle_post_like(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_post_like(uuid) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.toggle_repost(uuid,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.toggle_repost(uuid,text)'))) <> 'ad49556620ad15e6fb10587fed2e9a93' THEN RAISE EXCEPTION 'Review source drift: toggle_repost(uuid,text)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.toggle_repost(p_post_id uuid, p_comment text DEFAULT ''::text)
 RETURNS TABLE(reposted boolean, new_count integer, repost_comment text, reposted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp

AS $function$
declare
  v_user_id uuid := auth.uid();
  v_exists boolean;
  v_count integer;
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF NOT privacy_v2_private.can_view_post_for(p_post_id,auth.uid()) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.posts WHERE id=p_post_id AND visibility='public') THEN RAISE EXCEPTION 'Restricted redistribution disabled'; END IF;
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
$function$;

REVOKE ALL ON FUNCTION public.toggle_repost(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_repost(uuid,text) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.toggle_repost(uuid,uuid,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.toggle_repost(uuid,uuid,text)'))) <> 'e8be32456087abc1138b9108f601c456' THEN RAISE EXCEPTION 'Review source drift: toggle_repost(uuid,uuid,text)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.toggle_repost(p_post_id uuid, p_user_id uuid, p_comment text DEFAULT ''::text)
 RETURNS TABLE(reposted boolean, count integer, out_comment text, out_time timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
declare
  v_exists boolean;
  v_count int;
  v_time timestamptz;
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Session identity mismatch' USING ERRCODE='42501'; END IF;
  IF NOT privacy_v2_private.can_view_post_for(p_post_id,auth.uid()) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.posts WHERE id=p_post_id AND visibility='public') THEN RAISE EXCEPTION 'Restricted redistribution disabled'; END IF;
select exists(
    select 1 from reposts where post_id = p_post_id and user_id = p_user_id
  ) into v_exists;

  if v_exists then
    delete from reposts where post_id = p_post_id and user_id = p_user_id;
    update posts set repost_count = greatest(0, repost_count - 1) where id = p_post_id
      returning repost_count into v_count;
    return query select false, v_count, ''::text, null::timestamptz;
  else
    v_time := now();
    insert into reposts (post_id, user_id, comment, created_at)
      values (p_post_id, p_user_id, coalesce(p_comment, ''), v_time);
    update posts set repost_count = repost_count + 1 where id = p_post_id
      returning repost_count into v_count;
    return query select true, v_count, coalesce(p_comment, ''), v_time;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.toggle_repost(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_repost(uuid,uuid,text) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.toggle_bookmark(uuid,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.toggle_bookmark(uuid,uuid)'))) <> '9472ac448320140be8324ac1eeb84e7e' THEN RAISE EXCEPTION 'Review source drift: toggle_bookmark(uuid,uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.toggle_bookmark(p_post_id uuid, p_user_id uuid)
 RETURNS TABLE(bookmarked boolean, count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
declare
  v_exists boolean;
  v_count int;
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Session identity mismatch' USING ERRCODE='42501'; END IF;
  IF NOT privacy_v2_private.can_view_post_for(p_post_id,auth.uid()) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501'; END IF;
select exists(
    select 1 from bookmarks where post_id = p_post_id and user_id = p_user_id
  ) into v_exists;

  if v_exists then
    delete from bookmarks where post_id = p_post_id and user_id = p_user_id;
    update posts set bookmark_count = greatest(0, bookmark_count - 1) where id = p_post_id
      returning bookmark_count into v_count;
    return query select false, v_count;
  else
    insert into bookmarks (post_id, user_id, created_at) values (p_post_id, p_user_id, now());
    update posts set bookmark_count = bookmark_count + 1 where id = p_post_id
      returning bookmark_count into v_count;
    return query select true, v_count;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.toggle_bookmark(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_bookmark(uuid,uuid) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.record_share(uuid,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.record_share(uuid,uuid)'))) <> '794bd3ebbbb49d97db9f65a7ddcc90fd' THEN RAISE EXCEPTION 'Review source drift: record_share(uuid,uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.record_share(p_post_id uuid, p_user_id uuid)
 RETURNS TABLE(already_shared boolean, count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp

AS $function$
DECLARE v_exists boolean; v_count integer;
BEGIN

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Session identity mismatch' USING ERRCODE='42501'; END IF;
  IF NOT privacy_v2_private.can_view_post_for(p_post_id,auth.uid()) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501'; END IF;
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
$function$;

REVOKE ALL ON FUNCTION public.record_share(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_share(uuid,uuid) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.add_view(uuid,uuid,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.add_view(uuid,uuid,text)'))) <> '481913a53a376fdd936fb3653ff13062' THEN RAISE EXCEPTION 'Review source drift: add_view(uuid,uuid,text)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.add_view(p_post_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_session_id text DEFAULT NULL::text)
 RETURNS TABLE(counted boolean, views bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp

AS $function$
DECLARE
  v_auth_user_id uuid;
  v_lock_key bigint;
  v_last_view timestamptz;
  v_counted boolean := false;
  v_views bigint := 0;
  v_session_id text;
BEGIN

  IF p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Session identity mismatch' USING ERRCODE='42501'; END IF;
  IF NOT privacy_v2_private.can_view_post_for(p_post_id,auth.uid()) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501'; END IF;
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
$function$;

REVOKE ALL ON FUNCTION public.add_view(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_view(uuid,uuid,text) TO anon,authenticated;
DO $$ BEGIN IF to_regprocedure('public.increment_comment_count(uuid,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.increment_comment_count(uuid,uuid)'))) <> '6dcc04be33545826b937124c68c3f573' THEN RAISE EXCEPTION 'Review source drift: increment_comment_count(uuid,uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.increment_comment_count(p_post_id uuid, p_parent_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF NOT privacy_v2_private.can_view_post_for(p_post_id,auth.uid()) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501'; END IF;
  IF p_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.comments WHERE id=p_parent_id AND post_id=p_post_id) THEN RAISE EXCEPTION 'Parent mismatch'; END IF;
update posts set comment_count = comment_count + 1 where id = p_post_id;

  if p_parent_id is not null then
    update comments set reply_count = reply_count + 1 where id = p_parent_id;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.increment_comment_count(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.increment_comment_count(uuid,uuid) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.decrement_comment_count(uuid,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.decrement_comment_count(uuid,uuid)'))) <> '122f7dbc8980c024a5499927ba95ba05' THEN RAISE EXCEPTION 'Review source drift: decrement_comment_count(uuid,uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.decrement_comment_count(p_post_id uuid, p_parent_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF NOT privacy_v2_private.can_view_post_for(p_post_id,auth.uid()) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501'; END IF;
  IF p_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.comments WHERE id=p_parent_id AND post_id=p_post_id) THEN RAISE EXCEPTION 'Parent mismatch'; END IF;
update posts set comment_count = greatest(0, comment_count - 1) where id = p_post_id;

  if p_parent_id is not null then
    update comments set reply_count = greatest(0, reply_count - 1) where id = p_parent_id;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.decrement_comment_count(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_comment_count(uuid,uuid) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.create_original_sound_for_post(uuid,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.create_original_sound_for_post(uuid,text,text,text)'))) <> '6e127563d0e08e80cf11c026d4e2c338' THEN RAISE EXCEPTION 'Review source drift: create_original_sound_for_post(uuid,text,text,text)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.create_original_sound_for_post(p_post_id uuid, p_audio_url text, p_art_url text DEFAULT NULL::text, p_title text DEFAULT NULL::text)
 RETURNS sounds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp

AS $function$
declare
  v_user_id uuid := auth.uid();
  v_post public.posts%rowtype;
  v_sound public.sounds%rowtype;
  v_profile public.profiles%rowtype;
  v_title text;
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF NOT privacy_v2_private.can_view_post_for(p_post_id,auth.uid()) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.posts WHERE id=p_post_id AND visibility='public') THEN RAISE EXCEPTION 'Restricted redistribution disabled'; END IF;
if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_post_id is null or nullif(trim(p_audio_url), '') is null then
    raise exception 'Post ID and audio URL are required';
  end if;

  select *
  into v_post
  from public.posts
  where id = p_post_id
    and user_id = v_user_id
    and media_type = 'video';

  if not found then
    raise exception 'Video post not found or not owned by current user';
  end if;

  if v_post.sound_id is not null then
    select * into v_sound from public.sounds where id = v_post.sound_id;
    if found then return v_sound; end if;
  end if;

  select *
  into v_sound
  from public.sounds
  where source_post_id = p_post_id
  limit 1;

  if found then
    update public.posts
    set sound_id = v_sound.id
    where id = p_post_id and user_id = v_user_id;
    return v_sound;
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id;

  v_title := coalesce(
    nullif(trim(p_title), ''),
    'Original sound · ' ||
    coalesce(
      nullif(v_profile.display_name, ''),
      nullif(v_profile.username, ''),
      'FreeUpper user'
    )
  );

  insert into public.sounds (
    title,
    artist_name,
    audio_url,
    art_url,
    created_by,
    source_post_id,
    sound_type,
    is_original,
    status,
    usage_count
  )
  values (
    v_title,
    coalesce(
      nullif(v_profile.display_name, ''),
      nullif(v_profile.username, ''),
      'FreeUpper user'
    ),
    p_audio_url,
    p_art_url,
    v_user_id,
    p_post_id,
    'original',
    true,
    'active',
    1
  )
  returning * into v_sound;

  update public.posts
  set sound_id = v_sound.id
  where id = p_post_id and user_id = v_user_id;

  return v_sound;
end;
$function$;

REVOKE ALL ON FUNCTION public.create_original_sound_for_post(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_original_sound_for_post(uuid,text,text,text) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.toggle_comment_like(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.toggle_comment_like(uuid)'))) <> '0cab8b8909ffb25f168e0ccbccf65869' THEN RAISE EXCEPTION 'Review source drift: toggle_comment_like(uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.toggle_comment_like(p_comment_id uuid)
 RETURNS TABLE(liked boolean, new_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp

AS $function$
declare
  v_user_id uuid := auth.uid();
  v_exists boolean;
  v_count integer;
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comments c WHERE c.id=p_comment_id AND c.is_deleted=false AND privacy_v2_private.can_view_post_for(c.post_id,auth.uid())) THEN RAISE EXCEPTION 'Comment unavailable' USING ERRCODE='42501'; END IF;
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
$function$;

REVOKE ALL ON FUNCTION public.toggle_comment_like(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_comment_like(uuid) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.toggle_comment_like(uuid,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.toggle_comment_like(uuid,uuid)'))) <> '7ca5c8498417ccdfaedd30ce643c5b6d' THEN RAISE EXCEPTION 'Review source drift: toggle_comment_like(uuid,uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.toggle_comment_like(p_comment_id uuid, p_user_id uuid)
 RETURNS TABLE(liked boolean, count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
declare
  v_exists boolean;
  v_count int;
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Session identity mismatch' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comments c WHERE c.id=p_comment_id AND c.is_deleted=false AND privacy_v2_private.can_view_post_for(c.post_id,auth.uid())) THEN RAISE EXCEPTION 'Comment unavailable' USING ERRCODE='42501'; END IF;
select exists(
    select 1 from comment_likes where comment_id = p_comment_id and user_id = p_user_id
  ) into v_exists;

  if v_exists then
    delete from comment_likes where comment_id = p_comment_id and user_id = p_user_id;
    update comments set like_count = greatest(0, like_count - 1) where id = p_comment_id
      returning like_count into v_count;
    return query select false, v_count;
  else
    insert into comment_likes (comment_id, user_id, created_at) values (p_comment_id, p_user_id, now());
    update comments set like_count = like_count + 1 where id = p_comment_id
      returning like_count into v_count;
    return query select true, v_count;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.toggle_comment_like(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_comment_like(uuid,uuid) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.edit_comment(uuid,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.edit_comment(uuid,text)'))) <> 'b74b248b832d855bb7396a5056a0a313' THEN RAISE EXCEPTION 'Review source drift: edit_comment(uuid,text)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.edit_comment(p_comment_id uuid, p_message text)
 RETURNS comments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp

AS $function$
DECLARE
  updated_comment comments;
BEGIN

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comments c WHERE c.id=p_comment_id AND c.is_deleted=false AND privacy_v2_private.can_view_post_for(c.post_id,auth.uid())) THEN RAISE EXCEPTION 'Comment unavailable' USING ERRCODE='42501'; END IF;
IF NOT EXISTS (SELECT 1 FROM comments WHERE id = p_comment_id AND user_id = auth.uid() AND is_deleted = false) THEN
    RAISE EXCEPTION 'Comment not found or not owned';
  END IF;
  IF p_message IS NULL OR trim(p_message) = '' THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;
  UPDATE comments
  SET
    message = p_message,
    edited_at = now(),
    version = version + 1
  WHERE id = p_comment_id
  RETURNING * INTO updated_comment;
  RETURN updated_comment;
END;
$function$;

REVOKE ALL ON FUNCTION public.edit_comment(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_comment(uuid,text) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.edit_comment(uuid,uuid,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.edit_comment(uuid,uuid,text)'))) <> 'e1e4f71d170b01149996d08e7bfcbcab' THEN RAISE EXCEPTION 'Review source drift: edit_comment(uuid,uuid,text)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.edit_comment(p_comment_id uuid, p_user_id uuid, p_message text)
 RETURNS TABLE(id uuid, message text, updated_at timestamp with time zone, edited boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
declare
  v_owner_id uuid;
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Session identity mismatch' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comments c WHERE c.id=p_comment_id AND c.is_deleted=false AND privacy_v2_private.can_view_post_for(c.post_id,auth.uid())) THEN RAISE EXCEPTION 'Comment unavailable' USING ERRCODE='42501'; END IF;
select c.user_id into v_owner_id from public.comments c where c.id = p_comment_id;

  if v_owner_id is null then
    raise exception 'Comment not found.';
  end if;

  if v_owner_id != p_user_id then
    raise exception 'You do not have permission to edit this comment.';
  end if;

  if trim(coalesce(p_message, '')) = '' then
    raise exception 'Comment cannot be empty.';
  end if;

  return query
    update comments
    set message = trim(p_message),
        updated_at = now(),
        edited = true
    where comments.id = p_comment_id
    returning comments.id, comments.message, comments.updated_at, comments.edited;
end;
$function$;

REVOKE ALL ON FUNCTION public.edit_comment(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_comment(uuid,uuid,text) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.delete_comment(uuid,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.delete_comment(uuid,uuid)'))) <> '7e832d23b9310376290bcd9c113898e3' THEN RAISE EXCEPTION 'Review source drift: delete_comment(uuid,uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.delete_comment(p_comment_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
declare
  v_post_id uuid;
  v_parent_id uuid;
  v_owner_id uuid;
  v_post_owner_id uuid;
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Session identity mismatch' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comments c WHERE c.id=p_comment_id AND c.is_deleted=false AND privacy_v2_private.can_view_post_for(c.post_id,auth.uid())) THEN RAISE EXCEPTION 'Comment unavailable' USING ERRCODE='42501'; END IF;
select post_id, parent_id, user_id
    into v_post_id, v_parent_id, v_owner_id
    from comments
    where id = p_comment_id;

  if v_owner_id is null then
    raise exception 'Comment not found.';
  end if;

  select user_id into v_post_owner_id from posts where id = v_post_id;

  -- Only the comment's author OR the post's owner may delete it.
  if v_owner_id != p_user_id and v_post_owner_id != p_user_id then
    raise exception 'You do not have permission to delete this comment.';
  end if;

  -- Clean up replies-of-this-comment first (and their likes)
  delete from comment_likes where comment_id in (
    select id from comments where parent_id = p_comment_id
  );
  delete from comments where parent_id = p_comment_id;

  -- Clean up this comment's own likes, then the comment itself
  delete from comment_likes where comment_id = p_comment_id;
  delete from comments where id = p_comment_id;

  perform decrement_comment_count(v_post_id, v_parent_id);
end;
$function$;

REVOKE ALL ON FUNCTION public.delete_comment(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_comment(uuid,uuid) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.toggle_pin_comment(uuid,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.toggle_pin_comment(uuid,uuid)'))) <> '318a14f188080e3c0d9249ea0b6078ea' THEN RAISE EXCEPTION 'Review source drift: toggle_pin_comment(uuid,uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.toggle_pin_comment(p_comment_id uuid, p_user_id uuid)
 RETURNS TABLE(pinned boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
declare
  v_post_id uuid;
  v_post_owner_id uuid;
  v_currently_pinned boolean;
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Session identity mismatch' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comments c WHERE c.id=p_comment_id AND c.is_deleted=false AND privacy_v2_private.can_view_post_for(c.post_id,auth.uid())) THEN RAISE EXCEPTION 'Comment unavailable' USING ERRCODE='42501'; END IF;
select c.post_id, c.pinned into v_post_id, v_currently_pinned
    from public.comments c where c.id = p_comment_id;

  if v_post_id is null then
    raise exception 'Comment not found.';
  end if;

  select user_id into v_post_owner_id from posts where id = v_post_id;

  if v_post_owner_id != p_user_id then
    raise exception 'Only the post owner can pin comments.';
  end if;

  if v_currently_pinned then
    -- Unpin
    update comments set pinned = false where id = p_comment_id;
    return query select false;
  else
    -- Unpin any existing pinned comment on this post, then pin this one
    update comments set pinned = false where post_id = v_post_id and comments.pinned = true;
    update comments set pinned = true where id = p_comment_id;
    return query select true;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.toggle_pin_comment(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_pin_comment(uuid,uuid) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.search_posts(text,integer)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.search_posts(text,integer)'))) <> 'a7ad69d7e005d8143be2b9856a725a24' THEN RAISE EXCEPTION 'Review source drift: search_posts(text,integer)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.search_posts(query text, limit_count integer DEFAULT 20)
 RETURNS TABLE(id uuid, title text, content text, created_at timestamp with time zone, display_name text, username text, avatar_url text, verified_status text, relevance real)
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
BEGIN
 RETURN QUERY SELECT p.id,p.title,p.content,p.created_at,pr.display_name,pr.username,pr.avatar_url,pr.verified_status,
 ts_rank_cd(to_tsvector('english',COALESCE(p.title,'')||' '||COALESCE(p.content,'')),plainto_tsquery('english',query)) AS relevance
 FROM public.posts p JOIN public.profiles pr ON p.user_id=pr.id
 WHERE p.publishing_state='published' AND p.is_deleted IS FALSE AND p.is_hidden IS FALSE AND p.visibility='public'
 AND pr.is_private IS FALSE AND pr.suspended IS FALSE
 AND to_tsvector('english',COALESCE(p.title,'')||' '||COALESCE(p.content,'')) @@ plainto_tsquery('english',query)
 ORDER BY relevance DESC LIMIT LEAST(GREATEST(COALESCE(limit_count,20),1),100);
END;
$function$;

REVOKE ALL ON FUNCTION public.search_posts(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_posts(text,integer) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.get_public_short_code_for_post(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.get_public_short_code_for_post(uuid)'))) <> '3d6864889f626c2b3e715e3815d4e53a' THEN RAISE EXCEPTION 'Review source drift: get_public_short_code_for_post(uuid)'; END IF; END $$;
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
    and p.publishing_state = 'published' and u.suspended IS FALSE and p.visibility = 'public'
    and coalesce(p.is_deleted, false) = false
    and coalesce(p.is_hidden, false) = false
    and coalesce(u.is_private, true) = false
  limit 1
$function$;

REVOKE ALL ON FUNCTION public.get_public_short_code_for_post(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_short_code_for_post(uuid) TO anon,authenticated;
DO $$ BEGIN IF to_regprocedure('public.get_public_post_by_short_code(text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.get_public_post_by_short_code(text)'))) <> 'd39b61821e17b3f55bce3da1b05359ff' THEN RAISE EXCEPTION 'Review source drift: get_public_post_by_short_code(text)'; END IF; END $$;
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
    and p.publishing_state = 'published' and u.suspended IS FALSE and p.visibility = 'public'
    and coalesce(p.is_deleted, false) = false
    and coalesce(p.is_hidden, false) = false
    and coalesce(u.is_private, true) = false
  limit 1
$function$;

REVOKE ALL ON FUNCTION public.get_public_post_by_short_code(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_post_by_short_code(text) TO anon,authenticated;
DO $$ BEGIN IF to_regprocedure('public.get_sound_stats(text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.get_sound_stats(text)'))) <> 'a17e6de582cef43dfe6c26fc6d944ca9' THEN RAISE EXCEPTION 'Review source drift: get_sound_stats(text)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.get_sound_stats(p_sound_id text)
RETURNS TABLE(video_count bigint,total_uses bigint,total_likes bigint,total_shares bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
 SELECT count(*),count(*),coalesce(sum(p.like_count),0),coalesce(sum(p.share_count),0)
 FROM public.posts p WHERE p.sound_id=p_sound_id AND privacy_v2_private.can_view_post_for(p.id,auth.uid())
$function$;

REVOKE ALL ON FUNCTION public.get_sound_stats(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sound_stats(text) TO anon,authenticated;
DO $$ BEGIN IF to_regprocedure('public.parse_mentions(uuid,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.parse_mentions(uuid,text)'))) <> '403f3a03e7ce4865b246e5cfbd8d11d3' THEN RAISE EXCEPTION 'Review source drift: parse_mentions(uuid,text)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.parse_mentions(p_post_id uuid, p_content text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp

AS $function$
DECLARE mention_username text;
BEGIN

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.posts WHERE id=p_post_id AND user_id=auth.uid() AND visibility='public' AND publishing_state='published' AND is_hidden=false AND is_deleted=false) THEN RETURN; END IF;
IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.posts WHERE id = p_post_id AND user_id = auth.uid() AND is_deleted = false
  ) THEN
    RAISE EXCEPTION 'Post not found or not owned';
  END IF;
  DELETE FROM public.mentions WHERE post_id = p_post_id;
  INSERT INTO public.mentions (post_id, mentioned_user_id)
  SELECT DISTINCT p_post_id, pr.id
  FROM regexp_matches(COALESCE(p_content, ''), '@([a-zA-Z0-9_]+)', 'g') AS match
  JOIN public.profiles pr ON lower(pr.username) = lower(match[1])
  ON CONFLICT (post_id, mentioned_user_id) DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.parse_mentions(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.parse_mentions(uuid,text) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.create_mention_notification(uuid,uuid,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.create_mention_notification(uuid,uuid,uuid)'))) <> 'faf176808336c880a80a6059cdde9d11' THEN RAISE EXCEPTION 'Review source drift: create_mention_notification(uuid,uuid,uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.create_mention_notification(p_receiver_id uuid, p_post_id uuid DEFAULT NULL::uuid, p_comment_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp

AS $function$
begin

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_comment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.comments WHERE id=p_comment_id AND user_id=auth.uid()) THEN RETURN; END IF;
  IF p_comment_id IS NULL AND p_post_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.posts WHERE id=p_post_id AND user_id=auth.uid()) THEN RETURN; END IF;
  IF p_post_id IS NOT NULL AND NOT privacy_v2_private.can_view_post_for(p_post_id,p_receiver_id) THEN RETURN; END IF; IF p_comment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.comments c WHERE c.id=p_comment_id AND privacy_v2_private.can_view_post_for(c.post_id,p_receiver_id)) THEN RETURN; END IF;
-- Require an authenticated caller.
    if auth.uid() is null then
        raise exception 'Authentication required';
    end if;

    -- Ignore invalid recipient.
    if p_receiver_id is null then
        return;
    end if;

    -- Never notify a user about their own mention.
    if p_receiver_id = auth.uid() then
        return;
    end if;

    -- A mention notification must point to actual mention data.
    if p_comment_id is not null then
        -- When both IDs are supplied, they must refer to the same post.
        if p_post_id is not null
           and not exists (
               select 1
               from public.comments c
               where c.id = p_comment_id
                 and c.post_id = p_post_id
           )
        then
            return;
        end if;

        -- The recipient must actually be mentioned in this comment.
        if not exists (
            select 1
            from public.comments c
            where c.id = p_comment_id
              and c.mentions @> jsonb_build_array(
                  jsonb_build_object('userId', p_receiver_id::text)
              )
        )
        then
            return;
        end if;

    elsif p_post_id is not null then
        -- The recipient must actually be mentioned in this post.
        if not exists (
            select 1
            from public.posts p
            where p.id = p_post_id
              and p.mentions @> jsonb_build_array(
                  jsonb_build_object('userId', p_receiver_id::text)
              )
        )
        then
            return;
        end if;
    else
        -- A mention notification must reference a post or comment.
        return;
    end if;

    -- Actor is always taken from the authenticated session.
    perform public.create_notification(
        p_receiver_id,
        auth.uid(),
        'mention',
        p_post_id,
        p_comment_id
    );
end;
$function$;

REVOKE ALL ON FUNCTION public.create_mention_notification(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_mention_notification(uuid,uuid,uuid) TO authenticated;

-- Legacy overload previously lacked any caller or ownership authorization.
DO $$ BEGIN IF to_regprocedure('public.delete_comment(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.delete_comment(uuid)'))) <> '3472352a093f96a02efba11bd59fab47' THEN RAISE EXCEPTION 'Review source drift: delete_comment(uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.delete_comment(p_comment_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 PERFORM public.delete_comment(p_comment_id,auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.delete_comment(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_comment(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.increment_view_count(bigint) FROM PUBLIC,anon,authenticated;
-- Central notification helper is internal, never a caller-controlled RPC.
DO $$ BEGIN IF to_regprocedure('public.create_notification(uuid,uuid,text,uuid,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.create_notification(uuid,uuid,text,uuid,uuid)'))) <> '13b62464240ad7f1f9857d68561868f6' THEN RAISE EXCEPTION 'Review source drift: create_notification(uuid,uuid,text,uuid,uuid)'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.create_notification(p_receiver_id uuid,p_actor_id uuid,p_type text,p_post_id uuid DEFAULT NULL,p_comment_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_post uuid=p_post_id;
BEGIN
 IF p_comment_id IS NOT NULL THEN
  SELECT post_id INTO target_post FROM public.comments WHERE id=p_comment_id AND is_deleted=false;
  IF target_post IS NULL OR (p_post_id IS NOT NULL AND p_post_id<>target_post) THEN RETURN; END IF;
 END IF;
 IF target_post IS NOT NULL AND (NOT privacy_v2_private.can_view_post_for(target_post,p_receiver_id)
   OR NOT privacy_v2_private.can_view_post_for(target_post,p_actor_id)) THEN RETURN; END IF;
 INSERT INTO public.notifications(receiver_id,actor_id,type,post_id,comment_id) VALUES(p_receiver_id,p_actor_id,p_type,target_post,p_comment_id);
END $$;
REVOKE ALL ON FUNCTION public.create_notification(uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE VIEW public.repost_feed_items WITH(security_invoker=true,security_barrier=true) AS
 SELECT r.id AS repost_id,r.post_id,r.user_id AS reposter_id,r.comment AS repost_comment,r.created_at AS repost_created_at,
 reposter.display_name AS reposter_display_name,reposter.username AS reposter_username,reposter.avatar_url AS reposter_avatar_url,reposter.verified_status AS reposter_verified_status
 FROM public.reposts r JOIN public.profiles reposter ON reposter.id=r.user_id JOIN public.posts p ON p.id=r.post_id
 WHERE p.publishing_state='published' AND p.is_hidden=false AND p.is_deleted=false;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY privacy_v2_notification_parent ON public.notifications AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(
 (post_id IS NULL AND comment_id IS NULL) OR EXISTS(SELECT 1 FROM public.posts p WHERE p.id=coalesce(notifications.post_id,
  (SELECT c.post_id FROM public.comments c WHERE c.id=notifications.comment_id))));
CREATE POLICY privacy_v2_sound_parent ON public.sounds AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(
 source_post_id IS NULL OR EXISTS(SELECT 1 FROM public.posts p WHERE p.id=sounds.source_post_id AND p.visibility='public'));
-- Direct table writes must respect the same parent boundary as RPCs.
DO $$ DECLARE t text; predicate text; identity_check text; BEGIN
 FOREACH t IN ARRAY ARRAY['comments','reposts','post_likes','comment_likes','bookmarks','shares','post_views','mentions'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='post_id') THEN
   predicate=format('EXISTS(SELECT 1 FROM public.posts p WHERE p.id=%I.post_id %s)',t,
    CASE WHEN t IN ('reposts','mentions') THEN 'AND p.visibility=''public''' WHEN t='comments' THEN 'AND (p.visibility=''public'' OR comments.image_url IS NULL)' ELSE '' END);
  ELSIF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='comment_id') THEN
   predicate=format('EXISTS(SELECT 1 FROM public.comments c JOIN public.posts p ON p.id=c.post_id WHERE c.id=%I.comment_id)',t);
  ELSE RAISE EXCEPTION 'Unexpected child table shape: %',t; END IF;
  identity_check=CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='user_id')
   THEN format(' AND %I.user_id=auth.uid()',t) ELSE '' END;
  IF t='comments' THEN identity_check=identity_check || ' AND (comments.parent_id IS NULL OR EXISTS(SELECT 1 FROM public.comments parent WHERE parent.id=comments.parent_id AND parent.post_id=comments.post_id))'; END IF;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY privacy_v2_rpc_parent_read ON public.%I AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(%s)',t,predicate);
  EXECUTE format('CREATE POLICY privacy_v2_parent_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(auth.uid() IS NOT NULL AND %s %s)',t,predicate,identity_check);
  EXECUTE format('CREATE POLICY privacy_v2_parent_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING(%s %s) WITH CHECK(%s %s)',t,predicate,identity_check,predicate,identity_check);
 END LOOP;
END $$;
-- Trigger helpers cannot be invoked as exposed RPCs; PostgreSQL still invokes triggers.
REVOKE ALL ON FUNCTION public.notify_post_like(),public.notify_comment_like(),public.notify_repost(),public.notify_new_comment() FROM PUBLIC,anon,authenticated;
COMMIT;
