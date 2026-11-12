-- New Auth users only. No backfill, no client metadata, no identifier changes.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('identity_private.default_profile_identity()') IS NULL
    OR to_regprocedure('identity_private.validate_profile_identity()') IS NULL THEN
    RAISE EXCEPTION 'Stage 1 identity migration is required';
  END IF;
END $$;

CREATE FUNCTION identity_private.initialize_google_display_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  provider_data jsonb;
  candidate text;
BEGIN
  -- Supabase Auth creates users before identities in the same transaction.
  -- The deferred INSERT event reads provider-owned identity_data at commit.
  -- Never use raw_user_meta_data, which users can edit, or a browser argument.
  IF NEW.raw_app_meta_data->>'provider' IS DISTINCT FROM 'google' THEN
    RETURN NEW;
  END IF;
  SELECT i.identity_data INTO provider_data FROM auth.identities i
    WHERE i.user_id = NEW.id AND i.provider = 'google'
    ORDER BY i.created_at, i.id LIMIT 1;
  IF provider_data IS NULL THEN RETURN NEW; END IF;

  IF jsonb_typeof(provider_data->'full_name') = 'string' THEN
    candidate := nullif(trim(provider_data->>'full_name'), '');
  END IF;
  IF candidate IS NULL AND jsonb_typeof(provider_data->'name') = 'string' THEN
    candidate := provider_data->>'name';
  END IF;
  -- Collapse whitespace; remove controls, invisible separators and bidi overrides.
  candidate := trim(translate(regexp_replace(
    regexp_replace(candidate, '[[:space:]]+', ' ', 'g'), '[[:cntrl:]]', '', 'g'),
    U&'\200B\200C\200D\200E\200F\202A\202B\202C\202D\202E\2060\2066\2067\2068\2069\FEFF', ''));
  -- Keep the existing 2..40 character limit. Reject email/markup and email local
  -- parts rather than truncating an unusable provider value into a public name.
  IF candidate IS NULL OR length(candidate) NOT BETWEEN 2 AND 40
    OR candidate ~ '[@<>]'
    OR lower(candidate) = lower(split_part(coalesce(NEW.email,''), '@', 1))
    OR lower(candidate) = lower(split_part(coalesce(provider_data->>'email',''), '@', 1)) THEN
    RETURN NEW;
  END IF;

  UPDATE public.profiles p SET display_name = candidate
    WHERE p.id = NEW.id AND p.display_name = 'FreeUpper User'
      AND p.username = lower(p.freeupper_id)
      AND p.display_username = p.username
      AND p.profile_setup_completed_at IS NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION identity_private.initialize_google_display_name()
  FROM PUBLIC, anon, authenticated;

-- INSERT only: logins, identity linking and metadata updates never reset names.
CREATE CONSTRAINT TRIGGER initialize_google_display_name
  AFTER INSERT ON auth.users DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION identity_private.initialize_google_display_name();
COMMIT;
