-- Isolated snapshot of the production dependency closure (no user data).
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA privacy_v2_private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_private boolean DEFAULT false,suspended boolean DEFAULT false);
CREATE TABLE privacy_v2_private.protected_publisher_allowlist(user_id uuid PRIMARY KEY,enabled boolean DEFAULT true);
CREATE TABLE privacy_v2_private.test_publishers(user_id uuid PRIMARY KEY,revoked_at timestamptz);
CREATE TABLE privacy_v2_private.follow_approvals(follower_id uuid,following_id uuid,approval_kind text,PRIMARY KEY(follower_id,following_id));
CREATE TABLE public.follows(follower_id uuid,following_id uuid,status text DEFAULT 'active',PRIMARY KEY(follower_id,following_id));
CREATE FUNCTION privacy_v2_private.is_approved_protected_publisher(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT EXISTS(SELECT 1 FROM privacy_v2_private.protected_publisher_allowlist WHERE user_id=p_user AND enabled) $$;
CREATE FUNCTION public.protected_publisher_beta_allowed(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT privacy_v2_private.is_approved_protected_publisher(p_user) $$;
CREATE FUNCTION public.privacy_v2_test_publisher_allowed(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT EXISTS(SELECT 1 FROM privacy_v2_private.test_publishers WHERE user_id=p_user AND revoked_at IS NULL) $$;
CREATE FUNCTION privacy_v2_private.approved_edge(p_follower uuid,p_following uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT EXISTS(SELECT 1 FROM public.follows f JOIN privacy_v2_private.follow_approvals a USING(follower_id,following_id) JOIN public.profiles p ON p.id=f.following_id WHERE f.follower_id=p_follower AND f.following_id=p_following AND f.status='active' AND p.suspended=false AND (p.is_private=false OR a.approval_kind='owner')) $$;

CREATE TABLE privacy_v2_private.protected_post_origins (
"post_id" uuid NOT NULL,
"owner_id" uuid NOT NULL,
"created_at" timestamptz NOT NULL DEFAULT now(),
PRIMARY KEY (post_id)
);
CREATE TABLE privacy_v2_private.release_control (
"singleton" bool NOT NULL DEFAULT true,
"restricted_enabled" bool NOT NULL DEFAULT false,
"delivery_verified" bool NOT NULL DEFAULT false,
"publishing_verified" bool NOT NULL DEFAULT false,
PRIMARY KEY (singleton)
);
CREATE TABLE public.post_media_assets (
"id" uuid NOT NULL DEFAULT gen_random_uuid(),
"post_id" uuid NOT NULL,
"owner_id" uuid NOT NULL,
"cloudinary_asset_id" text NOT NULL,
"cloudinary_public_id" text NOT NULL,
"resource_type" text NOT NULL,
"format" text NOT NULL,
"delivery_type" text NOT NULL,
"status" text NOT NULL DEFAULT 'pending'::text,
"created_at" timestamptz NOT NULL DEFAULT now(),
"updated_at" timestamptz NOT NULL DEFAULT now(),
PRIMARY KEY (id)
);
CREATE TABLE public.post_upload_intents (
"id" uuid NOT NULL DEFAULT gen_random_uuid(),
"post_id" uuid NOT NULL,
"owner_id" uuid NOT NULL,
"slot" int4 NOT NULL,
"cloudinary_public_id" text NOT NULL,
"resource_type" text NOT NULL,
"asset_id" uuid,
"state" text NOT NULL DEFAULT 'reserved'::text,
"cleanup_pending" bool NOT NULL DEFAULT true,
"cleanup_attempts" int4 NOT NULL DEFAULT 0,
"cleanup_after" timestamptz NOT NULL DEFAULT now(),
"created_at" timestamptz NOT NULL DEFAULT now(),
"cleanup_lease" uuid,
"cleanup_lease_until" timestamptz,
PRIMARY KEY (id)
);
CREATE TABLE public.posts (
"id" uuid NOT NULL DEFAULT gen_random_uuid(),
"user_id" uuid NOT NULL,
"title" text NOT NULL,
"description" text,
"content" text,
"media_url" text,
"media_type" text,
"category" text DEFAULT 'General'::text,
"tags" text[] DEFAULT '{}'::text[],
"likes_count" int4 DEFAULT 0,
"comments_count" int4 DEFAULT 0,
"shares_count" int4 DEFAULT 0,
"views" int4 DEFAULT 0,
"created_at" timestamptz DEFAULT now(),
"updated_at" timestamptz DEFAULT now(),
"media" jsonb,
"version" int4 DEFAULT 1,
"edited_at" timestamptz,
"is_deleted" bool DEFAULT false,
"deleted_at" timestamptz,
"visibility" text DEFAULT 'public'::text,
"repost_count" int4 NOT NULL DEFAULT 0,
"thumbnail_url" text,
"image_public_id" text,
"video_public_id" text,
"mentions" jsonb DEFAULT '[]'::jsonb,
"share_count" int4 DEFAULT 0,
"bookmark_count" int4 DEFAULT 0,
"like_count" int4 DEFAULT 0,
"comment_count" int4 DEFAULT 0,
"is_hidden" bool DEFAULT false,
"comments_hidden" bool DEFAULT false,
"sound_id" text,
"is_pinned" bool NOT NULL DEFAULT false,
"source" text NOT NULL DEFAULT 'composer'::text,
"text_template_id" text,
"image_embedding" text,
"publishing_state" text NOT NULL DEFAULT 'published'::text,
"media_plan" jsonb NOT NULL DEFAULT '[]'::jsonb,
"publish_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
"draft_expires_at" timestamptz,
"cleanup_lease" uuid,
"cleanup_lease_until" timestamptz,
PRIMARY KEY (id)
);
INSERT INTO privacy_v2_private.release_control(singleton,restricted_enabled,delivery_verified,publishing_verified) VALUES(true,false,false,false);
CREATE OR REPLACE FUNCTION public.protected_first_capabilities()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
 'version',1,
 'new_protected_posts',
 coalesce((SELECT restricted_enabled AND delivery_verified AND publishing_verified
 FROM privacy_v2_private.release_control WHERE singleton=true),false),
 'legacy_conversion_required',false)
$function$;

CREATE OR REPLACE FUNCTION public.protected_first_release_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
 'version',1,
 'delivery',coalesce((SELECT restricted_enabled AND delivery_verified FROM privacy_v2_private.release_control WHERE singleton=true),false),
 'publishing',coalesce((SELECT restricted_enabled AND delivery_verified AND publishing_verified FROM privacy_v2_private.release_control WHERE singleton=true),false),
 'legacy_conversion',false
 )
$function$;

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
  IF public.protected_first_release_status()->>'publishing' IS DISTINCT FROM 'true'
    OR public.protected_first_release_status()->>'delivery' IS DISTINCT FROM 'true'
    OR public.protected_publishing_capabilities()->>'ready' IS DISTINCT FROM 'true'
    OR public.protected_first_capabilities()->>'new_protected_posts' IS DISTINCT FROM 'true'
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
    UPDATE public.post_upload_intents SET state='cleanup',cleanup_pending=true WHERE post_id=p_post;
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

CREATE OR REPLACE FUNCTION public.protected_publishing_capabilities()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object('version',2,'ready',
 coalesce((SELECT restricted_enabled AND delivery_verified AND publishing_verified FROM privacy_v2_private.release_control WHERE singleton=true),false))
$function$;

CREATE OR REPLACE FUNCTION public.protected_studio_beta_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid := auth.uid(); release jsonb;
begin
 release := public.protected_first_release_status();
 return jsonb_build_object('approved',u is not null and privacy_v2_private.is_approved_protected_publisher(u),'ready',coalesce((release->>'publishing')::boolean,false) and coalesce((release->>'delivery')::boolean,false));
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_protected_draft(p_owner uuid, p_post uuid, p_visibility text, p_plan jsonb, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE release jsonb;
BEGIN
 IF current_user <> 'postgres' AND session_user <> 'service_role' THEN
  RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
 END IF;
 release:=public.protected_first_release_status();
 IF release->>'publishing' IS DISTINCT FROM 'true' OR release->>'delivery' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Protected draft creation remains disabled' USING ERRCODE='23514';
 END IF;
 IF p_owner IS NULL OR p_post IS NULL OR p_visibility NOT IN ('followers','friends','only_me')
  OR NOT privacy_v2_private.valid_protected_media_plan(p_plan)
  OR NOT privacy_v2_private.valid_protected_draft_fields(p_fields)
  OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner AND suspended IS FALSE)
 THEN RAISE EXCEPTION 'Invalid protected draft' USING ERRCODE='23514'; END IF;
 INSERT INTO public.posts(id,user_id,title,content,source,tags,comments_hidden,media_type,visibility,is_hidden,is_deleted,publishing_state,media,media_plan,publish_payload,draft_expires_at)
 VALUES(p_post,p_owner,coalesce(p_fields->>'title',''),coalesce(p_fields->>'content',''),p_fields->>'source',
 ARRAY(SELECT jsonb_array_elements_text(p_fields->'tags')),
 coalesce((p_fields->>'comments_hidden')::boolean,false),
 p_plan->0->>'type',p_visibility,true,false,'draft','[]'::jsonb,p_plan,p_fields,now()+interval '1 hour');
 INSERT INTO privacy_v2_private.protected_post_origins(post_id,owner_id) VALUES(p_post,p_owner);
 RETURN jsonb_build_object('post_id',p_post,'state','draft');
END $function$;

CREATE OR REPLACE FUNCTION public.authorize_protected_asset(p_asset uuid, p_viewer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT p_viewer IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.post_media_assets a
  JOIN public.posts p ON p.id=a.post_id AND p.user_id=a.owner_id
  JOIN public.profiles owner_profile ON owner_profile.id=p.user_id
  WHERE a.id=p_asset AND a.status='ready' AND a.delivery_type='authenticated'
   AND p.publishing_state='published' AND p.is_deleted IS FALSE AND p.is_hidden IS FALSE
   AND owner_profile.suspended IS FALSE
   AND jsonb_typeof(p.media)='array'
   AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p.media) m
    WHERE m->>'asset_id'=a.id::text OR m->>'thumbnail_asset_id'=a.id::text
   )
   AND (
    p.user_id=p_viewer
    OR (p.visibility='followers' AND privacy_v2_private.approved_edge(p_viewer,p.user_id))
    OR (p.visibility='friends' AND privacy_v2_private.approved_edge(p_viewer,p.user_id)
      AND privacy_v2_private.approved_edge(p.user_id,p_viewer))
   )
 );
$function$;

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
   AND public.protected_first_release_status()->>'publishing'='true'
   AND public.protected_first_release_status()->>'delivery'='true'
   AND public.protected_publishing_capabilities()->>'ready'='true'
   AND public.protected_first_capabilities()->>'new_protected_posts'='true'
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

CREATE OR REPLACE FUNCTION public.claim_protected_cleanup_batch(p_limit integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if p_limit is null or p_limit < 1 or p_limit > 10 then
   raise exception 'Invalid cleanup limit';
 end if;
 with picked as (
   select i.id from public.post_upload_intents i
   join public.posts p on p.id=i.post_id and p.user_id=i.owner_id
   join privacy_v2_private.protected_post_origins o on o.post_id=i.post_id and o.owner_id=i.owner_id
   where i.cleanup_pending is true and i.state='cleanup'
     and p.publishing_state='failed' and p.is_hidden is true
     and (i.cleanup_after is null or i.cleanup_after<=now())
     and (i.cleanup_lease_until is null or i.cleanup_lease_until<now())
     and i.cloudinary_public_id ~ ('^freeupper-protected-v2/' || i.owner_id::text || '/asset_[a-f0-9]{32}$')
   order by i.created_at for update of i skip locked limit p_limit
 ), leased as (
   update public.post_upload_intents i set cleanup_lease=gen_random_uuid(),
     cleanup_lease_until=now()+interval '2 minutes',
     cleanup_attempts=coalesce(i.cleanup_attempts,0)+1
   from picked where i.id=picked.id
   returning i.id,i.owner_id,i.post_id,i.cloudinary_public_id,i.cleanup_lease
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'owner_id',owner_id,'post_id',post_id,
   'public_id',cloudinary_public_id,'lease',cleanup_lease)), '[]'::jsonb) into result from leased;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.complete_protected_cleanup(p_intent uuid, p_lease uuid, p_success boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_intent public.post_upload_intents%rowtype;
begin
 if p_intent is null or p_lease is null or p_success is null then return false; end if;
 select * into v_intent from public.post_upload_intents
   where id=p_intent and cleanup_lease=p_lease and cleanup_lease_until>=now()
   for update;
 if not found or v_intent.state<>'cleanup' or v_intent.cleanup_pending is distinct from true
   or not exists (select 1 from privacy_v2_private.protected_post_origins
     where post_id=v_intent.post_id and owner_id=v_intent.owner_id)
 then return false; end if;
 if p_success then
   update public.post_upload_intents set cleanup_pending=false,
     cleanup_lease=null,cleanup_lease_until=null where id=p_intent;
 else
   update public.post_upload_intents set cleanup_lease=null,cleanup_lease_until=null,
     cleanup_after=now()+make_interval(mins=>least(60,greatest(1,coalesce(cleanup_attempts,1)*5)))
     where id=p_intent;
 end if;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION privacy_v2_private.valid_protected_media_plan(p_plan jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE item jsonb; n integer; total integer;
BEGIN
 IF jsonb_typeof(p_plan) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 total:=jsonb_array_length(p_plan);
 IF total<1 OR total>20 THEN RETURN false; END IF;
 IF total=2 AND p_plan='[{"slot":0,"type":"video","role":"media"},{"slot":20,"type":"image","role":"thumbnail"}]'::jsonb THEN
  RETURN true;
 END IF;
 n:=0;
 FOR item IN SELECT value FROM jsonb_array_elements(p_plan) LOOP
  IF item IS DISTINCT FROM jsonb_build_object('slot',n,'type','image','role','media') THEN RETURN false; END IF;
  n:=n+1;
 END LOOP;
 RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION privacy_v2_private.enforce_protected_origin_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF EXISTS (
   SELECT 1 FROM privacy_v2_private.protected_post_origins o
   WHERE o.post_id=NEW.id AND o.owner_id IS DISTINCT FROM NEW.user_id
 ) THEN
   RAISE EXCEPTION 'Protected post owner does not match registered origin'
     USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
   RAISE EXCEPTION 'Post identity cannot change' USING ERRCODE='23514';
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
 IF NEW.visibility IS DISTINCT FROM 'public'
 AND (NEW.publishing_state IS DISTINCT FROM 'draft' OR NEW.is_hidden IS DISTINCT FROM TRUE)
 AND NOT (
  EXISTS (SELECT 1 FROM privacy_v2_private.release_control WHERE singleton=true AND restricted_enabled=true)
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
AS $function$ begin if new.visibility in ('followers','friends','only_me') and (tg_op='INSERT' or (tg_op='UPDATE' and (old.visibility is distinct from new.visibility or old.publishing_state is distinct from new.publishing_state or old.is_hidden is distinct from new.is_hidden))) and not public.privacy_v2_test_publisher_allowed(new.user_id) then raise exception 'Restricted publishing requires approved test publisher' using errcode='42501'; end if; return new; end; $function$;

CREATE OR REPLACE FUNCTION privacy_v2_private.guard_protected_post_media()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE media_item jsonb;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM privacy_v2_private.protected_post_origins o WHERE o.post_id=NEW.id AND o.owner_id=NEW.user_id) THEN
  RETURN NEW;
 END IF;
 IF NEW.visibility NOT IN ('followers','friends','only_me') THEN
  RAISE EXCEPTION 'Protected post visibility invalid';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.media_plan IS DISTINCT FROM OLD.media_plan OR NEW.publish_payload IS DISTINCT FROM OLD.publish_payload) THEN
  RAISE EXCEPTION 'Protected draft identity and plan are immutable';
 END IF;
 IF NEW.publishing_state='published' AND NEW.is_hidden IS FALSE AND NEW.is_deleted IS FALSE THEN
  IF jsonb_typeof(NEW.media) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.media) NOT BETWEEN 1 AND 20 THEN
   RAISE EXCEPTION 'Published protected post requires registered media';
  END IF;
  FOR media_item IN SELECT value FROM jsonb_array_elements(NEW.media) LOOP
   IF jsonb_typeof(media_item) IS DISTINCT FROM 'object' OR
    (media_item - ARRAY['type','asset_id','thumbnail_asset_id']) <> '{}'::jsonb OR
    media_item->>'type' NOT IN ('image','video') OR
    NOT EXISTS (
      SELECT 1 FROM public.post_media_assets a WHERE a.id=(media_item->>'asset_id')::uuid
      AND a.post_id=NEW.id AND a.owner_id=NEW.user_id AND a.status='ready'
      AND a.delivery_type='authenticated' AND a.resource_type=media_item->>'type'
    ) THEN RAISE EXCEPTION 'Unregistered protected media'; END IF;
   IF media_item->>'type'='video' AND (jsonb_array_length(NEW.media)<>1 OR media_item->>'thumbnail_asset_id' IS NULL) THEN
    RAISE EXCEPTION 'Protected video poster required';
   END IF;
   IF media_item->>'thumbnail_asset_id' IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM public.post_media_assets a WHERE a.id=(media_item->>'thumbnail_asset_id')::uuid
     AND a.post_id=NEW.id AND a.owner_id=NEW.user_id AND a.status='ready'
     AND a.delivery_type='authenticated' AND a.resource_type='image'
   ) THEN RAISE EXCEPTION 'Unregistered protected poster'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION privacy_v2_private.guard_protected_publisher_allowlist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.visibility in ('followers','friends','only_me')
    and not privacy_v2_private.is_approved_protected_publisher(new.user_id) then
   raise exception 'Protected publisher not approved' using errcode='42501';
 end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION privacy_v2_private.valid_protected_draft_fields(p_fields jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE tag jsonb;
BEGIN
 IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF (p_fields - ARRAY['title','content','tags','source','comments_hidden']) <> '{}'::jsonb THEN RETURN false; END IF;
 IF coalesce(p_fields->>'source','') NOT IN ('composer','studio') THEN RETURN false; END IF;
 IF jsonb_typeof(p_fields->'tags') IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields->'tags')>30 THEN RETURN false; END IF;
 IF p_fields ? 'title' AND jsonb_typeof(p_fields->'title') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 IF p_fields ? 'content' AND jsonb_typeof(p_fields->'content') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 IF length(coalesce(p_fields->>'title',''))>200 OR length(coalesce(p_fields->>'content',''))>20000 THEN RETURN false; END IF;
 IF p_fields ? 'comments_hidden' AND jsonb_typeof(p_fields->'comments_hidden') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 IF p_fields::text ~* '(https?://|blob:|data:|cloudinary\.com|/upload/)' THEN RETURN false; END IF;
 FOR tag IN SELECT value FROM jsonb_array_elements(p_fields->'tags') LOOP
  IF jsonb_typeof(tag) IS DISTINCT FROM 'string' OR length(tag #>> '{}')>100 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $function$;

CREATE TRIGGER freeupper_public_only_guard_trigger BEFORE INSERT OR UPDATE OF visibility ON public.posts FOR EACH ROW EXECUTE FUNCTION public.freeupper_public_only_guard();
CREATE TRIGGER privacy_v2_controlled_publisher_guard BEFORE INSERT OR UPDATE OF visibility,publishing_state,is_hidden ON public.posts FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.enforce_test_publisher_on_post();
CREATE TRIGGER privacy_v2_guard_protected_publisher_allowlist BEFORE INSERT OR UPDATE OF visibility,user_id ON public.posts FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.guard_protected_publisher_allowlist();
CREATE TRIGGER privacy_v2_protected_origin_owner_guard BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.enforce_protected_origin_owner();
CREATE TRIGGER privacy_v2_protected_post_media_guard BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.guard_protected_post_media();
CREATE TRIGGER privacy_v2_restricted_release_gate BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.enforce_restricted_release_gate();
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_read ON public.posts FOR SELECT TO authenticated USING(true);
-- Existing audience boundary is kept independent of the new verification policy.
CREATE POLICY audiences ON public.posts AS RESTRICTIVE FOR SELECT TO authenticated USING(
 auth.uid()=user_id OR (publishing_state='published' AND is_hidden IS FALSE AND is_deleted IS FALSE AND (
 visibility='public' OR (visibility='followers' AND privacy_v2_private.approved_edge(auth.uid(),user_id)) OR
 (visibility='friends' AND privacy_v2_private.approved_edge(auth.uid(),user_id) AND privacy_v2_private.approved_edge(user_id,auth.uid())))));
GRANT SELECT,INSERT,UPDATE ON public.posts TO authenticated;
CREATE POLICY owned_write ON public.posts FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT USAGE ON SCHEMA privacy_v2_private TO authenticated,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public,privacy_v2_private TO service_role;

REVOKE ALL ON FUNCTION public.create_protected_draft(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.create_protected_draft(uuid,uuid,text,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.protected_publish_transition(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.protected_publish_transition(uuid,uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.authorize_protected_asset(uuid,uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.authorize_protected_asset(uuid,uuid) TO service_role;