-- Defaults only: this migration does NOT rewrite existing profiles.
BEGIN;
CREATE SCHEMA IF NOT EXISTS identity_private;
REVOKE ALL ON SCHEMA identity_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION identity_private.default_profile_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- The column DEFAULT has already supplied the existing FreeUpper ID.
  IF NEW.freeupper_id IS NULL OR NEW.freeupper_id !~ '^FU[0-9A-F]{12}$' THEN
    RAISE EXCEPTION 'Invalid database FreeUpper ID' USING ERRCODE='23514';
  END IF;
  NEW.username := lower(NEW.freeupper_id);
  NEW.display_username := NEW.username;
  NEW.display_name := 'FreeUpper User';
  NEW.onboarding_completed := false;
  NEW.profile_setup_completed_at := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION identity_private.default_profile_identity() FROM PUBLIC;
CREATE TRIGGER default_profile_identity BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION identity_private.default_profile_identity();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE conflicting_constraint text;
BEGIN
  -- Retry the existing column DEFAULT only for an uncommitted new profile.
  -- Never modify an existing profile or append a frontend-generated suffix.
  FOR attempt IN 1..5 LOOP
    BEGIN
      INSERT INTO public.profiles (id, avatar_url)
      VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'avatar_url',''))
      ON CONFLICT (id) DO NOTHING;
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS conflicting_constraint = CONSTRAINT_NAME;
      IF attempt = 5 OR conflicting_constraint NOT IN
        ('profiles_freeupper_id_key','profiles_username_key','profiles_username_lower_idx') THEN
        RAISE;
      END IF;
    END;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Unchanged legacy values remain editable in unrelated profile updates.
-- The FU+12 hex namespace is reserved for the corresponding existing ID.
CREATE FUNCTION identity_private.validate_profile_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.username IS DISTINCT FROM OLD.username THEN
    IF NEW.username IS NULL OR NEW.username !~ '^[a-z0-9_]{3,30}$'
      OR (NEW.username ~ '^fu[0-9a-f]{12}$' AND NEW.username <> lower(OLD.freeupper_id)) THEN
      RAISE EXCEPTION 'Invalid or reserved username' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    IF NEW.display_name IS NULL OR length(trim(NEW.display_name)) NOT BETWEEN 2 AND 40
      OR NEW.display_name ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' THEN
      RAISE EXCEPTION 'Invalid display name' USING ERRCODE='23514';
    END IF;
  END IF;
  -- Preserve genuine presentation names; synchronize only the old canonical mirror.
  IF NEW.username IS DISTINCT FROM OLD.username
    AND NEW.display_username IS NOT DISTINCT FROM OLD.display_username
    AND OLD.display_username = OLD.username THEN
    NEW.display_username := NEW.username;
  END IF;
  IF NEW.display_username IS DISTINCT FROM OLD.display_username
    AND NEW.display_username ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' THEN
    RAISE EXCEPTION 'Invalid presentation username' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION identity_private.validate_profile_identity() FROM PUBLIC;
CREATE TRIGGER validate_profile_identity BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION identity_private.validate_profile_identity();
-- Preserve the RPC contract; former email handles never resolve or redirect.
-- Compatibility uses permanent FreeUpper-ID and UUID links, not email aliases.
CREATE OR REPLACE FUNCTION public.get_public_profile_by_username(p_username text)
RETURNS TABLE(profile_id uuid, freeupper_id text, username text, display_name text,
 display_username text, avatar_url text, cover_url text, bio text, verified boolean,
 verified_status text, verification_status text, is_private boolean,
 hide_follower_count boolean, activity_status boolean, country text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p.id,p.freeupper_id,p.username,p.display_name,p.display_username,p.avatar_url,
 p.cover_url,p.bio,p.verified,p.verified_status,p.verification_status,p.is_private,
 p.hide_follower_count,p.activity_status,p.country,p.created_at
 FROM public.profiles p
 WHERE coalesce(p.suspended,false)=false
 AND trim(p_username) ~ '^[A-Za-z0-9_.]{1,30}$'
 AND lower(p.username)=lower(trim(p_username))
 LIMIT 1
$$;
COMMIT;
