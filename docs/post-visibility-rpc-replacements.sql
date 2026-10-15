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
