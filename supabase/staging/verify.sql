-- Read-only checks to run in the NEW STAGING project after separately approved setup.
SELECT schemaname,tablename,rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN ('trg_notify_new_message','trg_notify_social_notification','on_auth_user_created');
SELECT policyname,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('push_tokens','user_settings');
SELECT p.proname,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('notify_new_message','notify_new_social_notification');
SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp','pgcrypto','pg_trgm','vector','pg_net','supabase_vault');
SELECT pubname,schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';
-- Expected: both outbound triggers D; only the staging sender URL; Vault secret reference, no literal key.
-- Do not SELECT vault.decrypted_secrets or token/user/message rows to share diagnostic output.
