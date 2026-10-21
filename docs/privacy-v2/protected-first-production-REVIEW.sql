-- GENERATED REVIEW ONLY. DO NOT EXECUTE OR ACTIVATE WITHOUT EXPLICIT APPROVAL.
-- Rebuild: node scripts/privacy-v2/prepare-protected-first.mjs --write-review
-- No legacy job, consent, deletion, observation or 31-day dependency.
-- Prerequisites: registry/global uniqueness, production expansion, approved
-- follows, audience RLS, visibility-preserving edits and RPC exposure fixes.
-- Source SHA256:
-- staging-migrations/privacy-v2-protected-publishing.sql 83784cdf7d6d32704113618df3e37f9d34247e1469c6970792496c716a4d28e8
-- staging-migrations/privacy-v2-readers-cleanup.sql f868ddf25d1ad2ef4137048d94ffe01891219dc6319a58e329ab1a04c140a2a3
-- staging-migrations/privacy-v2-protected-first.sql 0b1e6ab1887a333a77954d2971388979c1162d1f16c594de57f06aa3b23be9c4
-- staging-migrations/privacy-v2-upload-reservation-retry.sql db3671b0ac06912e69d707d6357fbcda9004f2d14d632fd6770f19cef1fe78ae
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'jmjtqidirpmnegzvmiaq'
 OR current_setting('freeupper.privacy_v2_reviewed_release',true) IS DISTINCT FROM 'approved-production-migration'
 THEN RAISE EXCEPTION 'Explicit production migration approval required'; END IF;
 IF to_regprocedure('privacy_v2_private.can_view_post_for(uuid,uuid)') IS NULL OR
    to_regprocedure('privacy_v2_private.approved_edge(uuid,uuid)') IS NULL OR
    NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='posts' AND policyname='privacy_v2_approved_audience')
 THEN RAISE EXCEPTION 'Reviewed production authorization prerequisites required'; END IF;
END $$;
ALTER TABLE privacy_v2_private.release_control
 ADD COLUMN new_protected_enabled boolean NOT NULL DEFAULT false CHECK(new_protected_enabled=false),
 ADD COLUMN protected_delivery_enabled boolean NOT NULL DEFAULT false CHECK(protected_delivery_enabled=false);
GRANT SELECT ON privacy_v2_private.release_control TO service_role;
GRANT EXECUTE ON FUNCTION privacy_v2_private.can_view_post_for(uuid,uuid),privacy_v2_private.approved_edge(uuid,uuid) TO service_role;
-- Existing restricted_enabled remains false: legacy conversion cannot activate.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS cleanup_lease uuid,
 ADD COLUMN IF NOT EXISTS cleanup_lease_until timestamptz;
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS publishing_state text NOT NULL DEFAULT 'published'
    CHECK (publishing_state IN ('draft','published','failed')),
  ADD COLUMN IF NOT EXISTS publish_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS media_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS media jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS draft_expires_at timestamptz;

-- Legacy audience test fixtures deliberately reuse IDs outside the upload namespace.
-- Preserve those fixtures; every upload that this workflow accepts is namespace-scoped.
CREATE UNIQUE INDEX IF NOT EXISTS post_media_assets_protected_unique_asset
  ON public.post_media_assets(cloudinary_asset_id)
  WHERE cloudinary_asset_id IS NOT NULL AND cloudinary_public_id LIKE 'freeupper-protected-v2/%';
CREATE TABLE IF NOT EXISTS public.post_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id),
  owner_id uuid NOT NULL REFERENCES public.profiles(id),
  slot integer NOT NULL CHECK (slot BETWEEN 0 AND 20),
  cloudinary_public_id text NOT NULL UNIQUE,
  resource_type text NOT NULL CHECK (resource_type IN ('image','video')),
  asset_id uuid REFERENCES public.post_media_assets(id),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','registered','cleanup')),
  cleanup_pending boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id,slot)
);
CREATE INDEX IF NOT EXISTS privacy_v2_upload_cleanup ON public.post_upload_intents(post_id) WHERE cleanup_pending;
ALTER TABLE public.post_upload_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_upload_intents FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.post_upload_intents TO service_role;
-- No browser mutations; publishing can only happen through the checked server route.
REVOKE ALL ON public.post_media_assets FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS privacy_v2_published_only ON public.posts;
CREATE POLICY privacy_v2_published_only ON public.posts AS RESTRICTIVE FOR SELECT
  TO anon,authenticated USING (publishing_state = 'published');

ALTER TABLE public.post_upload_intents ADD COLUMN IF NOT EXISTS cleanup_attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS cleanup_after timestamptz NOT NULL DEFAULT now();

CREATE TABLE privacy_v2_private.protected_post_origins (
 post_id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE privacy_v2_private.protected_post_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_v2_private.protected_post_origins FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON privacy_v2_private.protected_post_origins TO service_role;

CREATE FUNCTION public.create_protected_draft(p_owner uuid,p_post uuid,p_visibility text,p_plan jsonb,p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item jsonb; videos integer; images integer;
BEGIN
 IF p_post IS NULL OR p_owner IS NULL OR p_visibility IS NULL OR p_visibility NOT IN ('followers','friends','only_me') OR
  jsonb_typeof(p_plan) IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan) NOT BETWEEN 1 AND 20 OR
  NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner AND suspended=false)
 THEN RAISE EXCEPTION 'Owned restricted image/video draft required'; END IF;
 -- A video plan has exactly two slots: video 0 and required image poster 20.
 SELECT count(*) FILTER(WHERE value->>'type'='video'),count(*) FILTER(WHERE value->>'type'='image')
  INTO videos,images FROM jsonb_array_elements(p_plan);
 IF videos=0 THEN
  IF images<>jsonb_array_length(p_plan) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_plan) WITH ORDINALITY e(value,n)
    WHERE value<>jsonb_build_object('slot',n-1,'type','image','role','media'))
  THEN RAISE EXCEPTION 'Up to twenty ordered images required'; END IF;
 ELSIF videos<>1 OR images<>1 OR p_plan<>'[{"slot":0,"type":"video","role":"media"},{"slot":20,"type":"image","role":"thumbnail"}]'::jsonb
 THEN RAISE EXCEPTION 'One video and its protected poster required'; END IF;
 IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object' OR
  (p_fields-ARRAY['title','content','tags','source','comments_hidden'])<>'{}'::jsonb OR
  coalesce(p_fields->>'source','') NOT IN ('composer','studio') OR
  p_fields::text ~* '(https?://|blob:|data:|cloudinary\.com|/upload/)' OR
  (p_fields ? 'title' AND jsonb_typeof(p_fields->'title')<>'string') OR
  (p_fields ? 'content' AND jsonb_typeof(p_fields->'content')<>'string') OR
  length(coalesce(p_fields->>'title',''))>200 OR length(coalesce(p_fields->>'content',''))>20000 OR
  (p_fields ? 'comments_hidden' AND jsonb_typeof(p_fields->'comments_hidden')<>'boolean') OR
  jsonb_typeof(p_fields->'tags') IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields->'tags')>30 OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields->'tags') t WHERE jsonb_typeof(t)<>'string' OR length(t#>>'{}')>100)
 THEN RAISE EXCEPTION 'Unsupported protected payload'; END IF;
 -- Written only by this service-only transition, never inferred from editable
 -- visibility/media fields. Both inserts roll back together on any failure.
 INSERT INTO privacy_v2_private.protected_post_origins(post_id,owner_id) VALUES(p_post,p_owner);
 INSERT INTO public.posts(id,user_id,visibility,is_hidden,is_deleted,publishing_state,media,media_plan,publish_payload,draft_expires_at)
 VALUES(p_post,p_owner,p_visibility,true,false,'draft','[]',p_plan,p_fields,now()+interval '1 hour');
 RETURN jsonb_build_object('id',p_post,'status','draft');
END $$;

CREATE FUNCTION public.guard_protected_first_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m jsonb; a public.post_media_assets; raw jsonb=to_jsonb(NEW); n integer; origin_owner uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Post identity is immutable'; END IF;
 SELECT owner_id INTO origin_owner FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF; -- Legacy guard is a separate optional component.
 IF origin_owner IS DISTINCT FROM NEW.user_id OR NEW.visibility IS NULL OR
  NEW.visibility NOT IN ('followers','friends','only_me') OR
  (TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR
   NEW.media_plan IS DISTINCT FROM OLD.media_plan OR NEW.publish_payload IS DISTINCT FROM OLD.publish_payload))
 THEN RAISE EXCEPTION 'Protected origin and payload are immutable'; END IF;
 IF NEW.publishing_state<>'published' THEN RETURN NEW; END IF;
 IF NEW.is_hidden IS DISTINCT FROM false OR NEW.is_deleted IS DISTINCT FROM false THEN RETURN NEW; END IF;
 IF raw::text ~* '(https?://|blob:|data:|cloudinary\.com|/upload/)' OR
  EXISTS(SELECT 1 FROM jsonb_each(raw) e WHERE e.key ~* '(url|public_id|sound_id|text_template_id|overlay|original_post|source_post|quoted_post|repost_of)'
   AND e.value NOT IN ('null'::jsonb,'false'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb))
 THEN RAISE EXCEPTION 'Public references, music, text templates and overlays are unsupported'; END IF;
 n=jsonb_array_length(NEW.media);
 IF jsonb_typeof(NEW.media) IS DISTINCT FROM 'array' OR n NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION 'Protected images or one video required'; END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(NEW.media) LOOP
  IF (m-ARRAY['type','asset_id','thumbnail_asset_id'])<>'{}'::jsonb OR
   coalesce(m->>'type','') NOT IN ('image','video') OR m->>'asset_id' IS NULL OR
   (m->>'type'='video' AND (n<>1 OR m->>'thumbnail_asset_id' IS NULL))
  THEN RAISE EXCEPTION 'Invalid protected media'; END IF;
  SELECT * INTO a FROM public.post_media_assets WHERE id=(m->>'asset_id')::uuid;
  IF NOT FOUND OR a.post_id IS DISTINCT FROM NEW.id OR a.owner_id IS DISTINCT FROM NEW.user_id OR a.status IS DISTINCT FROM 'ready' OR
   a.delivery_type IS DISTINCT FROM 'authenticated' OR a.resource_type IS DISTINCT FROM m->>'type' OR a.format IS NULL OR
   (a.resource_type='image' AND a.format NOT IN ('jpg','jpeg','png','webp','avif','gif')) OR
   (a.resource_type='video' AND a.format NOT IN ('mp4','webm','mov','m4v'))
  THEN RAISE EXCEPTION 'Registered owned protected media required'; END IF;
  IF m->>'thumbnail_asset_id' IS NOT NULL THEN
   SELECT * INTO a FROM public.post_media_assets WHERE id=(m->>'thumbnail_asset_id')::uuid;
   IF NOT FOUND OR a.post_id IS DISTINCT FROM NEW.id OR a.owner_id IS DISTINCT FROM NEW.user_id OR a.status IS DISTINCT FROM 'ready' OR
    a.delivery_type IS DISTINCT FROM 'authenticated' OR a.resource_type IS DISTINCT FROM 'image' OR a.format IS NULL OR a.format NOT IN ('jpg','jpeg','png','webp','avif','gif')
   THEN RAISE EXCEPTION 'Registered owned protected thumbnail required'; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER privacy_v2_protected_first_references BEFORE INSERT OR UPDATE ON public.posts
 FOR EACH ROW EXECUTE FUNCTION public.guard_protected_first_references();
CREATE FUNCTION public.set_new_protected_visibility(p_owner uuid,p_post uuid,p_visibility text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_visibility IS NULL OR p_visibility NOT IN ('followers','friends','only_me') OR
  NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner AND suspended=false)
 THEN RAISE EXCEPTION 'Explicit supported audience required'; END IF;
 PERFORM 1 FROM public.posts p JOIN privacy_v2_private.protected_post_origins o ON o.post_id=p.id AND o.owner_id=p.user_id
  WHERE p.id=p_post AND p.user_id=p_owner AND p.publishing_state='published' AND p.is_hidden=false AND p.is_deleted=false
  FOR UPDATE OF p;
 IF NOT FOUND THEN RAISE EXCEPTION 'Only posts protected from creation may use this transition'; END IF;
 UPDATE public.posts SET visibility=p_visibility WHERE id=p_post;
 RETURN jsonb_build_object('id',p_post,'visibility',p_visibility);
END $$;
CREATE FUNCTION public.protected_first_capabilities()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT '{"version":1,"new_protected_posts":true,"legacy_conversion_required":false}'::jsonb
$$;
REVOKE ALL ON FUNCTION public.create_protected_draft(uuid,uuid,text,jsonb,jsonb),
 public.guard_protected_first_references(),public.set_new_protected_visibility(uuid,uuid,text),public.protected_first_capabilities() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_protected_draft(uuid,uuid,text,jsonb,jsonb),
 public.guard_protected_first_references(),public.set_new_protected_visibility(uuid,uuid,text),public.protected_first_capabilities() TO service_role;

CREATE OR REPLACE FUNCTION public.protected_publish_transition(
  p_owner uuid,p_post uuid,p_action text,p_data jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  p public.posts%ROWTYPE;
  ticket public.post_upload_intents%ROWTYPE;
  plan jsonb;
  registry_id uuid;
  refs jsonb;
BEGIN
  SELECT * INTO p FROM public.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
  IF NOT FOUND OR p.is_deleted IS DISTINCT FROM false OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=p_owner AND suspended IS FALSE
  ) THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
  IF p.visibility NOT IN ('followers','friends','only_me') THEN RAISE EXCEPTION 'Restricted draft required'; END IF;
  IF p_action='cancel' THEN
    IF p.publishing_state NOT IN ('draft','failed') THEN RAISE EXCEPTION 'Published posts cannot be cancelled'; END IF;
    UPDATE public.posts SET publishing_state='failed',is_hidden=true WHERE id=p_post;
    UPDATE public.post_media_assets SET status='failed' WHERE post_id=p_post;
    UPDATE public.post_upload_intents SET state='cleanup',cleanup_pending=true WHERE post_id=p_post;
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
    IF jsonb_array_length(p.media_plan) NOT BETWEEN 1 AND 21 OR EXISTS (
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
END $$;
CREATE OR REPLACE FUNCTION public.claim_protected_cleanup(
  p_owner uuid,p_post uuid,p_lease uuid,p_expired_only boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.posts%ROWTYPE; tickets jsonb;
BEGIN
  SELECT * INTO p FROM public.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=p_post AND owner_id=p_owner) THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
  IF p.publishing_state NOT IN ('draft','failed') THEN
    RETURN jsonb_build_object('claimed',false,'status','published'); END IF;
  IF p_expired_only AND p.publishing_state='draft' AND (p.draft_expires_at IS NULL OR p.draft_expires_at>now()) THEN
    RETURN jsonb_build_object('claimed',false,'status','active'); END IF;
  IF p.cleanup_lease_until>now() THEN RETURN jsonb_build_object('claimed',false,'status','busy'); END IF;
  UPDATE public.posts SET publishing_state='failed',is_hidden=true,cleanup_lease=p_lease,
    cleanup_lease_until=now()+interval '5 minutes' WHERE id=p_post;
  UPDATE public.post_media_assets SET status='failed' WHERE post_id=p_post AND owner_id=p_owner;
  UPDATE public.post_upload_intents SET state='cleanup' WHERE post_id=p_post AND owner_id=p_owner;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'cloudinary_public_id',i.cloudinary_public_id,
    'resource_type',i.resource_type)),'[]'::jsonb) INTO tickets FROM public.post_upload_intents i
    WHERE i.post_id=p_post AND i.owner_id=p_owner AND i.cleanup_pending AND i.cleanup_after<=now();
  RETURN jsonb_build_object('claimed',true,'intents',tickets,'status','failed');
END $$;
CREATE OR REPLACE FUNCTION public.record_protected_cleanup(
  p_owner uuid,p_post uuid,p_lease uuid,p_results jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.posts%ROWTYPE; item jsonb; pending boolean;
BEGIN
  SELECT * INTO p FROM public.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
  IF NOT FOUND OR p.publishing_state<>'failed' OR p.cleanup_lease IS DISTINCT FROM p_lease THEN
    RAISE EXCEPTION 'Cleanup lease unavailable'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    UPDATE public.post_upload_intents SET cleanup_attempts=cleanup_attempts+1,
      cleanup_pending=NOT (item->>'ok'='true' AND created_at+interval '65 minutes'<=now()),
      cleanup_after=CASE WHEN item->>'ok'='true' THEN greatest(now()+interval '1 minute',created_at+interval '65 minutes')
        ELSE now()+make_interval(secs=>least(3600,60*power(2,least(cleanup_attempts,6)))::int) END
      WHERE id=(item->>'id')::uuid AND post_id=p_post AND owner_id=p_owner AND state='cleanup';
  END LOOP;
  UPDATE public.posts SET cleanup_lease=NULL,cleanup_lease_until=NULL WHERE id=p_post;
  SELECT EXISTS (SELECT 1 FROM public.post_upload_intents WHERE post_id=p_post AND cleanup_pending) INTO pending;
  RETURN jsonb_build_object('id',p_post,'status','failed','cleanupPending',pending);
END $$;
CREATE OR REPLACE FUNCTION public.protected_cleanup_candidates(p_limit integer DEFAULT 5)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'owner_id',user_id)),'[]'::jsonb) FROM (
    SELECT p.id,p.user_id FROM public.posts p
    WHERE EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins o WHERE o.post_id=p.id AND o.owner_id=p.user_id) AND (p.cleanup_lease_until IS NULL OR p.cleanup_lease_until<=now()) AND
      ((p.publishing_state='draft' AND p.draft_expires_at<=now()) OR
       (p.publishing_state='failed' AND EXISTS (SELECT 1 FROM public.post_upload_intents i
        WHERE i.post_id=p.id AND i.cleanup_pending AND i.cleanup_after<=now())))
    ORDER BY p.draft_expires_at NULLS LAST,p.id LIMIT greatest(1,least(p_limit,10))
  ) candidates;
$$;
CREATE OR REPLACE FUNCTION public.privacy_v2_release_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Post owner cannot change'; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.visibility IS DISTINCT FROM OLD.visibility) THEN
  IF NEW.visibility IS NULL OR NEW.visibility NOT IN ('public','followers','friends','only_me')
  THEN RAISE EXCEPTION 'Invalid audience'; END IF;
 END IF;
 IF NEW.visibility<>'public' AND ((TG_OP='INSERT') OR
  (TG_OP='UPDATE' AND (NEW.visibility IS DISTINCT FROM OLD.visibility OR
   (NEW.publishing_state='published' AND OLD.publishing_state<>'published')))) THEN
  IF NOT EXISTS(SELECT 1 FROM privacy_v2_private.release_control WHERE new_protected_enabled AND protected_delivery_enabled)
   OR NOT EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id AND owner_id=NEW.user_id)
  THEN RAISE EXCEPTION 'New protected publishing is disabled; legacy conversion remains disabled'; END IF;
 END IF;
 RETURN NEW;
END $$;
-- Hydrate the existing feed/profile columns, so ordinary invoker readers and
-- engagement keep their established shapes. Never add public media aliases.
CREATE FUNCTION privacy_v2_private.hydrate_protected_payload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id AND owner_id=NEW.user_id) THEN
  NEW.title=coalesce(NEW.publish_payload->>'title','');
  NEW.content=coalesce(NEW.publish_payload->>'content','');
  NEW.source=NEW.publish_payload->>'source';
  NEW.tags=ARRAY(SELECT jsonb_array_elements_text(NEW.publish_payload->'tags'));
  NEW.comments_hidden=coalesce((NEW.publish_payload->>'comments_hidden')::boolean,false);
  NEW.media_type=NEW.media_plan->0->>'type';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.hydrate_protected_payload() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER privacy_v2_00_protected_payload BEFORE INSERT OR UPDATE ON public.posts
 FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.hydrate_protected_payload();
CREATE FUNCTION public.authorize_protected_asset(p_asset uuid,p_viewer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(EXISTS(SELECT 1 FROM public.post_media_assets a JOIN public.posts p ON p.id=a.post_id
  WHERE a.id=p_asset AND a.owner_id=p.user_id AND a.status='ready' AND a.delivery_type='authenticated'
   AND p.publishing_state='published' AND p_viewer IS NOT NULL
   AND privacy_v2_private.can_view_post_for(p.id,p_viewer)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.media) m WHERE m->>'asset_id'=a.id::text OR m->>'thumbnail_asset_id'=a.id::text)),false)
$$;
CREATE FUNCTION public.protected_first_release_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('version',1,'publishing',new_protected_enabled,
  'delivery',protected_delivery_enabled,'legacy_conversion',restricted_enabled)
 FROM privacy_v2_private.release_control WHERE singleton
$$;
CREATE OR REPLACE FUNCTION public.protected_publishing_capabilities() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT '{"version":2}'::jsonb $$;
REVOKE ALL ON FUNCTION public.protected_publish_transition(uuid,uuid,text,jsonb),
 public.claim_protected_cleanup(uuid,uuid,uuid,boolean),public.record_protected_cleanup(uuid,uuid,uuid,jsonb),
 public.protected_cleanup_candidates(integer),public.authorize_protected_asset(uuid,uuid),
 public.protected_first_release_status(),public.protected_publishing_capabilities() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.protected_publish_transition(uuid,uuid,text,jsonb),
 public.claim_protected_cleanup(uuid,uuid,uuid,boolean),public.record_protected_cleanup(uuid,uuid,uuid,jsonb),
 public.protected_cleanup_candidates(integer),public.authorize_protected_asset(uuid,uuid),
 public.protected_first_release_status(),public.protected_publishing_capabilities() TO service_role;
COMMIT;
