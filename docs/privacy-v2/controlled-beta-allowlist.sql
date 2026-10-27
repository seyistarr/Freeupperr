-- Align both existing publisher guards with the explicitly approved beta accounts.
-- This changes eligibility only; no release verification flags are set.
BEGIN;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.profiles WHERE
   (id='9341af03-e007-4fc6-9c23-b06073379088' AND username='archangelstr') OR
   (id='a0a53cb6-be86-4862-b267-f7f43d4cf324' AND username='freeupper') OR
   (id='5b5bd4b3-22df-41e7-8e6e-2dae82ee68df' AND username='MasterCraft')) <> 3
 THEN RAISE EXCEPTION 'Beta publisher identity mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM privacy_v2_private.protected_publisher_allowlist
   WHERE enabled AND user_id NOT IN ('9341af03-e007-4fc6-9c23-b06073379088',
     'a0a53cb6-be86-4862-b267-f7f43d4cf324','5b5bd4b3-22df-41e7-8e6e-2dae82ee68df'))
 THEN RAISE EXCEPTION 'Unexpected beta publisher; review required'; END IF;
END $$;
INSERT INTO privacy_v2_private.test_publishers(user_id)
VALUES ('9341af03-e007-4fc6-9c23-b06073379088'),
       ('a0a53cb6-be86-4862-b267-f7f43d4cf324'),
       ('5b5bd4b3-22df-41e7-8e6e-2dae82ee68df')
ON CONFLICT (user_id) DO UPDATE SET revoked_at=NULL;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM privacy_v2_private.test_publishers
   WHERE revoked_at IS NULL AND user_id NOT IN ('9341af03-e007-4fc6-9c23-b06073379088',
     'a0a53cb6-be86-4862-b267-f7f43d4cf324','5b5bd4b3-22df-41e7-8e6e-2dae82ee68df'))
 THEN RAISE EXCEPTION 'Unexpected test publisher; review required'; END IF;
 IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username)='firstuser'
   AND (public.protected_publisher_beta_allowed(id) OR public.privacy_v2_test_publisher_allowed(id)))
 THEN RAISE EXCEPTION 'Excluded account has publishing access'; END IF;
END $$;
COMMIT;

