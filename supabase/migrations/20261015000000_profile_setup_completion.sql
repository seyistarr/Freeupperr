-- FreeUpper profile setup tracking: staging-first migration.
-- Do not automatically mark historical profiles as complete.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_setup_completed_at timestamptz;

COMMENT ON COLUMN public.profiles.profile_setup_completed_at IS
  'Set after an authenticated user deliberately saves a valid display name and username. NULL means unverified completion.';

-- Review candidates manually before any historical backfill:
-- SELECT id, username, display_name, created_at
-- FROM public.profiles
-- WHERE profile_setup_completed_at IS NULL
-- ORDER BY created_at DESC;

-- SEO eligibility is separate from the existing public profile RPC to preserve its return signature.
-- Only a completed, public, unsuspended profile is eligible for indexing.
CREATE OR REPLACE FUNCTION public.get_public_profile_seo_status(p_freeupper_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.freeupper_id = p_freeupper_id
      AND p.is_private IS FALSE
      AND COALESCE(p.suspended, false) IS FALSE
      AND p.profile_setup_completed_at IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.get_public_profile_seo_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_seo_status(text) TO anon, authenticated;
