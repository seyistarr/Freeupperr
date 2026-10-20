-- REVIEW ONLY: do not run against production until post RLS and protected delivery are ready.
-- Preserves edit_post argument types/order and return type; changes default visibility
-- from 'public' to NULL so ordinary content edits retain their existing audience.
-- Explicit visibility changes remain blocked until the full Privacy V2 release.
BEGIN;
CREATE OR REPLACE FUNCTION public.edit_post(
  p_post_id uuid,
  p_content text,
  p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_visibility text DEFAULT NULL
) RETURNS public.posts
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE updated_post public.posts;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.posts WHERE id=p_post_id AND user_id=auth.uid() AND is_deleted=false
  ) THEN
    RAISE EXCEPTION 'Post not found or not owned' USING ERRCODE='42501';
  END IF;
  IF p_content IS NULL OR trim(p_content) = '' THEN
    RAISE EXCEPTION 'Content cannot be empty';
  END IF;
  -- Preserve public-only publishing while private delivery is not production-ready.
  IF p_visibility IS NOT NULL AND p_visibility <> 'public' THEN
    RAISE EXCEPTION 'Restricted post visibility is not yet enabled' USING ERRCODE='42501';
  END IF;
  UPDATE public.posts SET
    content=p_content,
    title=COALESCE(p_title,title),
    description=COALESCE(p_description,description),
    category=COALESCE(p_category,category),
    tags=COALESCE(p_tags,tags),
    visibility=COALESCE(p_visibility,visibility),
    edited_at=now(),
    version=version+1
  WHERE id=p_post_id
  RETURNING * INTO updated_post;
  PERFORM public.parse_mentions(p_post_id,p_content);
  RETURN updated_post;
END;
$function$;
COMMIT;
