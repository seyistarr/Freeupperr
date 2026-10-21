-- STAGING ONLY: mirror anonymous Public reads; browser writes and private
-- registries/RPCs remain unavailable. Stop rather than expose schema drift.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt'
 THEN RAISE EXCEPTION 'Isolated staging acknowledgement required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='privacy_test' AND c.relkind IN ('r','v','m','p') AND
   (has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE') OR
    (has_table_privilege('anon',c.oid,'SELECT') AND (c.relname NOT IN ('posts','profiles','follows') OR NOT c.relrowsecurity))))
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='privacy_test' AND has_function_privilege('anon',p.oid,'EXECUTE') AND p.prorettype<>'trigger'::regtype)
 OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='privacy_test' AND tablename='posts'
   AND policyname='privacy_v2_audience_boundary' AND permissive='RESTRICTIVE')
 THEN RAISE EXCEPTION 'Anonymous staging exposure prerequisites changed'; END IF;
END $$;
GRANT USAGE ON SCHEMA privacy_test TO anon;
COMMIT;

