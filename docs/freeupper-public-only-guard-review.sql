-- REVIEW ONLY. Do not execute until tested and approved.
BEGIN;
CREATE OR REPLACE FUNCTION public.freeupper_public_only_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.visibility IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION 'Restricted post publishing is disabled' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.visibility IS DISTINCT FROM OLD.visibility
    AND NEW.visibility IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION 'Restricted post publishing is disabled' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS freeupper_public_only_guard_trigger ON public.posts;
CREATE TRIGGER freeupper_public_only_guard_trigger BEFORE INSERT OR UPDATE OF visibility ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.freeupper_public_only_guard();
COMMIT;
-- Rollback (separate transaction):
-- BEGIN;
-- DROP TRIGGER IF EXISTS freeupper_public_only_guard_trigger ON public.posts;
-- DROP FUNCTION IF EXISTS public.freeupper_public_only_guard();
-- COMMIT;
