-- REVIEW ONLY: non-destructive rollback after quotes exist. Stop publication and embedded reads.
BEGIN;
UPDATE privacy_v2_private.quote_repost_rollout SET publishing_enabled=false,read_enabled=false WHERE singleton;
COMMIT;
-- Redeploy the disabled client. Keep metadata and counter triggers for existing authored quotes.
