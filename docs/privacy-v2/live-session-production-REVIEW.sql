-- REVIEW ONLY: do not apply without explicit production migration approval.
-- Follow the production authorization and protected-first core migrations.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'jmjtqidirpmnegzvmiaq'
 OR current_setting('freeupper.privacy_v2_reviewed_release',true) IS DISTINCT FROM 'approved-production-migration'
 THEN RAISE EXCEPTION 'Explicit production migration approval required'; END IF;
 IF to_regclass('privacy_v2_private.protected_post_origins') IS NULL OR
 NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='posts' AND policyname='privacy_v2_approved_audience')
 THEN RAISE EXCEPTION 'Reviewed authorization/core prerequisites required'; END IF;
END $$;
-- No arguments: callers cannot ask about another identity or session. The
-- definer reads only the indexed current-user/current-session existence bit.
CREATE FUNCTION privacy_v2_private.has_live_viewer_session() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN (auth.jwt()->>'session_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 THEN EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(auth.jwt()->>'session_id')::uuid
   AND s.user_id=auth.uid() AND (s.not_after IS NULL OR s.not_after>statement_timestamp()))
 ELSE false END;
$$;
REVOKE ALL ON FUNCTION privacy_v2_private.has_live_viewer_session() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION privacy_v2_private.has_live_viewer_session() TO authenticated;
CREATE POLICY privacy_v2_live_viewer_session ON public.posts AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT privacy_v2_private.has_live_viewer_session()));
COMMIT;
