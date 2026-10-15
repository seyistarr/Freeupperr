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
