-- REVIEW ONLY. DO NOT EXECUTE. This migration DOES NOT enable restricted audiences.
-- Order: registry -> this expansion -> reviewed audience RLS -> invoker readers ->
-- reviewed legacy consent/revocation machinery -> explicit production approval.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'jmjtqidirpmnegzvmiaq'
 OR current_setting('freeupper.privacy_v2_reviewed_release',true) IS DISTINCT FROM 'approved-production-migration'
 THEN RAISE EXCEPTION 'Explicit production migration approval required'; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS privacy_v2_private;
REVOKE ALL ON SCHEMA privacy_v2_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA privacy_v2_private TO service_role;
CREATE TABLE privacy_v2_private.release_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), restricted_enabled boolean NOT NULL DEFAULT false CHECK(restricted_enabled=false)
);
INSERT INTO privacy_v2_private.release_control DEFAULT VALUES;
ALTER TABLE privacy_v2_private.release_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_v2_private.release_control FROM PUBLIC,anon,authenticated,service_role;
-- Adding this default preserves every existing visibility value, including Public.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS publishing_state text NOT NULL DEFAULT 'published'
 CHECK(publishing_state IN ('draft','published','failed'));
CREATE TABLE privacy_v2_private.legacy_audience_consents (
 post_id uuid PRIMARY KEY REFERENCES public.posts, owner_id uuid NOT NULL REFERENCES auth.users,
 requested_visibility text NOT NULL CHECK(requested_visibility IN ('followers','friends','only_me')),
 source_snapshot jsonb NOT NULL, consented_at timestamptz NOT NULL DEFAULT now(),
 quarantine_consented_at timestamptz, quarantined_at timestamptz,
 revocation_started_at timestamptz, verified_at timestamptz,
 CHECK(verified_at IS NULL OR (revocation_started_at IS NOT NULL AND verified_at>=revocation_started_at+interval '31 days'))
);
ALTER TABLE privacy_v2_private.legacy_audience_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_v2_private.legacy_audience_consents FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON privacy_v2_private.legacy_audience_consents TO service_role;
-- Invoker: callable only through a JWT-validated owner endpoint; service role
-- supplied owner identity is never accepted directly from browser request JSON.
CREATE FUNCTION privacy_v2_private.record_owner_consent(p_owner uuid,p_post uuid,p_visibility text,p_ack boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.posts;
BEGIN
 SELECT * INTO p FROM public.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
 IF NOT FOUND OR p_ack IS NOT TRUE OR p.visibility<>'public' OR p.is_hidden IS NOT FALSE OR p.is_deleted IS NOT FALSE
 OR p_visibility IS NULL OR p_visibility NOT IN ('followers','friends','only_me') THEN RAISE EXCEPTION 'Explicit owner consent required'; END IF;
 INSERT INTO privacy_v2_private.legacy_audience_consents(post_id,owner_id,requested_visibility,source_snapshot)
 VALUES(p.id,p.user_id,p_visibility,to_jsonb(p)); -- replay/different snapshot fails closed
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.record_owner_consent(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_v2_private.record_owner_consent(uuid,uuid,text,boolean) TO service_role;
-- This trigger intentionally remains public-only even for service-role writes.
-- Enabling production will require a separate approved replacement with complete
-- registered-media, consent, revocation, unsupported-type and ownership checks.
CREATE FUNCTION public.privacy_v2_release_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.visibility<>'public') OR
    (TG_OP='UPDATE' AND NEW.visibility IS DISTINCT FROM OLD.visibility AND NEW.visibility<>'public')
 THEN RAISE EXCEPTION 'Restricted production publishing is disabled'; END IF;
 IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Post owner cannot change'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.privacy_v2_release_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER privacy_v2_release_guard BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.privacy_v2_release_guard();
-- Draft boundary cannot be bypassed by permissive owner ALL policies.
CREATE POLICY privacy_v2_published_boundary ON public.posts AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING(publishing_state='published' AND is_hidden IS FALSE AND is_deleted IS FALSE);
CREATE VIEW public.privacy_v2_visible_posts WITH(security_invoker=true,security_barrier=true) AS
 SELECT p.id,p.user_id,p.title,p.content,p.visibility,p.media FROM public.posts p
 WHERE p.publishing_state='published' AND p.is_hidden=false AND p.is_deleted=false;
GRANT SELECT ON public.privacy_v2_visible_posts TO anon,authenticated;
CREATE FUNCTION public.privacy_v2_search(p_query text DEFAULT '',p_limit integer DEFAULT 20)
RETURNS SETOF public.privacy_v2_visible_posts LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT * FROM public.privacy_v2_visible_posts
 WHERE title ILIKE '%'||left(coalesce(p_query,''),200)||'%' OR content ILIKE '%'||left(coalesce(p_query,''),200)||'%'
 ORDER BY id LIMIT least(greatest(coalesce(p_limit,20),1),50)
$$;
REVOKE ALL ON FUNCTION public.privacy_v2_search(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.privacy_v2_search(text,integer) TO anon,authenticated;
-- Child rows must not leak restricted post existence, comments or quote text.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['reposts','comments','bookmarks','post_likes','post_views'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='post_id')
   THEN RAISE EXCEPTION 'Unexpected dependent table shape: %',t; END IF;
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('CREATE POLICY privacy_v2_parent_boundary ON public.%I AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(EXISTS(SELECT 1 FROM public.posts p WHERE p.id=%I.post_id))',t,t);
  END IF;
 END LOOP;
END $$;
COMMIT;
-- Mandatory separate release blockers: enumerate ALL existing SECURITY DEFINER
-- RPCs (including PL/pgSQL dynamic SQL), post-derived views/materialized views,
-- quote snapshots, original sounds, SEO service-role queries and storage copies.
-- Replace/revoke unsafe entrypoints before any private post can exist. This
-- script does not pretend generic RLS constrains a BYPASSRLS/DEFINER reader.
