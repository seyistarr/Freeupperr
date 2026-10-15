-- REVIEW-ONLY migration draft. Do not apply until media protection and all access paths are tested.
-- Existing signatures retained for client compatibility.
-- NOTE: PostgreSQL CREATE OR REPLACE FUNCTION cannot change default arguments
-- or return types incompatibly; verify on isolated staging first.

CREATE OR REPLACE FUNCTION public.edit_post(
 p_post_id uuid, p_content text, p_title text DEFAULT NULL,
 p_description text DEFAULT NULL, p_category text DEFAULT NULL,
 p_tags text[] DEFAULT NULL, p_visibility text DEFAULT NULL
)
RETURNS public.posts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE updated_post public.posts;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id=p_post_id AND user_id=auth.uid() AND is_deleted IS FALSE)
 THEN RAISE EXCEPTION 'Post not found or not owned' USING ERRCODE='42501'; END IF;
 IF p_content IS NULL OR btrim(p_content)='' THEN RAISE EXCEPTION 'Content cannot be empty'; END IF;
 IF p_visibility IS NOT NULL AND p_visibility NOT IN ('public','followers','friends','only_me')
 THEN RAISE EXCEPTION 'Invalid post audience'; END IF;
 UPDATE public.posts SET
  content=p_content,
  title=COALESCE(p_title,title),
  description=COALESCE(p_description,description),
  category=COALESCE(p_category,category),
  tags=COALESCE(p_tags,tags),
  visibility=COALESCE(p_visibility,visibility),
  edited_at=now(),
  version=version+1
 WHERE id=p_post_id AND user_id=auth.uid()
 RETURNING * INTO updated_post;
 PERFORM public.parse_mentions(p_post_id,p_content);
 RETURN updated_post;
END;
$$;

-- Sharing requires the final viewer authorization function, not just a public visibility test.
-- Keep record_share unchanged until that function and media access are ready.

-- Proposed record_share replacement, pending end-to-end authorization and RLS tests.
-- Depends on public.can_view_freeupper_post(author uuid, visibility text).
-- Function signature and TABLE return fields remain unchanged.
CREATE OR REPLACE FUNCTION public.record_share(p_post_id uuid, p_user_id uuid)
RETURNS TABLE(already_shared boolean, count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_post public.posts; v_exists boolean; v_count integer;
BEGIN
 IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Unauthorized share' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_post FROM public.posts WHERE id=p_post_id
   AND is_deleted IS FALSE AND is_hidden IS FALSE;
 IF NOT FOUND OR NOT public.can_view_freeupper_post(v_post.user_id,v_post.visibility) THEN
  RAISE EXCEPTION 'Post unavailable' USING ERRCODE='42501';
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.shares s WHERE s.post_id=p_post_id AND s.user_id=auth.uid())
 INTO v_exists;
 IF v_exists THEN
  SELECT p.share_count INTO v_count FROM public.posts p WHERE p.id=p_post_id;
  RETURN QUERY SELECT true,v_count;
 ELSE
  INSERT INTO public.shares(post_id,user_id,created_at)
  VALUES(p_post_id,auth.uid(),now());
  UPDATE public.posts SET share_count=share_count+1 WHERE id=p_post_id
  RETURNING share_count INTO v_count;
  RETURN QUERY SELECT false,v_count;
 END IF;
END;
$$;

-- Before rollout, also replace all permissive shares SELECT policies and audit
-- direct shares INSERT policies, share counts, media URLs, and other RPCs.
