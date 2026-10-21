-- STAGING ONLY: close direct-PostgREST access with a JWT whose Auth session
-- has been revoked. API getUser already rejects this JWT; RLS must agree.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt'
 THEN RAISE EXCEPTION 'Isolated staging acknowledgement required'; END IF;
 IF to_regprocedure('privacy_test.protected_first_capabilities()') IS NULL OR
  NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='privacy_test' AND tablename='posts'
    AND policyname='privacy_v2_audience_boundary' AND permissive='RESTRICTIVE') OR
  NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='sessions' AND column_name='not_after')
 THEN RAISE EXCEPTION 'Protected-first/session prerequisites required'; END IF;
END $$;
-- No arguments: callers cannot ask about another identity or session. The
-- definer reads only the indexed current-user/current-session existence bit.
CREATE FUNCTION privacy_test.has_live_viewer_session() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN (auth.jwt()->>'session_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 THEN EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=(auth.jwt()->>'session_id')::uuid
   AND s.user_id=auth.uid() AND (s.not_after IS NULL OR s.not_after>statement_timestamp()))
 ELSE false END;
$$;
REVOKE ALL ON FUNCTION privacy_test.has_live_viewer_session() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION privacy_test.has_live_viewer_session() TO authenticated;
CREATE POLICY privacy_v2_live_viewer_session ON privacy_test.posts AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT privacy_test.has_live_viewer_session()));
-- Anonymous Public reads and service-role transitions are unchanged.
COMMIT;
