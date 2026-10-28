-- REVIEW ONLY: requires explicit approval before production application.
BEGIN;
-- Keep the existing administrator rule without reading a protected column as the caller.
ALTER POLICY "Admins can update any profile" ON public.profiles TO authenticated
 USING (public.is_admin_user((SELECT auth.uid())))
 WITH CHECK (public.is_admin_user((SELECT auth.uid())));
-- Additional AND restriction: existing publication, retirement and audience rules still apply.
CREATE POLICY posts_hide_all_posts_boundary ON public.posts AS RESTRICTIVE
 FOR SELECT TO anon, authenticated
 USING (
   user_id = (SELECT auth.uid())
   OR EXISTS (SELECT 1 FROM public.profiles author
              WHERE author.id = posts.user_id AND NOT coalesce(author.hide_all_posts, false))
 );

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
  where NOT coalesce(u.hide_all_posts,false) AND p.publishing_state='published' AND coalesce(u.suspended,false)=false AND l.code = p_code
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
 where NOT coalesce(u.hide_all_posts,false) AND p.publishing_state='published' AND coalesce(u.suspended,false)=false AND l.code = p_code
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
  where NOT coalesce(u.hide_all_posts,false) AND p.publishing_state='published' AND coalesce(u.suspended,false)=false AND p.id = p_post_id
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
AS $function$ select p.created_at, case when p.media_url ~ '^https://res[.]cloudinary[.]com/[^ ]+/video/upload/' then p.media_url else null end, case when p.thumbnail_url ~ '^https://(res[.]cloudinary[.]com|jmjtqidirpmnegzvmiaq[.]supabase[.]co)/' then p.thumbnail_url else null end from public.post_short_links l join public.posts p on p.id=l.post_id join public.profiles u on u.id=p.user_id where NOT coalesce(u.hide_all_posts,false) AND p.publishing_state='published' AND coalesce(u.suspended,false)=false AND l.code=p_code and p.media_type='video' and p.visibility='public' and coalesce(p.is_deleted,false)=false and coalesce(p.is_hidden,false)=false and coalesce(u.is_private,true)=false and coalesce(u.suspended,false)=false limit 1 $function$
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
  where NOT coalesce(u.hide_all_posts,false) AND p.publishing_state='published' AND coalesce(u.suspended,false)=false AND l.code > coalesce(p_after, '')
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
 AND (p.user_id=auth.uid() OR NOT coalesce(pr.hide_all_posts,false))
 AND p.publishing_state='published'
 AND pr.is_private IS FALSE AND pr.suspended IS FALSE
 AND to_tsvector('english',COALESCE(p.title,'')||' '||COALESCE(p.content,'')) @@ plainto_tsquery('english',query)
 ORDER BY relevance DESC LIMIT LEAST(GREATEST(COALESCE(limit_count,20),1),100);
END;
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
   AND (p.user_id=p_viewer OR NOT coalesce(owner_profile.hide_all_posts,false))
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
COMMIT;

