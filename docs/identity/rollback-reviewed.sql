-- RETIRED. The old rollback restored email identities without a privacy approval guard.
DO $$ BEGIN RAISE EXCEPTION 'Retired rollback: use separately reviewed stage2-rollback.sql'; END $$;
