-- Stop initialization for future signups; preserve all names already chosen/created.
BEGIN;
DROP TRIGGER initialize_google_display_name ON auth.users;
DROP FUNCTION identity_private.initialize_google_display_name();
COMMIT;
