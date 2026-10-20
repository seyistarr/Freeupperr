-- Apply only on tagkrhvgcbnybiuyvjxt after the two Privacy V2 staging migrations.
-- Before applying, provision the SAME random staging cleanup token in branch-scoped
-- Vercel FREEUPPER_CLEANUP_TOKEN and Vault secret freeupper_privacy_v2_cleanup_token.
-- Never put the token in this file, the cron command, or browser code.
BEGIN;
DO $$ BEGIN
  IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt' THEN
    RAISE EXCEPTION 'Explicit isolated staging project acknowledgement required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='freeupper_privacy_v2_cleanup_token') THEN
    RAISE EXCEPTION 'Staging cleanup token must be provisioned in Vault first';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
-- Keep credentials out of pg_net's shared request queue. Synchronous HTTP sends
-- the Vault header only from backend memory; cron stores only this function call.
REVOKE ALL ON SCHEMA vault FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION privacy_test.run_staging_cleanup_job()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE response_status integer;
BEGIN
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','120000');
  SELECT response.status INTO response_status
  FROM extensions.http((
    'POST',
    'https://freeupper-git-feature-post-privacy-v-3ab7d2-seyistarrs-projects.vercel.app/api/privacy-v2-publish?worker=cleanup',
    ARRAY[extensions.http_header('Authorization','Bearer ' ||
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='freeupper_privacy_v2_cleanup_token'))],
    'application/json', '{}'
  )::extensions.http_request) AS response;
  RETURN response_status;
EXCEPTION WHEN OTHERS THEN
  -- Never persist provider diagnostics that could include request headers.
  RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION privacy_test.run_staging_cleanup_job() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('freeupper-privacy-v2-staging-cleanup','*/5 * * * *',
  'SELECT privacy_test.run_staging_cleanup_job();');
COMMIT;
