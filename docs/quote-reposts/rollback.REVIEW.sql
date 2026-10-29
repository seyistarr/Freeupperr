-- REVIEW ONLY. Full reversal is allowed only BEFORE quote posts exist.
-- After activation use disable.REVIEW.sql first; retain references and authored rows.
BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE public.posts,public.reposts IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.posts WHERE is_quote) THEN RAISE EXCEPTION 'Quote rows exist: disable rollout and retain metadata; do not drop authored quotes'; END IF;
END $$;
DROP TRIGGER IF EXISTS quote_repost_write_guard ON public.posts;
DROP TRIGGER IF EXISTS quote_repost_post_counter ON public.posts;
DROP TRIGGER IF EXISTS quote_repost_canonical_count ON public.posts;
DROP TRIGGER IF EXISTS quote_repost_plain_counter ON public.reposts;
DROP TRIGGER IF EXISTS quote_repost_profile_counter ON public.profiles;
DROP TRIGGER IF EXISTS quote_repost_block_counter ON public.blocks;
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
DROP POLICY IF EXISTS quote_repost_target_insert ON public.posts;
DROP FUNCTION IF EXISTS public.create_quote_post(uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.load_quote_references(uuid[]);
DROP FUNCTION IF EXISTS public.get_quotable_post(uuid);
DROP FUNCTION IF EXISTS public.quote_repost_status();
DROP FUNCTION IF EXISTS privacy_v2_private.quote_write_guard();
DROP FUNCTION IF EXISTS privacy_v2_private.quote_counter_event();
DROP FUNCTION IF EXISTS privacy_v2_private.canonical_repost_count();
DROP FUNCTION IF EXISTS privacy_v2_private.refresh_repost_counts(uuid[]);
DROP FUNCTION IF EXISTS privacy_v2_private.expected_repost_count(uuid);
DROP FUNCTION IF EXISTS public.quote_target_readable(uuid);
DROP FUNCTION IF EXISTS privacy_v2_private.quote_target_allowed(uuid,uuid);
DROP TABLE privacy_v2_private.quote_repost_rollout;
ALTER TABLE public.posts DROP COLUMN quoted_post_id, DROP COLUMN is_quote;
UPDATE public.posts p SET repost_count=(SELECT count(*) FROM public.reposts r WHERE r.post_id=p.id);
NOTIFY pgrst,'reload schema';
COMMIT;
