-- STAGING ONLY. Applied after protected-first; preserve every other transition.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt'
 THEN RAISE EXCEPTION 'Isolated staging acknowledgement required'; END IF;
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='privacy_test.protected_publish_transition(uuid,uuid,text,jsonb)'::regprocedure))
   IS DISTINCT FROM 'aa597ba2adfb0d002f037d113c5db386'
 THEN RAISE EXCEPTION 'Transition schema drift; stop for review'; END IF;
END $$;
CREATE OR REPLACE FUNCTION privacy_test.protected_publish_transition(
  p_owner uuid,p_post uuid,p_action text,p_data jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  p privacy_test.posts%ROWTYPE;
  ticket privacy_test.post_upload_intents%ROWTYPE;
  plan jsonb;
  registry_id uuid;
  refs jsonb;
BEGIN
  SELECT * INTO p FROM privacy_test.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
  IF NOT FOUND OR p.is_deleted IS DISTINCT FROM false OR NOT EXISTS (
    SELECT 1 FROM privacy_test.profiles WHERE id=p_owner AND suspended IS FALSE
  ) THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
  IF p.visibility NOT IN ('followers','friends','only_me') THEN RAISE EXCEPTION 'Restricted draft required'; END IF;
  IF p_action='cancel' THEN
    IF p.publishing_state NOT IN ('draft','failed') THEN RAISE EXCEPTION 'Published posts cannot be cancelled'; END IF;
    UPDATE privacy_test.posts SET publishing_state='failed',is_hidden=true WHERE id=p_post;
    UPDATE privacy_test.post_media_assets SET status='failed' WHERE post_id=p_post;
    UPDATE privacy_test.post_upload_intents SET state='cleanup',cleanup_pending=true WHERE post_id=p_post;
    RETURN jsonb_build_object('status','failed');
  END IF;
  IF p_action='publish' AND p.publishing_state='published' THEN
    RETURN jsonb_build_object('id',p.id,'visibility',p.visibility,'media',p.media,'status','published');
  END IF;
  IF p.publishing_state <> 'draft' OR p.is_hidden IS DISTINCT FROM true OR
     p.draft_expires_at IS NULL OR p.draft_expires_at <= now() THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
  IF p_action IN ('reserve','register') THEN
    SELECT value INTO plan FROM jsonb_array_elements(p.media_plan) WHERE (value->>'slot')::int=(p_data->>'slot')::int;
    IF plan IS NULL THEN RAISE EXCEPTION 'Unexpected media slot'; END IF;
  END IF;
  IF p_action='reserve' THEN
    IF p_data->>'public_id' !~ ('^freeupper-privacy-v2-staging/' || p_owner::text || '/asset_[a-f0-9]{32}$') THEN
      RAISE EXCEPTION 'Invalid asset namespace'; END IF;
    -- The post lock serializes retries. Reissue only the same persisted ID;
    -- never allocate an orphan if the first signature response was lost.
    SELECT * INTO ticket FROM privacy_test.post_upload_intents WHERE post_id=p_post AND slot=(plan->>'slot')::int;
    IF FOUND THEN
      IF ticket.owner_id<>p_owner OR ticket.resource_type<>plan->>'type' OR ticket.state<>'reserved' OR
        ticket.cloudinary_public_id !~ ('^freeupper-privacy-v2-staging/' || p_owner::text || '/asset_[a-f0-9]{32}$')
      THEN RAISE EXCEPTION 'Upload intent unavailable'; END IF;
      RETURN jsonb_build_object('status','reserved','public_id',ticket.cloudinary_public_id,
        'timestamp',floor(extract(epoch FROM ticket.created_at))::bigint);
    END IF;
    INSERT INTO privacy_test.post_upload_intents(post_id,owner_id,slot,cloudinary_public_id,resource_type)
      VALUES(p_post,p_owner,(plan->>'slot')::int,p_data->>'public_id',plan->>'type') RETURNING * INTO ticket;
    RETURN jsonb_build_object('status','reserved','public_id',ticket.cloudinary_public_id,
      'timestamp',floor(extract(epoch FROM ticket.created_at))::bigint);
  ELSIF p_action='register' THEN
    SELECT * INTO ticket FROM privacy_test.post_upload_intents WHERE post_id=p_post AND slot=(plan->>'slot')::int;
    IF NOT FOUND OR ticket.owner_id<>p_owner OR ticket.cloudinary_public_id<>p_data->>'public_id' OR
      ticket.resource_type<>p_data->>'resource_type' THEN RAISE EXCEPTION 'Upload intent mismatch'; END IF;
    IF ticket.state='registered' AND EXISTS (SELECT 1 FROM privacy_test.post_media_assets a
      WHERE a.id=ticket.asset_id AND a.cloudinary_asset_id=p_data->>'cloudinary_asset_id' AND a.status='ready') THEN
      RETURN jsonb_build_object('asset_id',ticket.asset_id,'status','ready');
    END IF;
    IF ticket.state<>'reserved' OR p_data->>'cloudinary_asset_id' !~ '^[a-f0-9]{32}$' OR
      p_data->>'format' !~ '^[a-z0-9]{2,8}$' THEN RAISE EXCEPTION 'Invalid registration'; END IF;
    IF EXISTS (SELECT 1 FROM privacy_test.post_media_assets WHERE cloudinary_asset_id=p_data->>'cloudinary_asset_id') THEN
      RAISE EXCEPTION 'Asset already registered'; END IF;
    registry_id=gen_random_uuid();
    INSERT INTO privacy_test.post_media_assets(id,post_id,owner_id,status,delivery_type,cloudinary_public_id,
      cloudinary_asset_id,resource_type,format) VALUES(registry_id,p_post,p_owner,'ready','authenticated',
      ticket.cloudinary_public_id,p_data->>'cloudinary_asset_id',ticket.resource_type,p_data->>'format');
    UPDATE privacy_test.post_upload_intents SET asset_id=registry_id,state='registered' WHERE id=ticket.id;
    RETURN jsonb_build_object('asset_id',registry_id,'status','ready');
  ELSIF p_action='publish' THEN
    IF jsonb_array_length(p.media_plan) NOT BETWEEN 1 AND 21 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p.media_plan) e WHERE NOT EXISTS (
        SELECT 1 FROM privacy_test.post_upload_intents i JOIN privacy_test.post_media_assets a ON a.id=i.asset_id
        WHERE i.post_id=p_post AND i.slot=(e->>'slot')::int AND i.owner_id=p_owner AND i.state='registered'
          AND i.resource_type=e->>'type' AND a.post_id=p_post AND a.owner_id=p_owner AND a.status='ready'
          AND a.delivery_type='authenticated'
      )
    ) THEN RAISE EXCEPTION 'Incomplete protected media'; END IF;
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('type',e->>'type','asset_id',i.asset_id,
      'thumbnail_asset_id',t.asset_id)) ORDER BY (e->>'slot')::int) INTO refs
      FROM jsonb_array_elements(p.media_plan) e
      JOIN privacy_test.post_upload_intents i ON i.post_id=p_post AND i.slot=(e->>'slot')::int
      LEFT JOIN privacy_test.post_upload_intents t ON t.post_id=p_post AND t.slot=20 AND e->>'type'='video'
      WHERE e->>'role'='media';
    IF refs IS NULL THEN RAISE EXCEPTION 'Missing media'; END IF;
    UPDATE privacy_test.posts SET media=refs,publishing_state='published',is_hidden=false WHERE id=p_post;
    UPDATE privacy_test.post_upload_intents SET cleanup_pending=false WHERE post_id=p_post;
    RETURN jsonb_build_object('id',p_post,'visibility',p.visibility,'media',refs,'status','published');
  END IF;
  RAISE EXCEPTION 'Unknown publishing transition';
END $$;
COMMIT;
