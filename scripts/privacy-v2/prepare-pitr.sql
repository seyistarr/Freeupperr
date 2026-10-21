-- PREPARATION ONLY. Execute only once an isolated restore-to-new-project exercise
-- is available. Pauses STAGING cron before choosing a backup/PITR point, so a
-- clone cannot replay the source's cleanup worker using copied Vault secrets.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt'
 OR current_setting('freeupper.privacy_v2_recovery_exercise',true) IS DISTINCT FROM 'quiesce-isolated-staging-only'
 OR (SELECT count(*) FROM privacy_test.legacy_media_jobs WHERE id IN
  ('99270662-125a-48fe-828e-469da012b29a','f3181572-90ce-4226-9e07-370d0417ee5c'))<>2
 THEN RAISE EXCEPTION 'Explicit isolated synthetic recovery preparation required'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS privacy_test.pitr_exercise_markers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT now(),active_cron_ids jsonb NOT NULL,
 source_project text NOT NULL DEFAULT 'tagkrhvgcbnybiuyvjxt' CHECK(source_project='tagkrhvgcbnybiuyvjxt'));
ALTER TABLE privacy_test.pitr_exercise_markers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_test.pitr_exercise_markers FROM PUBLIC,anon,authenticated;
INSERT INTO privacy_test.pitr_exercise_markers(active_cron_ids) SELECT coalesce(jsonb_agg(jobid),'[]') FROM cron.job WHERE active;
UPDATE cron.job SET active=false WHERE active;
COMMIT;
-- Choose a restore point AFTER this committed pause. Do not restore a historical
-- backup containing active jobs. This output contains no Vault secrets/commands.
SELECT id,created_at,clock_timestamp() AS safe_point_after_commit FROM privacy_test.pitr_exercise_markers ORDER BY created_at DESC LIMIT 1;
-- After cloning/verification, resume only these recorded job IDs in the ORIGINAL
-- staging project through an explicitly reviewed operator action. Never enable
-- copied jobs or outbound hooks in the recovery clone. Never restore in place.
