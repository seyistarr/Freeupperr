-- REVIEW / STAGING ONLY. Requires protected-media and RLS release gate.
-- Preserves current RPC signatures. Do not apply to production before tests.
BEGIN;
CREATE OR REPLACE FUNCTION public.record_share(p_post_id uuid,p_user_id uuid)
RETURNS TABLE(already_shared boolean,count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public','pg_temp'
AS $fn$
DECLARE v_exists boolean; v_count integer;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
  RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.posts p WHERE p.id=p_post_id
   AND p.is_deleted IS FALSE AND p.is_hidden IS FALSE
   AND public.freeupper_can_view_post(p.user_id,p.visibility)
 ) THEN RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.shares s WHERE s.post_id=p_post_id AND s.user_id=p_user_id) INTO v_exists;
 IF v_exists THEN
  SELECT p.share_count INTO v_count FROM public.posts p WHERE p.id=p_post_id;
  RETURN QUERY SELECT true,v_count;
 ELSE
  INSERT INTO public.shares(post_id,user_id,created_at) VALUES(p_post_id,p_user_id,now())
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
   UPDATE public.posts p SET share_count=COALESCE(p.share_count,0)+1 WHERE p.id=p_post_id RETURNING p.share_count INTO v_count;
   RETURN QUERY SELECT false,v_count;
  ELSE
   SELECT p.share_count INTO v_count FROM public.posts p WHERE p.id=p_post_id;
   RETURN QUERY SELECT true,v_count;
  END IF;
 END IF;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.edit_post(
 p_post_id uuid,p_content text,p_title text DEFAULT NULL,
 p_description text DEFAULT NULL,p_category text DEFAULT NULL,
 p_tags text[] DEFAULT NULL,p_visibility text DEFAULT 'public'
) RETURNS public.posts LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public','pg_temp'
AS $fn$
DECLARE updated_post public.posts; existing_visibility text;
BEGIN
 SELECT p.visibility INTO existing_visibility FROM public.posts p
 WHERE p.id=p_post_id AND p.user_id=auth.uid() AND p.is_deleted IS FALSE FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Post not found or not owned'; END IF;
 IF p_content IS NULL OR btrim(p_content)='' THEN RAISE EXCEPTION 'Content cannot be empty'; END IF;
 -- Existing callers omit visibility and receive the SQL default public.
 -- Keep visibility unchanged on edits until an explicit safe audience-change RPC exists.
 IF p_visibility IS DISTINCT FROM 'public' AND p_visibility IS DISTINCT FROM existing_visibility THEN
  RAISE EXCEPTION 'Visibility changes require protected-media migration' USING ERRCODE='42501';
 END IF;
 UPDATE public.posts p SET content=p_content,title=COALESCE(p_title,p.title),
 description=COALESCE(p_description,p.description),category=COALESCE(p_category,p.category),
 tags=COALESCE(p_tags,p.tags),edited_at=now(),version=p.version+1
 WHERE p.id=p_post_id RETURNING p.* INTO updated_post;
 PERFORM public.parse_mentions(p_post_id,p_content);
 RETURN updated_post;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.search_posts(query text,limit_count integer DEFAULT 20)
RETURNS TABLE(id uuid,title text,content text,created_at timestamptz,display_name text,username text,avatar_url text,verified_status text,relevance real)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp'
AS $fn$
BEGIN
 RETURN QUERY SELECT p.id,p.title,p.content,p.created_at,pr.display_name,pr.username,pr.avatar_url,pr.verified_status,
 ts_rank_cd(to_tsvector('english',COALESCE(p.title,'')||' '||COALESCE(p.content,'')),plainto_tsquery('english',query)) AS relevance
 FROM public.posts p JOIN public.profiles pr ON p.user_id=pr.id
 WHERE p.is_deleted IS FALSE AND p.is_hidden IS FALSE AND p.visibility='public'
 AND pr.is_private IS FALSE AND pr.suspended IS FALSE
 AND to_tsvector('english',COALESCE(p.title,'')||' '||COALESCE(p.content,'')) @@ plainto_tsquery('english',query)
 ORDER BY relevance DESC LIMIT LEAST(GREATEST(COALESCE(limit_count,20),1),100);
END;
$fn$;
COMMIT;
-- Requires freeupper_can_view_post from audience RLS review migration.
-- Confirm shares unique(post_id,user_id) before relying on ON CONFLICT DO NOTHING.
-- Run tests on isolated FreeUpper staging before production.
