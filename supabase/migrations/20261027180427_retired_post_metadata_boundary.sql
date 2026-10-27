-- Recovery permits owner metadata for seven days, but permanent retirement must
-- deny ordinary REST access even to the owner. Service cleanup/audit is retained.
CREATE FUNCTION public.permanent_post_readable(p_post uuid,p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT auth.uid() IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM privacy_v2_private.post_deletions d WHERE d.post_id=p_post
 AND d.owner_id=auth.uid() AND p_owner=auth.uid() AND d.permanent)
$$;
REVOKE ALL ON FUNCTION public.permanent_post_readable(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.permanent_post_readable(uuid,uuid) TO authenticated;
CREATE POLICY privacy_v2_permanent_retirement_boundary ON public.posts AS RESTRICTIVE
FOR SELECT TO authenticated USING(public.permanent_post_readable(id,user_id));
CREATE OR REPLACE FUNCTION public.list_deleted_posts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'deleted_at',d.deleted_at,
 'purge_after',d.purge_after,'permanent',d.permanent) ORDER BY d.deleted_at DESC),'[]'::jsonb)
 FROM public.posts p JOIN privacy_v2_private.post_deletions d ON d.post_id=p.id AND d.owner_id=p.user_id
 WHERE p.user_id=auth.uid() AND NOT d.permanent
$$;
