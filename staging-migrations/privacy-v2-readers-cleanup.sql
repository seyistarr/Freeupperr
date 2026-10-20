-- Isolated staging only; apply after privacy-v2-protected-publishing.sql.
-- SET freeupper.privacy_v2_project_ref = 'tagkrhvgcbnybiuyvjxt';
BEGIN;
DO $$ BEGIN
  IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt' THEN
    RAISE EXCEPTION 'Explicit isolated staging project acknowledgement required';
  END IF;
END $$;
ALTER TABLE privacy_test.posts
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cleanup_lease uuid,
  ADD COLUMN IF NOT EXISTS cleanup_lease_until timestamptz;
ALTER TABLE privacy_test.post_upload_intents
  ADD COLUMN IF NOT EXISTS cleanup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleanup_after timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS privacy_v2_published_feed ON privacy_test.posts(created_at DESC,id DESC)
  WHERE publishing_state='published' AND is_hidden=false AND is_deleted=false;
CREATE INDEX IF NOT EXISTS privacy_v2_expiring_drafts ON privacy_test.posts(draft_expires_at)
  WHERE publishing_state='draft';
CREATE INDEX IF NOT EXISTS privacy_v2_cleanup_retry ON privacy_test.post_upload_intents(cleanup_after,post_id)
  WHERE cleanup_pending;
REVOKE INSERT,UPDATE,DELETE ON privacy_test.profiles,privacy_test.follows FROM PUBLIC,anon,authenticated;
GRANT SELECT ON privacy_test.posts,privacy_test.profiles,privacy_test.follows TO authenticated;
GRANT USAGE ON SCHEMA privacy_test TO authenticated,service_role;

-- An independent restrictive boundary prevents an older permissive owner policy
-- (or a future broad policy) from exposing drafts, deleted posts or wrong audiences.
DROP POLICY IF EXISTS privacy_v2_audience_boundary ON privacy_test.posts;
CREATE POLICY privacy_v2_audience_boundary ON privacy_test.posts AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING (
  publishing_state='published' AND is_hidden IS FALSE AND is_deleted IS FALSE AND
  EXISTS (SELECT 1 FROM privacy_test.profiles a WHERE a.id=posts.user_id AND a.suspended IS FALSE AND
    ((auth.uid()=posts.user_id) OR
     (visibility='public' AND a.is_private IS FALSE) OR
     (visibility IN ('public','followers','friends') AND
      EXISTS (SELECT 1 FROM privacy_test.follows f WHERE f.follower_id=auth.uid()
        AND f.following_id=posts.user_id AND f.status='active') AND
      (visibility<>'friends' OR EXISTS (SELECT 1 FROM privacy_test.follows f
        WHERE f.follower_id=posts.user_id AND f.following_id=auth.uid() AND f.status='active')))))
);
CREATE OR REPLACE FUNCTION privacy_test.read_protected_posts(
  p_id uuid DEFAULT NULL,p_author uuid DEFAULT NULL,p_source text DEFAULT NULL,
  p_query text DEFAULT '',p_offset integer DEFAULT 0,p_limit integer DEFAULT 20
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(result ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM (
    SELECT p.created_at,p.id,jsonb_build_object(
      'id',p.id,'user_id',p.user_id,'visibility',p.visibility,'publishing_state',p.publishing_state,
      'created_at',p.created_at,'title',left(coalesce(p.publish_payload->>'title',''),200),
      'content',left(coalesce(p.publish_payload->>'content',''),20000),
      'tags',coalesce(p.publish_payload->'tags','[]'::jsonb),
      'source',coalesce(p.publish_payload->>'source','composer'),
      'comments_hidden',coalesce((p.publish_payload->>'comments_hidden')::boolean,false),
      'media',coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
         'asset_id',m->>'asset_id','type',m->>'type','thumbnail_asset_id',m->>'thumbnail_asset_id')))
         FROM jsonb_array_elements(p.media) m),'[]'::jsonb),
      'media_type',coalesce(p.media->0->>'type','text'),
      'profiles',jsonb_build_object('id',a.id,'display_name','Staging member',
         'username','staging-'||left(a.id::text,8),'is_private',a.is_private)
    ) result FROM privacy_test.posts p JOIN privacy_test.profiles a ON a.id=p.user_id
    WHERE auth.uid() IS NOT NULL AND p.publishing_state='published' AND p.is_hidden=false AND p.is_deleted=false
      AND (p_id IS NULL OR p.id=p_id) AND (p_author IS NULL OR p.user_id=p_author)
      AND (p_source IS NULL OR p.publish_payload->>'source'=p_source)
      AND (coalesce(p_query,'')='' OR position(lower(left(p_query,200)) IN
          lower(coalesce(p.publish_payload->>'title','')||' '||coalesce(p.publish_payload->>'content','')))>0)
    ORDER BY p.created_at DESC,p.id DESC LIMIT greatest(1,least(p_limit,50)) OFFSET greatest(0,least(p_offset,10000))
  ) visible;
$$;
REVOKE ALL ON FUNCTION privacy_test.read_protected_posts(uuid,uuid,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION privacy_test.read_protected_posts(uuid,uuid,text,text,integer,integer) TO authenticated;

-- Cleanup claims serialize against publication using the same post row lock.
-- Only service_role may call; owner endpoints supply the authenticated owner,
-- and the worker obtains owners exclusively from the candidate query below.
CREATE OR REPLACE FUNCTION privacy_test.claim_protected_cleanup(
  p_owner uuid,p_post uuid,p_lease uuid,p_expired_only boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p privacy_test.posts%ROWTYPE; tickets jsonb;
BEGIN
  SELECT * INTO p FROM privacy_test.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
  IF p.publishing_state NOT IN ('draft','failed') THEN
    RETURN jsonb_build_object('claimed',false,'status','published'); END IF;
  IF p_expired_only AND p.publishing_state='draft' AND (p.draft_expires_at IS NULL OR p.draft_expires_at>now()) THEN
    RETURN jsonb_build_object('claimed',false,'status','active'); END IF;
  IF p.cleanup_lease_until>now() THEN RETURN jsonb_build_object('claimed',false,'status','busy'); END IF;
  UPDATE privacy_test.posts SET publishing_state='failed',is_hidden=true,cleanup_lease=p_lease,
    cleanup_lease_until=now()+interval '5 minutes' WHERE id=p_post;
  UPDATE privacy_test.post_media_assets SET status='failed' WHERE post_id=p_post AND owner_id=p_owner;
  UPDATE privacy_test.post_upload_intents SET state='cleanup' WHERE post_id=p_post AND owner_id=p_owner;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'cloudinary_public_id',i.cloudinary_public_id,
    'resource_type',i.resource_type)),'[]'::jsonb) INTO tickets FROM privacy_test.post_upload_intents i
    WHERE i.post_id=p_post AND i.owner_id=p_owner AND i.cleanup_pending AND i.cleanup_after<=now();
  RETURN jsonb_build_object('claimed',true,'intents',tickets,'status','failed');
END $$;
CREATE OR REPLACE FUNCTION privacy_test.record_protected_cleanup(
  p_owner uuid,p_post uuid,p_lease uuid,p_results jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p privacy_test.posts%ROWTYPE; item jsonb; pending boolean;
BEGIN
  SELECT * INTO p FROM privacy_test.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
  IF NOT FOUND OR p.publishing_state<>'failed' OR p.cleanup_lease IS DISTINCT FROM p_lease THEN
    RAISE EXCEPTION 'Cleanup lease unavailable'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    UPDATE privacy_test.post_upload_intents SET cleanup_attempts=cleanup_attempts+1,
      cleanup_pending=NOT (item->>'ok'='true' AND created_at+interval '65 minutes'<=now()),
      cleanup_after=CASE WHEN item->>'ok'='true' THEN greatest(now()+interval '1 minute',created_at+interval '65 minutes')
        ELSE now()+make_interval(secs=>least(3600,60*power(2,least(cleanup_attempts,6)))::int) END
      WHERE id=(item->>'id')::uuid AND post_id=p_post AND owner_id=p_owner AND state='cleanup';
  END LOOP;
  UPDATE privacy_test.posts SET cleanup_lease=NULL,cleanup_lease_until=NULL WHERE id=p_post;
  SELECT EXISTS (SELECT 1 FROM privacy_test.post_upload_intents WHERE post_id=p_post AND cleanup_pending) INTO pending;
  RETURN jsonb_build_object('id',p_post,'status','failed','cleanupPending',pending);
END $$;
CREATE OR REPLACE FUNCTION privacy_test.protected_cleanup_candidates(p_limit integer DEFAULT 5)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'owner_id',user_id)),'[]'::jsonb) FROM (
    SELECT p.id,p.user_id FROM privacy_test.posts p
    WHERE (p.cleanup_lease_until IS NULL OR p.cleanup_lease_until<=now()) AND
      ((p.publishing_state='draft' AND p.draft_expires_at<=now()) OR
       (p.publishing_state='failed' AND EXISTS (SELECT 1 FROM privacy_test.post_upload_intents i
        WHERE i.post_id=p.id AND i.cleanup_pending AND i.cleanup_after<=now())))
    ORDER BY p.draft_expires_at NULLS LAST,p.id LIMIT greatest(1,least(p_limit,10))
  ) candidates;
$$;
REVOKE ALL ON FUNCTION privacy_test.claim_protected_cleanup(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION privacy_test.record_protected_cleanup(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION privacy_test.protected_cleanup_candidates(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_test.claim_protected_cleanup(uuid,uuid,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION privacy_test.record_protected_cleanup(uuid,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION privacy_test.protected_cleanup_candidates(integer) TO service_role;
CREATE OR REPLACE FUNCTION privacy_test.protected_publishing_capabilities()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT '{"version":2}'::jsonb $$;
COMMIT;
