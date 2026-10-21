-- Isolated SYNTHETIC fixtures only. Metadata expansion, no Cloudinary requests.
-- Never changes deletion clocks, observations, copies, post visibility or assets.
BEGIN;
DO $$ DECLARE j record; expanded jsonb; before_count integer; after_count integer; BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt'
 THEN RAISE EXCEPTION 'Explicit isolated staging acknowledgement required'; END IF;
 IF (SELECT count(*) FROM privacy_test.legacy_media_jobs WHERE id IN
  ('99270662-125a-48fe-828e-469da012b29a','f3181572-90ce-4226-9e07-370d0417ee5c')
  AND owner_id='ea903e28-c74f-4202-9d4a-3dd9bd2a2178' AND state='revoking' AND observations='[]' AND verified_at IS NULL)<>2
 THEN RAISE EXCEPTION 'Unverified synthetic jobs required'; END IF;
 FOR j IN SELECT * FROM privacy_test.legacy_media_jobs WHERE id IN
  ('99270662-125a-48fe-828e-469da012b29a','f3181572-90ce-4226-9e07-370d0417ee5c') FOR UPDATE LOOP
  SELECT sum(jsonb_array_length(s->'probe_urls')) INTO before_count FROM jsonb_array_elements(j.plan->'sources') s;
  SELECT jsonb_agg(jsonb_set(s,'{probe_urls}',(SELECT jsonb_agg(url ORDER BY url) FROM
   (SELECT DISTINCT url FROM (SELECT u AS url FROM jsonb_array_elements_text(s->'probe_urls') u
    UNION ALL SELECT regexp_replace(u,'/v[0-9]+/','/v1/') AS url FROM jsonb_array_elements_text(s->'probe_urls') u WHERE u ~ '/v[0-9]+/') all_urls) dedup)))
   INTO expanded FROM jsonb_array_elements(j.plan->'sources') s;
  SELECT sum(jsonb_array_length(s->'probe_urls')) INTO after_count FROM jsonb_array_elements(expanded) s;
  UPDATE privacy_test.legacy_media_jobs SET plan=jsonb_set(plan,'{sources}',expanded) WHERE id=j.id;
  INSERT INTO privacy_test.legacy_media_events(job_id,action,details) VALUES(j.id,'synthetic_probe_alias_expansion',
   jsonb_build_object('before',before_count,'after',after_count,'deletion_clock_unchanged',true));
  IF (SELECT revocation_started_at FROM privacy_test.legacy_media_jobs WHERE id=j.id) IS DISTINCT FROM j.revocation_started_at
  THEN RAISE EXCEPTION 'Deletion clock changed'; END IF;
 END LOOP;
END $$;
COMMIT;
