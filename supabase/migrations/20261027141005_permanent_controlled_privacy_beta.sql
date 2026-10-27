-- Install the permanent boundary without activating release controls.
-- Activation is a separate operation after production security evidence exists.
CREATE OR REPLACE FUNCTION public.protected_publisher_beta_allowed(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce(p_user IN ('9341af03-e007-4fc6-9c23-b06073379088'::uuid,
 'a0a53cb6-be86-4862-b267-f7f43d4cf324'::uuid,'5b5bd4b3-22df-41e7-8e6e-2dae82ee68df'::uuid)
 AND privacy_v2_private.is_approved_protected_publisher(p_user)
 AND public.privacy_v2_test_publisher_allowed(p_user)
 AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user AND suspended IS FALSE),false)
$$;
CREATE OR REPLACE FUNCTION privacy_v2_private.protected_publish_allowed(p_owner uuid,p_post uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT public.protected_publisher_beta_allowed(p_owner)
 AND NOT EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts WHERE post_id=p_post)
 AND public.protected_first_release_status()->>'publishing'='true'
 AND public.protected_first_release_status()->>'delivery'='true'
 AND public.protected_publishing_capabilities()->>'ready'='true'
 AND public.protected_first_capabilities()->>'new_protected_posts'='true'
$$;
CREATE OR REPLACE FUNCTION public.protected_publishing_access(p_owner uuid,p_post uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object('mode',CASE WHEN privacy_v2_private.protected_publish_allowed(p_owner,p_post)
 THEN 'production' ELSE 'disabled' END,'expires_at',NULL)
$$;
-- Retain temporary markers and owner cleanup, but remove every temporary grant.
CREATE OR REPLACE FUNCTION privacy_v2_private.verification_owner_active(p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.create_verification_draft(p_owner uuid,p_post uuid,p_visibility text,p_plan jsonb,p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'Temporary verification publishing has ended' USING ERRCODE='42501'; END $$;
UPDATE privacy_v2_private.verification_control SET enabled=false WHERE singleton;

-- A protected draft may never be created for an account outside the exact beta.
-- Existing function ACLs are preserved by CREATE OR REPLACE.
DO $$ DECLARE body text; BEGIN
 body:=pg_get_functiondef('public.create_protected_draft(uuid,uuid,text,jsonb,jsonb)'::regprocedure);
 IF position('release:=public.protected_first_release_status();' in body)=0 THEN RAISE EXCEPTION 'Unexpected draft creator drift'; END IF;
 body:=replace(body,'release:=public.protected_first_release_status();',
 'IF NOT public.protected_publisher_beta_allowed(p_owner) THEN RAISE EXCEPTION ''Protected publisher not approved'' USING ERRCODE=''42501''; END IF; release:=public.protected_first_release_status();');
 EXECUTE body;
END $$;

-- Retain protected tombstones and reservations until remote cleanup completes.
-- A normal RPC DELETE or direct owner DELETE must not cascade away the queue.
CREATE FUNCTION privacy_v2_private.queue_protected_retirement(p_post uuid,p_owner uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 UPDATE privacy_v2_private.verification_posts SET retired_at=coalesce(retired_at,now()) WHERE post_id=p_post AND owner_id=p_owner;
 UPDATE public.post_media_assets SET status='failed' WHERE post_id=p_post AND owner_id=p_owner;
 UPDATE public.post_upload_intents SET state='cleanup',cleanup_pending=true,
 cleanup_after=greatest(coalesce(cleanup_after,now()),created_at+interval '65 minutes')
 WHERE post_id=p_post AND owner_id=p_owner AND state<>'cleanup';
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.queue_protected_retirement(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION privacy_v2_private.protected_post_retirement_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=OLD.id AND owner_id=OLD.user_id) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP='DELETE' THEN
  UPDATE public.posts SET is_deleted=true,is_hidden=true,publishing_state='failed' WHERE id=OLD.id;
  RETURN NULL;
 END IF;
 -- A retired protected object is irreversible; never resurrect deleted media.
 IF OLD.is_deleted IS TRUE AND NEW.is_deleted IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Protected post is retired' USING ERRCODE='23514';
 END IF;
 IF NEW.is_deleted IS TRUE OR (NEW.publishing_state='failed' AND NEW.is_hidden IS TRUE) THEN
  NEW.is_deleted:=true; NEW.is_hidden:=true; NEW.publishing_state:='failed'; NEW.deleted_at:=coalesce(OLD.deleted_at,now());
  PERFORM privacy_v2_private.queue_protected_retirement(OLD.id,OLD.user_id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.protected_post_retirement_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER privacy_v2_00_retirement_guard BEFORE UPDATE OR DELETE ON public.posts
FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.protected_post_retirement_guard();
CREATE OR REPLACE FUNCTION privacy_v2_private.enforce_restricted_release_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NEW.visibility='public' THEN RETURN NEW; END IF;
 IF NEW.is_hidden IS TRUE AND NEW.is_deleted IS TRUE AND NEW.publishing_state='failed'
 AND EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id AND owner_id=NEW.user_id) THEN RETURN NEW; END IF;
 IF NOT privacy_v2_private.protected_publish_allowed(NEW.user_id,NEW.id) THEN
  RAISE EXCEPTION 'Controlled publishing release is disabled' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION privacy_v2_private.enforce_test_publisher_on_post()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NEW.is_hidden IS TRUE AND NEW.is_deleted IS TRUE AND NEW.publishing_state='failed'
 AND EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id AND owner_id=NEW.user_id) THEN RETURN NEW; END IF;
 IF NEW.visibility IN ('followers','friends','only_me') AND NOT public.protected_publisher_beta_allowed(NEW.user_id) THEN
  RAISE EXCEPTION 'Restricted publishing requires approved beta publisher' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
-- Prevent public metadata/sound paths from becoming a second protected delivery path.
CREATE FUNCTION privacy_v2_private.protected_metadata_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id)
 AND (NEW.media_url IS NOT NULL OR NEW.thumbnail_url IS NOT NULL OR NEW.sound_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Protected media requires opaque registry references only' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.protected_metadata_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER privacy_v2_protected_metadata_guard BEFORE UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.protected_metadata_guard();

-- Child rows must not reveal a restricted post's discussion, captions or mentions.
-- Invoker queries deliberately use the existing parent-post RLS audience boundary.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['comments','post_likes','reposts','notifications','mentions','post_hashtags','post_media','post_short_links','post_views','shares','bookmarks'] LOOP
  EXECUTE format('CREATE POLICY privacy_v2_parent_post_boundary ON public.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING (post_id IS NULL OR EXISTS(SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.is_deleted IS FALSE AND p.is_hidden IS FALSE)) WITH CHECK (post_id IS NULL OR EXISTS(SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.is_deleted IS FALSE AND p.is_hidden IS FALSE))',tbl);
 END LOOP;
END $$;
-- Sounds have a differently named parent key. Public/independent sounds are preserved.
CREATE POLICY privacy_v2_parent_post_boundary ON public.sounds AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING(source_post_id IS NULL OR EXISTS(SELECT 1 FROM public.posts p WHERE p.id=source_post_id AND p.visibility='public' AND p.is_deleted IS FALSE AND p.is_hidden IS FALSE));

-- Cloudflare scheduled cleanup has an independent, revocable maintenance key.
-- It can only process already-retired objects, never publish or return media.
CREATE TABLE privacy_v2_private.cleanup_worker_key(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 token_sha256 text NOT NULL CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),enabled boolean NOT NULL DEFAULT false);
ALTER TABLE privacy_v2_private.cleanup_worker_key ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_v2_private.cleanup_worker_key FROM PUBLIC,anon,authenticated;
GRANT ALL ON privacy_v2_private.cleanup_worker_key TO service_role;
CREATE FUNCTION public.protected_cleanup_worker_authorized(p_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce(length(p_token)=64 AND p_token ~ '^[a-f0-9]{64}$' AND EXISTS(
 SELECT 1 FROM privacy_v2_private.cleanup_worker_key WHERE singleton AND enabled
 AND token_sha256=encode(sha256(convert_to(p_token,'UTF8')),'hex')),false)
$$;
REVOKE ALL ON FUNCTION public.protected_cleanup_worker_authorized(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.protected_cleanup_worker_authorized(text) TO service_role;
CREATE TABLE privacy_v2_private.security_audits(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),results jsonb NOT NULL);
ALTER TABLE privacy_v2_private.security_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_v2_private.security_audits FROM PUBLIC,anon,authenticated;
GRANT ALL ON privacy_v2_private.security_audits TO service_role;
CREATE FUNCTION public.record_protected_security_audit(p_results jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
 INSERT INTO privacy_v2_private.security_audits(results) VALUES(p_results)
$$;
REVOKE ALL ON FUNCTION public.record_protected_security_audit(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_protected_security_audit(jsonb) TO service_role;
-- Release flags intentionally remain unchanged here.

CREATE FUNCTION public.expire_protected_drafts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE affected integer;
BEGIN
 UPDATE public.posts p SET is_hidden=true,is_deleted=true,publishing_state='failed'
 WHERE p.publishing_state='draft' AND p.draft_expires_at<=now()
 AND EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins o WHERE o.post_id=p.id AND o.owner_id=p.user_id);
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
END $$;
REVOKE ALL ON FUNCTION public.expire_protected_drafts() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_protected_drafts() TO service_role;

-- Do not push restricted-post notification metadata to an unrelated recipient.
CREATE FUNCTION privacy_v2_private.restricted_notification_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE p public.posts%rowtype; parent_id uuid;
BEGIN
 parent_id:=NEW.post_id;
 IF parent_id IS NULL AND NEW.comment_id IS NOT NULL THEN
  SELECT post_id INTO parent_id FROM public.comments WHERE id=NEW.comment_id;
 END IF;
 IF parent_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO p FROM public.posts WHERE id=parent_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF p.visibility='public' THEN RETURN NEW; END IF;
 IF p.publishing_state<>'published' OR p.is_hidden IS DISTINCT FROM false OR p.is_deleted IS DISTINCT FROM false
 OR NOT (p.user_id=NEW.receiver_id OR
  (p.visibility='followers' AND privacy_v2_private.approved_edge(NEW.receiver_id,p.user_id)) OR
  (p.visibility='friends' AND privacy_v2_private.approved_edge(NEW.receiver_id,p.user_id) AND privacy_v2_private.approved_edge(p.user_id,NEW.receiver_id)))
 THEN RETURN NULL; END IF;
 NEW.post_id:=parent_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.restricted_notification_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER privacy_v2_notification_boundary BEFORE INSERT OR UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.restricted_notification_guard();
