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
CREATE EXTENSION IF NOT EXISTS pg_net;
-- The queued authorization header and decrypted secret are admin-only, never
-- readable/callable by anon or authenticated roles through the Data API.
REVOKE ALL ON SCHEMA vault,net FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA vault,net FROM PUBLIC,anon,authenticated;
-- Keep native Vault crypto helper ACLs intact: internal encryption depends on them.
-- Browser roles are blocked by schema usage and table ACLs above.
SELECT cron.schedule('freeupper-privacy-v2-staging-cleanup','*/5 * * * *',$job$
  SELECT net.http_post(
    url := 'https://freeupper-git-feature-post-privacy-v-3ab7d2-seyistarrs-projects.vercel.app/api/privacy-v2-publish?worker=cleanup',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='freeupper_privacy_v2_cleanup_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
COMMIT;
