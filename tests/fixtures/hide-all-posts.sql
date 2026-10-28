-- Isolated production-shaped closure. No user records or credentials.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA privacy_v2_private;
GRANT USAGE ON SCHEMA auth,privacy_v2_private TO anon,authenticated,service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE profiles(id uuid PRIMARY KEY,is_admin boolean DEFAULT false,hide_all_posts boolean DEFAULT false,is_private boolean DEFAULT false,suspended boolean DEFAULT false,display_name text,username text,avatar_url text,verified_status text,phone text);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
GRANT SELECT(id,hide_all_posts,is_private,display_name,username,avatar_url,verified_status), UPDATE ON profiles TO anon,authenticated;
CREATE TABLE follows(follower_id uuid,following_id uuid,status text DEFAULT 'active');
CREATE TABLE privacy_v2_private.follow_approvals(follower_id uuid,following_id uuid,approval_kind text);
CREATE TABLE privacy_v2_private.post_deletions(post_id uuid,owner_id uuid,permanent boolean DEFAULT false,deleted_at timestamptz,purge_after timestamptz);
CREATE TABLE privacy_v2_private.verification_posts(post_id uuid,owner_id uuid,retired_at timestamptz,expires_at timestamptz);
CREATE TABLE posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,title text,description text,content text,created_at timestamptz DEFAULT now(),visibility text,publishing_state text DEFAULT 'published',is_deleted boolean DEFAULT false,is_hidden boolean DEFAULT false,media_type text DEFAULT 'video',media_url text,thumbnail_url text,text_template_id text,media jsonb,sound_id text,like_count integer DEFAULT 0,share_count integer DEFAULT 0,repost_count integer DEFAULT 0,bookmark_count integer DEFAULT 0,views integer DEFAULT 0,category text,tags text[],edited_at timestamptz,version integer DEFAULT 1);
CREATE TABLE post_short_links(code text,post_id uuid);
CREATE TABLE post_media_assets(id uuid,post_id uuid,owner_id uuid,status text,delivery_type text);
CREATE TABLE comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),post_id uuid,user_id uuid,parent_id uuid,message text,like_count integer DEFAULT 0,is_deleted boolean DEFAULT false,updated_at timestamptz,edited boolean DEFAULT false);
CREATE TABLE bookmarks(post_id uuid,user_id uuid,created_at timestamptz DEFAULT now());
CREATE TABLE reposts(id uuid DEFAULT gen_random_uuid(),post_id uuid,user_id uuid,comment text,created_at timestamptz DEFAULT now());
CREATE TABLE post_likes(post_id uuid,user_id uuid);
CREATE TABLE shares(post_id uuid,user_id uuid,created_at timestamptz,UNIQUE(user_id,post_id));
CREATE TABLE post_views(post_id uuid,user_id uuid,session_id text,viewed_at timestamptz DEFAULT now());
CREATE TABLE mentions(post_id uuid,mentioned_user_id uuid,UNIQUE(post_id,mentioned_user_id));
CREATE TABLE comment_likes(comment_id uuid,user_id uuid,created_at timestamptz);
CREATE TABLE sounds(id text,usage_count bigint,source_post_id uuid,created_by uuid);
CREATE TABLE notifications(id bigint GENERATED ALWAYS AS IDENTITY,type text,actor_id uuid,receiver_id uuid,post_id uuid,comment_id uuid,read boolean DEFAULT false,created_at timestamptz DEFAULT now());
GRANT SELECT ON posts,comments,bookmarks,notifications,sounds TO anon,authenticated;
GRANT UPDATE ON posts TO authenticated;
GRANT SELECT ON reposts TO authenticated;
ALTER TABLE profiles ADD COLUMN bio text;
ALTER TABLE profiles ADD COLUMN gender text;
ALTER TABLE profiles ADD COLUMN dob date;
ALTER TABLE profiles ADD COLUMN country text;
ALTER TABLE profiles ADD COLUMN tags text[];
ALTER TABLE profiles ADD COLUMN verified boolean;
ALTER TABLE profiles ADD COLUMN hide_follower_count boolean;
ALTER TABLE profiles ADD COLUMN activity_status boolean;
ALTER TABLE profiles ADD COLUMN verification_status text;
ALTER TABLE profiles ADD COLUMN verification_category text;
ALTER TABLE profiles ADD COLUMN verification_reason text;
ALTER TABLE profiles ADD COLUMN verification_link text;
ALTER TABLE profiles ADD COLUMN created_at timestamp with time zone;
ALTER TABLE profiles ADD COLUMN updated_at timestamp with time zone;
ALTER TABLE profiles ADD COLUMN verification_submitted_at timestamp with time zone;
ALTER TABLE profiles ADD COLUMN totp_factor_id text;
ALTER TABLE profiles ADD COLUMN suspended_reason text;
ALTER TABLE profiles ADD COLUMN suspended_at timestamp with time zone;
ALTER TABLE profiles ADD COLUMN pinned_post_id uuid;
ALTER TABLE profiles ADD COLUMN background_url text;
ALTER TABLE profiles ADD COLUMN hidden_tabs text[];
ALTER TABLE profiles ADD COLUMN show_in_suggestions boolean;
ALTER TABLE profiles ADD COLUMN display_username text;
ALTER TABLE profiles ADD COLUMN interests jsonb;
ALTER TABLE profiles ADD COLUMN onboarding_completed boolean;
ALTER TABLE profiles ADD COLUMN online_status text;
ALTER TABLE profiles ADD COLUMN is_online boolean;
ALTER TABLE profiles ADD COLUMN last_seen_at timestamp with time zone;
ALTER TABLE profiles ADD COLUMN addable_by text;
ALTER TABLE profiles ADD COLUMN cover_url text;
ALTER TABLE profiles ADD COLUMN freeupper_id text;
ALTER TABLE profiles ADD COLUMN profile_setup_completed_at timestamp with time zone;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
CREATE OR REPLACE FUNCTION privacy_v2_private.approved_edge(p_follower uuid, p_following uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select p_follower is not null and p_following is not null and exists(
 select 1 from public.follows f
 join public.profiles p on p.id=f.following_id
 join privacy_v2_private.follow_approvals a on a.follower_id=f.follower_id and a.following_id=f.following_id
 where f.follower_id=p_follower and f.following_id=p_following
 and f.status='active' and p.suspended=false
 and (p.is_private=false or a.approval_kind='owner')
 );
$function$
;
REVOKE ALL ON FUNCTION privacy_v2_private.approved_edge(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy_v2_private.approved_edge(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION privacy_v2_private.approved_edge(uuid, uuid) TO service_role;
CREATE OR REPLACE FUNCTION privacy_v2_private.author_not_suspended(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.suspended IS FALSE) $function$
;
REVOKE ALL ON FUNCTION privacy_v2_private.author_not_suspended(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy_v2_private.author_not_suspended(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION privacy_v2_private.author_not_suspended(uuid) TO anon;
GRANT EXECUTE ON FUNCTION privacy_v2_private.author_not_suspended(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION privacy_v2_private.verification_owner_active(p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT false $function$
;
REVOKE ALL ON FUNCTION privacy_v2_private.verification_owner_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy_v2_private.verification_owner_active(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION privacy_v2_private.verification_owner_active(uuid) TO service_role;
CREATE OR REPLACE FUNCTION privacy_v2_private.verification_post_active(p_post uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT privacy_v2_private.verification_owner_active(p_owner)
 AND EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts
   WHERE post_id=p_post AND owner_id=p_owner AND retired_at IS NULL AND expires_at>now())
$function$
;
REVOKE ALL ON FUNCTION privacy_v2_private.verification_post_active(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy_v2_private.verification_post_active(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION privacy_v2_private.verification_post_active(uuid, uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.delete_post(p_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.posts WHERE id=p_post_id AND user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Post not found or not owned' USING ERRCODE='42501';
 END IF;
 UPDATE public.posts SET is_deleted=true,is_hidden=true WHERE id=p_post_id AND user_id=auth.uid();
END $function$
;
REVOKE ALL ON FUNCTION public.delete_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_post(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.delete_post(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.edit_post(p_post_id uuid, p_content text, p_title text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_tags text[] DEFAULT NULL::text[], p_visibility text DEFAULT 'public'::text)
 RETURNS posts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  updated_post posts;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM posts WHERE id = p_post_id AND user_id = auth.uid() AND is_deleted = false) THEN
    RAISE EXCEPTION 'Post not found or not owned';
  END IF;
  IF p_content IS NULL OR trim(p_content) = '' THEN
    RAISE EXCEPTION 'Content cannot be empty';
  END IF;
  UPDATE posts
  SET
    content = p_content,
    title = COALESCE(p_title, title),
    description = COALESCE(p_description, description),
    category = COALESCE(p_category, category),
    tags = COALESCE(p_tags, tags),
    visibility = COALESCE(p_visibility, visibility),
    edited_at = now(),
    version = version + 1
  WHERE id = p_post_id
  RETURNING * INTO updated_post;
  PERFORM parse_mentions(p_post_id, p_content);
  RETURN updated_post;
END;
$function$
;
REVOKE ALL ON FUNCTION public.edit_post(uuid, text, text, text, text, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_post(uuid, text, text, text, text, text[], text) TO postgres;
GRANT EXECUTE ON FUNCTION public.edit_post(uuid, text, text, text, text, text[], text) TO authenticated;
CREATE OR REPLACE FUNCTION public.is_admin_user(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT COALESCE(
        (
            SELECT p.is_admin
            FROM public.profiles AS p
            WHERE p.id = uid
        ),
        false
    );
$function$
;
REVOKE ALL ON FUNCTION public.is_admin_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_user(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.is_admin_user(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.parse_mentions(p_post_id uuid, p_content text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE mention_username text;
BEGIN
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
$function$
;
REVOKE ALL ON FUNCTION public.parse_mentions(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parse_mentions(uuid, text) TO postgres;
GRANT EXECUTE ON FUNCTION public.parse_mentions(uuid, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.permanent_post_readable(p_post uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT auth.uid() IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM privacy_v2_private.post_deletions d WHERE d.post_id=p_post
 AND d.owner_id=auth.uid() AND p_owner=auth.uid() AND d.permanent)
$function$
;
REVOKE ALL ON FUNCTION public.permanent_post_readable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.permanent_post_readable(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.permanent_post_readable(uuid, uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.privacy_v2_approved_edge(p_follower uuid, p_following uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select auth.uid() is not null
 and auth.uid() in (p_follower,p_following)
 and privacy_v2_private.approved_edge(p_follower,p_following);
$function$
;
REVOKE ALL ON FUNCTION public.privacy_v2_approved_edge(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.privacy_v2_approved_edge(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.privacy_v2_approved_edge(uuid, uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.protect_profile_identity_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF COALESCE(auth.role(), '') <> 'service_role' THEN
            NEW.is_admin := false;
            NEW.verified := false;
            NEW.verified_status := 'none';
            NEW.verification_status := 'none';
            NEW.verification_category := NULL;
            NEW.verification_reason := NULL;
            NEW.verification_link := NULL;
            NEW.verification_submitted_at := NULL;
            NEW.suspended := false;
            NEW.suspended_reason := NULL;
            NEW.suspended_at := NULL;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.freeupper_id IS DISTINCT FROM OLD.freeupper_id THEN
            RAISE EXCEPTION 'freeupper_id is immutable and cannot be changed';
        END IF;

        IF (
            NEW.is_admin IS DISTINCT FROM OLD.is_admin
            OR NEW.verified IS DISTINCT FROM OLD.verified
            OR NEW.verified_status IS DISTINCT FROM OLD.verified_status
            OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
            OR NEW.verification_category IS DISTINCT FROM OLD.verification_category
            OR NEW.verification_reason IS DISTINCT FROM OLD.verification_reason
            OR NEW.verification_link IS DISTINCT FROM OLD.verification_link
            OR NEW.verification_submitted_at IS DISTINCT FROM OLD.verification_submitted_at
            OR NEW.suspended IS DISTINCT FROM OLD.suspended
            OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason
            OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
        )
        AND COALESCE(auth.role(), '') <> 'service_role'
        AND NOT public.is_admin_user(auth.uid())
        THEN
            RAISE EXCEPTION 'Only administrators can modify privileged profile fields';
        END IF;

        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Unexpected trigger operation: %', TG_OP;
END;
$function$
;
REVOKE ALL ON FUNCTION public.protect_profile_identity_fields() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_profile_identity_fields() TO postgres;
CREATE OR REPLACE FUNCTION public.restore_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.posts WHERE id=p_post_id AND user_id=auth.uid() AND is_deleted IS TRUE) THEN
  RAISE EXCEPTION 'Post not found or not owned' USING ERRCODE='42501';
 END IF;
 UPDATE public.posts SET is_deleted=false WHERE id=p_post_id AND user_id=auth.uid();
 RETURN true;
END $function$
;
REVOKE ALL ON FUNCTION public.restore_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_post(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.restore_post(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.verification_post_readable(p_post uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT auth.uid() IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts WHERE post_id=p_post)
   OR privacy_v2_private.verification_post_active(p_post,p_owner))
$function$
;
REVOKE ALL ON FUNCTION public.verification_post_readable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verification_post_readable(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.verification_post_readable(uuid, uuid) TO authenticated;
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
REVOKE ALL ON FUNCTION public.get_public_post_by_short_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_post_by_short_code(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_public_post_by_short_code(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_post_by_short_code(text) TO authenticated;
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
REVOKE ALL ON FUNCTION public.get_public_post_seo_metadata(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_post_seo_metadata(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_public_post_seo_metadata(text) TO anon;
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
REVOKE ALL ON FUNCTION public.get_public_short_code_for_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_short_code_for_post(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_public_short_code_for_post(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_short_code_for_post(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_public_video_seo(p_code text)
 RETURNS TABLE(published_at timestamp with time zone, public_video_url text, public_thumbnail_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select p.created_at, case when p.media_url ~ '^https://res[.]cloudinary[.]com/[^ ]+/video/upload/' then p.media_url else null end, case when p.thumbnail_url ~ '^https://(res[.]cloudinary[.]com|jmjtqidirpmnegzvmiaq[.]supabase[.]co)/' then p.thumbnail_url else null end from public.post_short_links l join public.posts p on p.id=l.post_id join public.profiles u on u.id=p.user_id where l.code=p_code and p.media_type='video' and p.visibility='public' and coalesce(p.is_deleted,false)=false and coalesce(p.is_hidden,false)=false and coalesce(u.is_private,true)=false and coalesce(u.suspended,false)=false limit 1 $function$
;
REVOKE ALL ON FUNCTION public.get_public_video_seo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_video_seo(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_public_video_seo(text) TO anon;
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
REVOKE ALL ON FUNCTION public.list_public_post_sitemap(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_post_sitemap(text, integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.list_public_post_sitemap(text, integer) TO anon;
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
REVOKE ALL ON FUNCTION public.authorize_protected_asset(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_protected_asset(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.authorize_protected_asset(uuid, uuid) TO service_role;
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
REVOKE ALL ON FUNCTION public.search_posts(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_posts(text, integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.search_posts(text, integer) TO authenticated;
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
REVOKE ALL ON FUNCTION public.get_bookmarks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bookmarks() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_bookmarks() TO authenticated;
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
REVOKE ALL ON FUNCTION public.get_notifications(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notifications(integer, integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_notifications(integer, integer) TO authenticated;
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
GRANT EXECUTE ON FUNCTION public.add_view(uuid, uuid, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_view(uuid, uuid, text) TO postgres;
GRANT EXECUTE ON FUNCTION public.add_view(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_view(uuid, uuid, text) TO anon;
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
REVOKE ALL ON FUNCTION public.toggle_bookmark(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_bookmark(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.toggle_bookmark(uuid) TO authenticated;
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
REVOKE ALL ON FUNCTION public.toggle_bookmark(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_bookmark(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.toggle_bookmark(uuid, uuid) TO authenticated;
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
REVOKE ALL ON FUNCTION public.toggle_comment_like(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_comment_like(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.toggle_comment_like(uuid) TO authenticated;
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
REVOKE ALL ON FUNCTION public.toggle_comment_like(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_comment_like(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.toggle_comment_like(uuid, uuid) TO authenticated;
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
REVOKE ALL ON FUNCTION public.toggle_post_like(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_post_like(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.toggle_post_like(uuid) TO authenticated;
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
REVOKE ALL ON FUNCTION public.toggle_repost(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_repost(uuid, text) TO postgres;
GRANT EXECUTE ON FUNCTION public.toggle_repost(uuid, text) TO authenticated;
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
REVOKE ALL ON FUNCTION public.toggle_repost(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_repost(uuid, uuid, text) TO postgres;
GRANT EXECUTE ON FUNCTION public.toggle_repost(uuid, uuid, text) TO authenticated;
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
REVOKE ALL ON FUNCTION privacy_v2_private.restricted_notification_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy_v2_private.restricted_notification_guard() TO postgres;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can update any profile" ON profiles AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
CREATE POLICY "profiles_owner_delete" ON profiles AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = id));
CREATE POLICY "profiles_owner_insert" ON profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));
CREATE POLICY "profiles_owner_update" ON profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
CREATE POLICY "profiles_public_select" ON profiles AS PERMISSIVE FOR SELECT TO anon,authenticated USING (true);
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can delete posts" ON posts AS PERMISSIVE FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
CREATE POLICY "Enable delete for users based on user_id" ON posts AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Enable insert for authenticated users" ON posts AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Enable update for users based on user_id" ON posts AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete own posts" ON posts AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert own posts" ON posts AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can manage own posts" ON posts AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can update own posts" ON posts AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "privacy_v2_anonymous_public_post_read_boundary" ON posts AS RESTRICTIVE FOR SELECT TO anon USING (((publishing_state = 'published'::text) AND (visibility = 'public'::text) AND (is_deleted IS FALSE) AND (is_hidden IS FALSE) AND (EXISTS ( SELECT 1
   FROM profiles author
  WHERE ((author.id = posts.user_id) AND (author.is_private IS FALSE) AND privacy_v2_private.author_not_suspended(author.id))))));
CREATE POLICY "privacy_v2_permanent_retirement_boundary" ON posts AS RESTRICTIVE FOR SELECT TO authenticated USING (permanent_post_readable(id, user_id));
CREATE POLICY "privacy_v2_post_select_baseline" ON posts AS PERMISSIVE FOR SELECT TO anon,authenticated USING (true);
CREATE POLICY "privacy_v2_restricted_post_read_boundary" ON posts AS RESTRICTIVE FOR SELECT TO authenticated USING ((((auth.uid() IS NOT NULL) AND (auth.uid() = user_id)) OR ((publishing_state = 'published'::text) AND (is_deleted IS FALSE) AND (is_hidden IS FALSE) AND (EXISTS ( SELECT 1
   FROM profiles author
  WHERE ((author.id = posts.user_id) AND privacy_v2_private.author_not_suspended(author.id) AND (((posts.visibility = 'public'::text) AND ((author.is_private IS FALSE) OR ((auth.uid() IS NOT NULL) AND privacy_v2_approved_edge(auth.uid(), posts.user_id)))) OR ((posts.visibility = 'followers'::text) AND (auth.uid() IS NOT NULL) AND privacy_v2_approved_edge(auth.uid(), posts.user_id)) OR ((posts.visibility = 'friends'::text) AND (auth.uid() IS NOT NULL) AND privacy_v2_approved_edge(auth.uid(), posts.user_id) AND privacy_v2_approved_edge(posts.user_id, auth.uid())))))))));
CREATE POLICY "privacy_v2_verification_lifetime" ON posts AS RESTRICTIVE FOR SELECT TO authenticated USING (verification_post_readable(id, user_id));
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view comments" ON comments AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Comments are viewable by everyone" ON comments AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Public read comments" ON comments AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Users can delete own comments" ON comments AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert comments" ON comments AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can insert own comments" ON comments AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can manage own comments" ON comments AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can update own comments" ON comments AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "comments_delete_own" ON comments AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "comments_insert_own" ON comments AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "comments_read_all" ON comments AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "comments_update_own" ON comments AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "privacy_v2_parent_post_boundary" ON comments AS RESTRICTIVE FOR ALL TO anon,authenticated USING (((post_id IS NULL) OR (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = comments.post_id) AND (p.is_deleted IS FALSE) AND (p.is_hidden IS FALSE)))))) WITH CHECK (((post_id IS NULL) OR (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = comments.post_id) AND (p.is_deleted IS FALSE) AND (p.is_hidden IS FALSE))))));
ALTER TABLE reposts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can repost/unrepost" ON reposts AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "privacy_v2_parent_post_boundary" ON reposts AS RESTRICTIVE FOR ALL TO anon,authenticated USING (((post_id IS NULL) OR (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = reposts.post_id) AND (p.is_deleted IS FALSE) AND (p.is_hidden IS FALSE)))))) WITH CHECK (((post_id IS NULL) OR (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = reposts.post_id) AND (p.is_deleted IS FALSE) AND (p.is_hidden IS FALSE))))));
CREATE POLICY "reposts_delete_own" ON reposts AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "reposts_insert_own" ON reposts AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "reposts_select_own_authenticated" ON reposts AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can bookmark/unbookmark" ON bookmarks AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can create bookmarks" ON bookmarks AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can delete own bookmarks" ON bookmarks AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own bookmarks" ON bookmarks AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can manage own bookmarks" ON bookmarks AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own bookmarks" ON bookmarks AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "own bookmarks delete" ON bookmarks AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "own bookmarks insert" ON bookmarks AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "own bookmarks select" ON bookmarks AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "privacy_v2_parent_post_boundary" ON bookmarks AS RESTRICTIVE FOR ALL TO anon,authenticated USING (((post_id IS NULL) OR (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = bookmarks.post_id) AND (p.is_deleted IS FALSE) AND (p.is_hidden IS FALSE)))))) WITH CHECK (((post_id IS NULL) OR (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = bookmarks.post_id) AND (p.is_deleted IS FALSE) AND (p.is_hidden IS FALSE))))));
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can update their own notifications" ON notifications AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = receiver_id)) WITH CHECK ((auth.uid() = receiver_id));
CREATE POLICY "Users can view their own notifications" ON notifications AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = receiver_id));
CREATE POLICY "privacy_v2_parent_post_boundary" ON notifications AS RESTRICTIVE FOR ALL TO anon,authenticated USING (((post_id IS NULL) OR (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = notifications.post_id) AND (p.is_deleted IS FALSE) AND (p.is_hidden IS FALSE)))))) WITH CHECK (((post_id IS NULL) OR (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = notifications.post_id) AND (p.is_deleted IS FALSE) AND (p.is_hidden IS FALSE))))));
ALTER TABLE sounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read sounds" ON sounds AS PERMISSIVE FOR SELECT TO anon,authenticated USING (true);
CREATE POLICY "Users can insert their own sounds" ON sounds AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));
CREATE POLICY "privacy_v2_parent_post_boundary" ON sounds AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (((source_post_id IS NULL) OR (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = sounds.source_post_id) AND (p.visibility = 'public'::text) AND (p.is_deleted IS FALSE) AND (p.is_hidden IS FALSE))))));
CREATE POLICY "sounds_delete_owner" ON sounds AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = created_by));
CREATE POLICY "sounds_select_public" ON sounds AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "sounds_update_owner" ON sounds AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = created_by)) WITH CHECK ((( SELECT auth.uid() AS uid) = created_by));
CREATE TRIGGER protect_identity BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_identity_fields();
CREATE VIEW repost_feed_items WITH (security_invoker=true) AS SELECT r.id AS repost_id,r.post_id,r.user_id AS reposter_id,r.comment AS repost_comment FROM reposts r JOIN profiles reposter ON reposter.id=r.user_id;
GRANT SELECT ON repost_feed_items TO anon,authenticated;
