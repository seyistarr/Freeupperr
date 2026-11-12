-- RETIRED. Superseded by stage2-apply.template.sql and the concrete email-free
-- field manifest from scripts/identity/prepare-stage2.py. Never run this legacy path.
DO $$ BEGIN RAISE EXCEPTION 'Retired migration: use the reviewed Stage 2 artifact'; END $$;
