-- Global eligibility uses production Auth identities, never a client-supplied ID
-- or the historical publisher lists. Preserve existing function ACLs.
CREATE OR REPLACE FUNCTION privacy_v2_private.is_approved_protected_publisher(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce(p_user IS NOT NULL
 AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user AND u.is_anonymous IS FALSE)
 AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_user AND p.suspended IS FALSE),false)
$$;
CREATE OR REPLACE FUNCTION public.protected_publisher_beta_allowed(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT privacy_v2_private.is_approved_protected_publisher(p_user)
$$;
CREATE OR REPLACE FUNCTION public.protected_studio_beta_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object('approved',public.protected_publisher_beta_allowed(auth.uid()),
 'ready',public.protected_publishing_access(auth.uid(),NULL)->>'mode'='production',
 'mode',public.protected_publishing_access(auth.uid(),NULL)->>'mode','verification_expires_at',NULL)
$$;

-- Replace the permanent-off lock with an evidence-backed activation boundary.
CREATE FUNCTION privacy_v2_private.release_security_evidence_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM privacy_v2_private.security_audits a
 WHERE a.results->>'expired_urls_denied'='true'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.results->'assets') r
   WHERE r->>'valid_download_status'='200'
   AND r->>'expired_download_status' IN ('400','401','403','404')))
 AND NOT EXISTS(SELECT 1 FROM public.post_upload_intents i
 JOIN privacy_v2_private.verification_posts v ON v.post_id=i.post_id
 WHERE i.cleanup_pending OR v.retired_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM privacy_v2_private.verification_control WHERE enabled)
$$;
REVOKE ALL ON FUNCTION privacy_v2_private.release_security_evidence_ready() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='privacy_v2_private.release_control'::regclass
 AND conname='release_control_restricted_enabled_check') THEN
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='privacy_v2_private.release_control'::regclass AND conname='release_control_restricted_enabled_check') <> 'CHECK ((restricted_enabled = false))' THEN
   RAISE EXCEPTION 'Unexpected release constraint drift';
  END IF;
  ALTER TABLE privacy_v2_private.release_control DROP CONSTRAINT release_control_restricted_enabled_check;
 END IF;
END $$;
ALTER TABLE privacy_v2_private.release_control ADD CONSTRAINT release_control_verified_activation
CHECK(NOT restricted_enabled OR (delivery_verified AND publishing_verified AND privacy_v2_private.release_security_evidence_ready()));
-- Read-only health data; no account, registry or secret information is exposed.
CREATE FUNCTION public.privacy_release_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT public.protected_first_release_status() || jsonb_build_object('scope','eligible-authenticated-users')
$$;
REVOKE ALL ON FUNCTION public.privacy_release_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.privacy_release_status() TO anon,authenticated,service_role;

-- Reviewed service-role transitions may change between restricted audiences.
-- Public conversion remains forbidden by the registered-media guard.
CREATE OR REPLACE FUNCTION public.freeupper_public_only_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.visibility IS DISTINCT FROM 'public' THEN
  IF NOT(current_user='postgres' AND NEW.visibility IN ('followers','friends','only_me')
   AND NEW.publishing_state='draft' AND NEW.is_hidden IS TRUE
   AND privacy_v2_private.protected_publish_allowed(NEW.user_id,NEW.id)) THEN
   RAISE EXCEPTION 'Restricted post publishing is disabled' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.visibility IS DISTINCT FROM OLD.visibility AND NEW.visibility IS DISTINCT FROM 'public' THEN
  IF NOT(current_user='service_role' AND privacy_v2_private.protected_publish_allowed(NEW.user_id,NEW.id)
    AND EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id AND owner_id=NEW.user_id)) THEN
   RAISE EXCEPTION 'Restricted audience changes require reviewed transition' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- Normal deletion is recoverable for seven days; explicit permanent deletion
-- revokes media immediately and queues destruction after live signatures expire.
CREATE TABLE privacy_v2_private.post_deletions(
 post_id uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL,deleted_at timestamptz NOT NULL DEFAULT now(),
 purge_after timestamptz NOT NULL,permanent boolean NOT NULL DEFAULT false,
 previous_state text NOT NULL,previous_hidden boolean NOT NULL);
ALTER TABLE privacy_v2_private.post_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_v2_private.post_deletions FROM PUBLIC,anon,authenticated;
GRANT ALL ON privacy_v2_private.post_deletions TO service_role;
-- Preserve the timestamps and recoverability of already soft-deleted records.
INSERT INTO privacy_v2_private.post_deletions(post_id,owner_id,deleted_at,purge_after,permanent,previous_state,previous_hidden)
SELECT p.id,p.user_id,coalesce(p.deleted_at,now()),coalesce(p.deleted_at,now())+interval '7 days',
 p.publishing_state='failed' OR EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts v WHERE v.post_id=p.id AND v.retired_at IS NOT NULL),
 p.publishing_state,coalesce(p.is_hidden,false)
FROM public.posts p WHERE p.is_deleted IS TRUE;

CREATE OR REPLACE FUNCTION privacy_v2_private.protected_post_retirement_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE protected boolean; d privacy_v2_private.post_deletions%rowtype;
BEGIN
 SELECT EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=OLD.id AND owner_id=OLD.user_id) INTO protected;
 IF TG_OP='DELETE' THEN
  IF NOT protected THEN RETURN OLD; END IF;
  INSERT INTO privacy_v2_private.post_deletions(post_id,owner_id,purge_after,permanent,previous_state,previous_hidden)
   VALUES(OLD.id,OLD.user_id,now(),true,OLD.publishing_state,OLD.is_hidden)
   ON CONFLICT(post_id) DO UPDATE SET permanent=true,purge_after=now();
  UPDATE public.posts SET is_deleted=true,is_hidden=true,publishing_state='failed' WHERE id=OLD.id;
  RETURN NULL;
 END IF;
 SELECT * INTO d FROM privacy_v2_private.post_deletions WHERE post_id=OLD.id FOR UPDATE;
 IF OLD.is_deleted IS TRUE AND NEW.is_deleted IS DISTINCT FROM TRUE THEN
  IF d.post_id IS NULL OR d.permanent OR d.purge_after<=now()
    OR EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts WHERE post_id=OLD.id)
    OR (protected AND EXISTS(SELECT 1 FROM public.post_media_assets WHERE post_id=OLD.id AND status<>'ready')) THEN
   RAISE EXCEPTION 'Post cannot be restored' USING ERRCODE='23514';
  END IF;
  NEW.publishing_state:=d.previous_state; NEW.is_hidden:=d.previous_hidden; NEW.deleted_at:=NULL;
  DELETE FROM privacy_v2_private.post_deletions WHERE post_id=OLD.id;
  RETURN NEW;
 END IF;
 IF NEW.is_deleted IS TRUE OR (protected AND NEW.publishing_state='failed' AND NEW.is_hidden IS TRUE) THEN
  INSERT INTO privacy_v2_private.post_deletions(post_id,owner_id,purge_after,permanent,previous_state,previous_hidden)
   VALUES(OLD.id,OLD.user_id,now()+interval '7 days',NEW.publishing_state='failed',OLD.publishing_state,coalesce(OLD.is_hidden,false))
   ON CONFLICT(post_id) DO UPDATE SET permanent=post_deletions.permanent OR excluded.permanent;
  SELECT * INTO d FROM privacy_v2_private.post_deletions WHERE post_id=OLD.id;
  NEW.is_deleted:=true; NEW.is_hidden:=true; NEW.deleted_at:=d.deleted_at;
  IF protected AND d.permanent THEN
   NEW.publishing_state:='failed';
   PERFORM privacy_v2_private.queue_protected_retirement(OLD.id,OLD.user_id);
  END IF;
 END IF;
 RETURN NEW;
END $$;
-- Hidden deleted rows may be maintained even after release shutdown or suspension.
CREATE OR REPLACE FUNCTION privacy_v2_private.enforce_restricted_release_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NEW.visibility='public' THEN RETURN NEW; END IF;
 IF NEW.is_hidden IS TRUE AND NEW.is_deleted IS TRUE
 AND EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id AND owner_id=NEW.user_id) THEN RETURN NEW; END IF;
 IF NOT privacy_v2_private.protected_publish_allowed(NEW.user_id,NEW.id) THEN
  RAISE EXCEPTION 'Protected publishing release is disabled' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION privacy_v2_private.enforce_test_publisher_on_post()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NEW.visibility IN ('followers','friends','only_me') AND NOT(NEW.is_hidden IS TRUE AND NEW.is_deleted IS TRUE)
 AND NOT public.protected_publisher_beta_allowed(NEW.user_id) THEN
  RAISE EXCEPTION 'Protected publisher is ineligible' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.delete_post(p_post_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.posts WHERE id=p_post_id AND user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Post not found or not owned' USING ERRCODE='42501';
 END IF;
 UPDATE public.posts SET is_deleted=true,is_hidden=true WHERE id=p_post_id AND user_id=auth.uid();
END $$;
CREATE FUNCTION public.permanently_delete_post(p_post_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.posts WHERE id=p_post_id AND user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Post not found or not owned' USING ERRCODE='42501';
 END IF;
 DELETE FROM public.posts WHERE id=p_post_id AND user_id=auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.permanently_delete_post(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.permanently_delete_post(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.restore_post(p_post_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.posts WHERE id=p_post_id AND user_id=auth.uid() AND is_deleted IS TRUE) THEN
  RAISE EXCEPTION 'Post not found or not owned' USING ERRCODE='42501';
 END IF;
 UPDATE public.posts SET is_deleted=false WHERE id=p_post_id AND user_id=auth.uid();
 RETURN true;
END $$;
CREATE FUNCTION public.list_deleted_posts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'deleted_at',d.deleted_at,
 'purge_after',d.purge_after,'permanent',d.permanent) ORDER BY d.deleted_at DESC),'[]'::jsonb)
 FROM public.posts p JOIN privacy_v2_private.post_deletions d ON d.post_id=p.id AND d.owner_id=p.user_id
 WHERE p.user_id=auth.uid()
$$;
REVOKE ALL ON FUNCTION public.list_deleted_posts() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_deleted_posts() TO authenticated;
CREATE OR REPLACE FUNCTION public.expire_protected_drafts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE affected integer;
BEGIN
 UPDATE privacy_v2_private.post_deletions SET permanent=true WHERE purge_after<=now();
 DELETE FROM public.posts p USING privacy_v2_private.post_deletions d WHERE p.id=d.post_id AND d.permanent
 AND NOT EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=p.id);
 UPDATE public.posts p SET is_deleted=true,is_hidden=true,publishing_state='failed'
 WHERE (p.publishing_state='draft' AND p.draft_expires_at<=now()
   OR EXISTS(SELECT 1 FROM privacy_v2_private.post_deletions d WHERE d.post_id=p.id AND d.permanent))
 AND EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins o WHERE o.post_id=p.id AND o.owner_id=p.user_id);
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
END $$;
-- This migration never activates the release or enables legacy conversion.

-- One-use operator-authorized live workflow audit. Browser roles cannot request,
-- claim, or attest runs. It uses real Auth sessions and the deployed public APIs.
CREATE TABLE privacy_v2_private.release_workflow_audits(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','passed','failed')),result jsonb);
ALTER TABLE privacy_v2_private.release_workflow_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_v2_private.release_workflow_audits FROM PUBLIC,anon,authenticated;
GRANT ALL ON privacy_v2_private.release_workflow_audits TO service_role;
CREATE FUNCTION public.claim_release_workflow_audit(p_run uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF public.protected_first_release_status()->>'publishing'<>'true' THEN RETURN false; END IF;
 UPDATE privacy_v2_private.release_workflow_audits SET state='running'
 WHERE id=p_run AND state='queued' AND expires_at>now();
 RETURN FOUND;
END $$;
CREATE FUNCTION public.complete_release_workflow_audit(p_run uuid,p_passed boolean,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 UPDATE privacy_v2_private.release_workflow_audits SET state=CASE WHEN p_passed THEN 'passed' ELSE 'failed' END,result=p_result
 WHERE id=p_run AND state='running';
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO privacy_v2_private.security_audits(results) VALUES(jsonb_build_object('workflow_passed',p_passed,'run_id',p_run,'details',p_result));
 IF p_passed IS DISTINCT FROM true THEN UPDATE privacy_v2_private.release_control SET restricted_enabled=false,delivery_verified=false,publishing_verified=false WHERE singleton; END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.release_audit_relationships()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'eligible',public.protected_publisher_beta_allowed(p.id),
 'follows_owner',privacy_v2_private.approved_edge(p.id,'9341af03-e007-4fc6-9c23-b06073379088'),
 'owner_follows',privacy_v2_private.approved_edge('9341af03-e007-4fc6-9c23-b06073379088',p.id)))
 FROM public.profiles p WHERE p.id IN ('9341af03-e007-4fc6-9c23-b06073379088','a0a53cb6-be86-4862-b267-f7f43d4cf324',
 '1568563e-592f-4dd4-8efa-ee9429aebacb','5b5bd4b3-22df-41e7-8e6e-2dae82ee68df')
$$;
REVOKE ALL ON FUNCTION public.claim_release_workflow_audit(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_release_workflow_audit(uuid,boolean,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.release_audit_relationships() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_release_workflow_audit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_release_workflow_audit(uuid,boolean,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_audit_relationships() TO service_role;

-- Text has no Cloudinary delivery path. Keep its content behind the same post
-- audience RLS and registered origin, using an atomic service-only publication.
DO $$ DECLARE body text; BEGIN
 body:=pg_get_functiondef('privacy_v2_private.guard_protected_post_media()'::regprocedure);
 IF position(E'BEGIN\n IF NOT EXISTS' in body)=0 THEN RAISE EXCEPTION 'Protected media guard drift'; END IF;
 body:=replace(body,E'BEGIN\n IF NOT EXISTS',$patch$BEGIN
 IF NEW.media_type='text' AND EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id AND owner_id=NEW.user_id) THEN
  IF NEW.visibility NOT IN ('followers','friends','only_me') OR NEW.media IS DISTINCT FROM '[]'::jsonb
   OR NEW.media_plan IS DISTINCT FROM '[]'::jsonb OR NEW.media_url IS NOT NULL OR NEW.thumbnail_url IS NOT NULL OR NEW.sound_id IS NOT NULL
   OR NOT privacy_v2_private.valid_protected_draft_fields(NEW.publish_payload)
   OR (TG_OP='UPDATE' AND (OLD.media_type<>'text' OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.publish_payload IS DISTINCT FROM OLD.publish_payload)) THEN
   RAISE EXCEPTION 'Invalid restricted text post' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NOT EXISTS$patch$);
 EXECUTE body;
END $$;
CREATE FUNCTION public.publish_restricted_text(p_owner uuid,p_post uuid,p_visibility text,p_fields jsonb,p_template text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT privacy_v2_private.protected_publish_allowed(p_owner,p_post)
 OR p_post IS NULL OR p_visibility IS NULL OR p_visibility NOT IN ('followers','friends','only_me')
 OR NOT privacy_v2_private.valid_protected_draft_fields(p_fields)
 OR length(trim(coalesce(p_fields->>'title','')||coalesce(p_fields->>'content','')))=0
 OR (p_template IS NOT NULL AND p_template !~ '^[A-Za-z0-9_-]{1,60}$') THEN
  RAISE EXCEPTION 'Restricted text publication unavailable' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.posts(id,user_id,title,content,source,tags,comments_hidden,media_type,visibility,is_hidden,is_deleted,publishing_state,media,media_plan,publish_payload,text_template_id)
 VALUES(p_post,p_owner,coalesce(p_fields->>'title',''),coalesce(p_fields->>'content',''),p_fields->>'source',
 ARRAY(SELECT jsonb_array_elements_text(p_fields->'tags')),coalesce((p_fields->>'comments_hidden')::boolean,false),
 'text',p_visibility,true,false,'draft','[]'::jsonb,'[]'::jsonb,p_fields,p_template);
 INSERT INTO privacy_v2_private.protected_post_origins(post_id,owner_id) VALUES(p_post,p_owner);
 UPDATE public.posts SET publishing_state='published',is_hidden=false WHERE id=p_post;
 RETURN jsonb_build_object('id',p_post,'status','published','visibility',p_visibility,'media','[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.publish_restricted_text(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_restricted_text(uuid,uuid,text,jsonb,text) TO service_role;
