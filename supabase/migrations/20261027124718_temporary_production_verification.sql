-- Reject unexpected production drift before changing any release boundary.
DO $$
BEGIN
 IF md5(pg_get_functiondef('public.protected_publish_transition(uuid,uuid,text,jsonb)'::regprocedure)) <> '080d907f50cc68ea65bce4658140e328' THEN RAISE EXCEPTION 'Production function drift: protected_publish_transition'; END IF;
 IF md5(pg_get_functiondef('public.protected_studio_beta_status()'::regprocedure)) <> '4ecebec19d3e2e4e2c4bd1b35dac8454' THEN RAISE EXCEPTION 'Production function drift: protected_studio_beta_status'; END IF;
 IF md5(pg_get_functiondef('public.freeupper_public_only_guard()'::regprocedure)) <> '29213243e445680f5c321bd07173dd85' THEN RAISE EXCEPTION 'Production function drift: freeupper_public_only_guard'; END IF;
 IF md5(pg_get_functiondef('privacy_v2_private.enforce_restricted_release_gate()'::regprocedure)) <> 'f7d1b83edbe380132550e1d93728a46e' THEN RAISE EXCEPTION 'Production function drift: enforce_restricted_release_gate'; END IF;
 IF md5(pg_get_functiondef('privacy_v2_private.enforce_test_publisher_on_post()'::regprocedure)) <> 'ed8150edc7ebcdbf10c35ff3330fb2b1' THEN RAISE EXCEPTION 'Production function drift: enforce_test_publisher_on_post'; END IF;
 IF public.protected_first_release_status()->>'delivery'<>'false' OR public.protected_first_release_status()->>'publishing'<>'false' OR public.protected_first_release_status()->>'legacy_conversion'<>'false' THEN RAISE EXCEPTION 'General release controls changed'; END IF;
END $$;

-- Temporary production verification is independent of all verified release flags.
CREATE TABLE privacy_v2_private.verification_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 enabled boolean NOT NULL DEFAULT false,
 started_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz,
 CHECK (NOT enabled OR expires_at IS NOT NULL),
 CHECK (expires_at IS NULL OR (expires_at>started_at AND expires_at<=started_at+interval '7 days'))
);
INSERT INTO privacy_v2_private.verification_control(singleton) VALUES(true);
CREATE TABLE privacy_v2_private.verification_posts (
 post_id uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 owner_id uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 retired_at timestamptz,
 CHECK (expires_at>created_at AND expires_at<=created_at+interval '24 hours')
);
CREATE INDEX verification_posts_owner ON privacy_v2_private.verification_posts(owner_id,created_at);
ALTER TABLE privacy_v2_private.verification_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_v2_private.verification_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_v2_private.verification_control,privacy_v2_private.verification_posts FROM PUBLIC,anon,authenticated;
GRANT ALL ON privacy_v2_private.verification_control,privacy_v2_private.verification_posts TO service_role;

CREATE FUNCTION privacy_v2_private.verification_publisher_eligible(p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT p_owner IN ('9341af03-e007-4fc6-9c23-b06073379088'::uuid,
   'a0a53cb6-be86-4862-b267-f7f43d4cf324'::uuid,'5b5bd4b3-22df-41e7-8e6e-2dae82ee68df'::uuid)
 AND public.protected_publisher_beta_allowed(p_owner)
 AND public.privacy_v2_test_publisher_allowed(p_owner)
 AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner AND suspended IS FALSE)
$$;
CREATE FUNCTION privacy_v2_private.verification_owner_active(p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce(privacy_v2_private.verification_publisher_eligible(p_owner),false)
 AND EXISTS(SELECT 1 FROM privacy_v2_private.verification_control WHERE singleton AND enabled AND expires_at>now())
$$;
CREATE FUNCTION privacy_v2_private.verification_post_active(p_post uuid,p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT privacy_v2_private.verification_owner_active(p_owner)
 AND EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts
   WHERE post_id=p_post AND owner_id=p_owner AND retired_at IS NULL AND expires_at>now())
$$;
CREATE FUNCTION privacy_v2_private.protected_publish_allowed(p_owner uuid,p_post uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts WHERE post_id=p_post) THEN
  RETURN privacy_v2_private.verification_post_active(p_post,p_owner);
 END IF;
 RETURN public.protected_first_release_status()->>'publishing'='true'
   AND public.protected_first_release_status()->>'delivery'='true'
   AND public.protected_publishing_capabilities()->>'ready'='true'
   AND public.protected_first_capabilities()->>'new_protected_posts'='true';
END $$;
CREATE FUNCTION public.protected_publishing_access(p_owner uuid,p_post uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE mode text:='disabled'; until_time timestamptz;
BEGIN
 IF p_post IS NOT NULL AND EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts WHERE post_id=p_post) THEN
  IF privacy_v2_private.verification_post_active(p_post,p_owner) THEN
   mode:='verification';
   SELECT expires_at INTO until_time FROM privacy_v2_private.verification_posts WHERE post_id=p_post AND owner_id=p_owner;
  END IF;
 ELSIF p_post IS NULL AND privacy_v2_private.verification_owner_active(p_owner) THEN
  mode:='verification';
  SELECT expires_at INTO until_time FROM privacy_v2_private.verification_control WHERE singleton;
 ELSIF public.protected_publisher_beta_allowed(p_owner)
   AND privacy_v2_private.protected_publish_allowed(p_owner,p_post) THEN mode:='production';
 END IF;
 RETURN jsonb_build_object('mode',mode,'expires_at',until_time);
END $$;
CREATE OR REPLACE FUNCTION public.protected_studio_beta_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE access jsonb;
BEGIN
 access:=public.protected_publishing_access(auth.uid(),NULL);
 RETURN jsonb_build_object('approved',auth.uid() IS NOT NULL AND public.protected_publisher_beta_allowed(auth.uid()),
   'ready',access->>'mode' IN ('verification','production'),'mode',access->>'mode',
   'verification_expires_at',access->'expires_at');
END $$;
CREATE FUNCTION public.create_verification_draft(p_owner uuid,p_post uuid,p_visibility text,p_plan jsonb,p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE expires timestamptz;
BEGIN
 IF NOT privacy_v2_private.verification_owner_active(p_owner) THEN
  RAISE EXCEPTION 'Verification publisher unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 IF (SELECT count(*) FROM privacy_v2_private.verification_posts WHERE owner_id=p_owner AND retired_at IS NULL)>=10 THEN
  RAISE EXCEPTION 'Clean up verification posts before creating more' USING ERRCODE='23514';
 END IF;
 IF p_post IS NULL OR EXISTS(SELECT 1 FROM public.posts WHERE id=p_post)
   OR p_visibility NOT IN ('followers','friends','only_me') OR p_visibility IS NULL
   OR NOT privacy_v2_private.valid_protected_media_plan(p_plan)
   OR NOT privacy_v2_private.valid_protected_draft_fields(p_fields) THEN
  RAISE EXCEPTION 'Invalid verification draft' USING ERRCODE='23514';
 END IF;
 SELECT least(now()+interval '24 hours',expires_at) INTO expires
   FROM privacy_v2_private.verification_control WHERE singleton AND enabled AND expires_at>now() FOR SHARE;
 IF expires IS NULL THEN RAISE EXCEPTION 'Verification expired'; END IF;
 -- Deferred FK makes the marker and new post atomic; existing posts cannot be converted.
 INSERT INTO privacy_v2_private.verification_posts(post_id,owner_id,expires_at) VALUES(p_post,p_owner,expires);
 INSERT INTO public.posts(id,user_id,title,content,source,tags,comments_hidden,media_type,visibility,is_hidden,is_deleted,publishing_state,media,media_plan,publish_payload,draft_expires_at)
 VALUES(p_post,p_owner,coalesce(p_fields->>'title',''),coalesce(p_fields->>'content',''),p_fields->>'source',
   ARRAY(SELECT jsonb_array_elements_text(p_fields->'tags')),coalesce((p_fields->>'comments_hidden')::boolean,false),
   p_plan->0->>'type',p_visibility,true,false,'draft','[]'::jsonb,p_plan,p_fields,least(expires,now()+interval '1 hour'));
 INSERT INTO privacy_v2_private.protected_post_origins(post_id,owner_id) VALUES(p_post,p_owner);
 RETURN jsonb_build_object('post_id',p_post,'state','draft','verification',true,'expires_at',expires);
END $$;
CREATE FUNCTION public.protected_media_release_allowed(p_asset uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE p uuid; owner uuid;
BEGIN
 SELECT post_id,owner_id INTO p,owner FROM public.post_media_assets WHERE id=p_asset;
 IF p IS NOT NULL AND EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts WHERE post_id=p) THEN
  RETURN privacy_v2_private.verification_post_active(p,owner);
 END IF;
 RETURN public.protected_first_release_status()->>'delivery'='true';
END $$;
CREATE FUNCTION public.verification_post_readable(p_post uuid,p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT auth.uid() IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts WHERE post_id=p_post)
   OR privacy_v2_private.verification_post_active(p_post,p_owner))
$$;
REVOKE ALL ON FUNCTION public.verification_post_readable(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.verification_post_readable(uuid,uuid) TO authenticated;
CREATE POLICY privacy_v2_verification_lifetime ON public.posts AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.verification_post_readable(id,user_id));

CREATE FUNCTION public.list_verification_posts(p_owner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.post_id,'created_at',v.created_at,'expires_at',v.expires_at,
   'retired',v.retired_at IS NOT NULL,'visibility',p.visibility,'status',p.publishing_state,
   'cleanupPending',EXISTS(SELECT 1 FROM public.post_upload_intents i WHERE i.post_id=v.post_id AND i.cleanup_pending))
   ORDER BY v.created_at DESC),'[]'::jsonb)
 FROM privacy_v2_private.verification_posts v JOIN public.posts p ON p.id=v.post_id AND p.user_id=v.owner_id WHERE v.owner_id=p_owner
$$;
CREATE FUNCTION public.retire_verification_post(p_owner uuid,p_post uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 PERFORM 1 FROM privacy_v2_private.verification_posts WHERE post_id=p_post AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Verification post unavailable' USING ERRCODE='42501'; END IF;
 UPDATE privacy_v2_private.verification_posts SET retired_at=coalesce(retired_at,now()) WHERE post_id=p_post;
 UPDATE public.posts SET is_hidden=true,is_deleted=true,publishing_state='failed' WHERE id=p_post AND user_id=p_owner;
 UPDATE public.post_media_assets SET status='failed' WHERE post_id=p_post AND owner_id=p_owner;
 UPDATE public.post_upload_intents SET state='cleanup',cleanup_pending=true,
   cleanup_after=greatest(coalesce(cleanup_after,now()),created_at+interval '65 minutes')
   WHERE post_id=p_post AND owner_id=p_owner AND state<>'cleanup';
 RETURN jsonb_build_object('id',p_post,'retired',true);
END $$;
CREATE FUNCTION public.claim_verification_cleanup(p_owner uuid,p_post uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts WHERE post_id=p_post AND owner_id=p_owner AND retired_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Verification cleanup unavailable' USING ERRCODE='42501';
 END IF;
 WITH picked AS (
  SELECT i.id FROM public.post_upload_intents i WHERE i.post_id=p_post AND i.owner_id=p_owner
   AND i.state='cleanup' AND i.cleanup_pending
   AND (i.cleanup_after IS NULL OR i.cleanup_after<=now())
   AND (i.cleanup_lease_until IS NULL OR i.cleanup_lease_until<now())
   AND i.cloudinary_public_id ~ ('^freeupper-protected-v2/'||p_owner::text||'/asset_[a-f0-9]{32}$')
  ORDER BY i.created_at FOR UPDATE SKIP LOCKED LIMIT 21
 ), leased AS (
  UPDATE public.post_upload_intents i SET cleanup_lease=gen_random_uuid(),cleanup_lease_until=now()+interval '2 minutes',
   cleanup_attempts=coalesce(cleanup_attempts,0)+1 FROM picked WHERE i.id=picked.id
  RETURNING i.id,i.cloudinary_public_id,i.cleanup_lease
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_id',cloudinary_public_id,'lease',cleanup_lease)),'[]'::jsonb) INTO result FROM leased;
 RETURN result;
END $$;


CREATE OR REPLACE FUNCTION public.protected_publish_transition(p_owner uuid, p_post uuid, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  p public.posts%ROWTYPE;
  ticket public.post_upload_intents%ROWTYPE;
  plan jsonb;
  registry_id uuid;
  refs jsonb;
BEGIN
  -- Fail closed before any action (including cancel/reserve/register).
  IF NOT privacy_v2_private.protected_publish_allowed(p_owner,p_post)
  THEN RAISE EXCEPTION 'Protected publishing release is disabled' USING ERRCODE='23514'; END IF;
  IF p_owner IS NULL OR p_post IS NULL OR p_action IS NULL OR
    NOT EXISTS (SELECT 1 FROM privacy_v2_private.protected_post_origins o
                WHERE o.post_id=p_post AND o.owner_id=p_owner)
  THEN RAISE EXCEPTION 'Registered protected origin required' USING ERRCODE='23514'; END IF;
  SELECT * INTO p FROM public.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
  IF NOT FOUND OR p.is_deleted IS DISTINCT FROM false OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=p_owner AND suspended IS FALSE
  ) THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
  IF p.visibility NOT IN ('followers','friends','only_me')
    OR NOT privacy_v2_private.valid_protected_media_plan(p.media_plan)
    OR NOT privacy_v2_private.valid_protected_draft_fields(p.publish_payload)
  THEN RAISE EXCEPTION 'Invalid registered restricted draft'; END IF;
  IF p_action='cancel' THEN
    IF p.publishing_state NOT IN ('draft','failed') THEN RAISE EXCEPTION 'Published posts cannot be cancelled'; END IF;
    UPDATE public.posts SET publishing_state='failed',is_hidden=true WHERE id=p_post;
    UPDATE public.post_media_assets SET status='failed' WHERE post_id=p_post;
    UPDATE public.post_upload_intents SET state='cleanup',cleanup_pending=true,
      cleanup_after=CASE WHEN EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts WHERE post_id=p_post)
        THEN greatest(coalesce(cleanup_after,now()),created_at+interval '65 minutes') ELSE cleanup_after END
      WHERE post_id=p_post;
    RETURN jsonb_build_object('status','failed');
  END IF;
  IF p_action='publish' AND p.publishing_state='published' THEN
    RETURN jsonb_build_object('id',p.id,'visibility',p.visibility,'media',p.media,'status','published');
  END IF;
  IF p.publishing_state <> 'draft' OR p.is_hidden IS DISTINCT FROM true OR
     p.draft_expires_at IS NULL OR p.draft_expires_at <= now() THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
  IF p_action IN ('reserve','register') AND
    (jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR
     jsonb_typeof(p_data->'slot') IS DISTINCT FROM 'number' OR
     (p_data->>'slot') !~ '^(0|[1-9][0-9]?)$')
  THEN RAISE EXCEPTION 'Invalid media slot'; END IF;
  IF p_action IN ('reserve','register') THEN
    SELECT value INTO plan FROM jsonb_array_elements(p.media_plan) WHERE (value->>'slot')::int=(p_data->>'slot')::int;
    IF plan IS NULL THEN RAISE EXCEPTION 'Unexpected media slot'; END IF;
  END IF;
  IF p_action='reserve' THEN
    IF p_data->>'public_id' !~ ('^freeupper-protected-v2/' || p_owner::text || '/asset_[a-f0-9]{32}$') THEN
      RAISE EXCEPTION 'Invalid asset namespace'; END IF;
    -- The post lock serializes retries. Reissue only the same persisted ID;
    -- never allocate an orphan if the first signature response was lost.
    SELECT * INTO ticket FROM public.post_upload_intents WHERE post_id=p_post AND slot=(plan->>'slot')::int;
    IF FOUND THEN
      IF ticket.owner_id<>p_owner OR ticket.resource_type<>plan->>'type' OR ticket.state<>'reserved' OR
        ticket.cloudinary_public_id !~ ('^freeupper-protected-v2/' || p_owner::text || '/asset_[a-f0-9]{32}$')
      THEN RAISE EXCEPTION 'Upload intent unavailable'; END IF;
      RETURN jsonb_build_object('status','reserved','public_id',ticket.cloudinary_public_id,
        'timestamp',floor(extract(epoch FROM ticket.created_at))::bigint);
    END IF;
    INSERT INTO public.post_upload_intents(post_id,owner_id,slot,cloudinary_public_id,resource_type)
      VALUES(p_post,p_owner,(plan->>'slot')::int,p_data->>'public_id',plan->>'type') RETURNING * INTO ticket;
    RETURN jsonb_build_object('status','reserved','public_id',ticket.cloudinary_public_id,
      'timestamp',floor(extract(epoch FROM ticket.created_at))::bigint);
  ELSIF p_action='register' THEN
    SELECT * INTO ticket FROM public.post_upload_intents WHERE post_id=p_post AND slot=(plan->>'slot')::int;
    IF NOT FOUND OR ticket.owner_id<>p_owner OR ticket.cloudinary_public_id<>p_data->>'public_id' OR
      ticket.resource_type<>p_data->>'resource_type' THEN RAISE EXCEPTION 'Upload intent mismatch'; END IF;
    IF ticket.state='registered' AND EXISTS (SELECT 1 FROM public.post_media_assets a
      WHERE a.id=ticket.asset_id AND a.cloudinary_asset_id=p_data->>'cloudinary_asset_id' AND a.status='ready') THEN
      RETURN jsonb_build_object('asset_id',ticket.asset_id,'status','ready');
    END IF;
    IF ticket.state<>'reserved' OR p_data->>'cloudinary_asset_id' !~ '^[a-f0-9]{32}$' OR
      p_data->>'format' !~ '^[a-z0-9]{2,8}$' THEN RAISE EXCEPTION 'Invalid registration'; END IF;
    IF EXISTS (SELECT 1 FROM public.post_media_assets WHERE cloudinary_asset_id=p_data->>'cloudinary_asset_id') THEN
      RAISE EXCEPTION 'Asset already registered'; END IF;
    registry_id=gen_random_uuid();
    INSERT INTO public.post_media_assets(id,post_id,owner_id,status,delivery_type,cloudinary_public_id,
      cloudinary_asset_id,resource_type,format) VALUES(registry_id,p_post,p_owner,'ready','authenticated',
      ticket.cloudinary_public_id,p_data->>'cloudinary_asset_id',ticket.resource_type,p_data->>'format');
    UPDATE public.post_upload_intents SET asset_id=registry_id,state='registered' WHERE id=ticket.id;
    RETURN jsonb_build_object('asset_id',registry_id,'status','ready');
  ELSIF p_action='publish' THEN
    IF NOT privacy_v2_private.valid_protected_media_plan(p.media_plan) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p.media_plan) e WHERE NOT EXISTS (
        SELECT 1 FROM public.post_upload_intents i JOIN public.post_media_assets a ON a.id=i.asset_id
        WHERE i.post_id=p_post AND i.slot=(e->>'slot')::int AND i.owner_id=p_owner AND i.state='registered'
          AND i.resource_type=e->>'type' AND a.post_id=p_post AND a.owner_id=p_owner AND a.status='ready'
          AND a.delivery_type='authenticated'
      )
    ) THEN RAISE EXCEPTION 'Incomplete protected media'; END IF;
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('type',e->>'type','asset_id',i.asset_id,
      'thumbnail_asset_id',t.asset_id)) ORDER BY (e->>'slot')::int) INTO refs
      FROM jsonb_array_elements(p.media_plan) e
      JOIN public.post_upload_intents i ON i.post_id=p_post AND i.slot=(e->>'slot')::int
      LEFT JOIN public.post_upload_intents t ON t.post_id=p_post AND t.slot=20 AND e->>'type'='video'
      WHERE e->>'role'='media';
    IF refs IS NULL THEN RAISE EXCEPTION 'Missing media'; END IF;
    UPDATE public.posts SET media=refs,publishing_state='published',is_hidden=false WHERE id=p_post;
    UPDATE public.post_upload_intents SET cleanup_pending=false WHERE post_id=p_post;
    RETURN jsonb_build_object('id',p_post,'visibility',p.visibility,'media',refs,'status','published');
  END IF;
  RAISE EXCEPTION 'Unknown publishing transition';
END $function$;


CREATE OR REPLACE FUNCTION public.freeupper_public_only_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF TG_OP='INSERT' AND NEW.visibility IS DISTINCT FROM 'public' THEN
  IF NOT (
   current_user='postgres'
   AND NEW.visibility IN ('followers','friends','only_me')
   AND NEW.publishing_state='draft'
   AND NEW.is_hidden IS TRUE
   AND privacy_v2_private.protected_publish_allowed(NEW.user_id,NEW.id)
  ) THEN
   RAISE EXCEPTION 'Restricted post publishing is disabled' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.visibility IS DISTINCT FROM OLD.visibility
  AND NEW.visibility IS DISTINCT FROM 'public' THEN
  RAISE EXCEPTION 'Restricted audience changes require reviewed transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $function$;


CREATE OR REPLACE FUNCTION privacy_v2_private.enforce_restricted_release_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.is_hidden IS TRUE AND NEW.is_deleted IS TRUE AND NEW.publishing_state='failed'
 AND EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts WHERE post_id=NEW.id AND owner_id=NEW.user_id AND retired_at IS NOT NULL) THEN
  RETURN NEW;
 END IF;
 IF NEW.visibility IS DISTINCT FROM 'public'
 AND (NEW.publishing_state IS DISTINCT FROM 'draft' OR NEW.is_hidden IS DISTINCT FROM TRUE)
 AND NOT (
  EXISTS (SELECT 1 FROM privacy_v2_private.release_control WHERE singleton=true AND restricted_enabled=true)
  OR privacy_v2_private.verification_post_active(NEW.id,NEW.user_id)
 ) THEN
  RAISE EXCEPTION 'Restricted posts cannot become visible while release is disabled' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $function$;


CREATE OR REPLACE FUNCTION privacy_v2_private.enforce_test_publisher_on_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin if new.is_hidden is true and new.is_deleted is true and new.publishing_state='failed' and exists(select 1 from privacy_v2_private.verification_posts where post_id=new.id and owner_id=new.user_id and retired_at is not null) then return new; end if; if new.visibility in ('followers','friends','only_me') and (tg_op='INSERT' or (tg_op='UPDATE' and (old.visibility is distinct from new.visibility or old.publishing_state is distinct from new.publishing_state or old.is_hidden is distinct from new.is_hidden))) and not public.privacy_v2_test_publisher_allowed(new.user_id) then raise exception 'Restricted publishing requires approved test publisher' using errcode='42501'; end if; return new; end; $function$;


REVOKE ALL ON FUNCTION privacy_v2_private.verification_publisher_eligible(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_v2_private.verification_publisher_eligible(uuid) TO service_role;

REVOKE ALL ON FUNCTION privacy_v2_private.verification_owner_active(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_v2_private.verification_owner_active(uuid) TO service_role;

REVOKE ALL ON FUNCTION privacy_v2_private.verification_post_active(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_v2_private.verification_post_active(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION privacy_v2_private.protected_publish_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_v2_private.protected_publish_allowed(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.protected_publishing_access(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.protected_publishing_access(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.create_verification_draft(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_verification_draft(uuid,uuid,text,jsonb,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.protected_media_release_allowed(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.protected_media_release_allowed(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.list_verification_posts(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_verification_posts(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.retire_verification_post(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retire_verification_post(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.claim_verification_cleanup(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_verification_cleanup(uuid,uuid) TO service_role;
