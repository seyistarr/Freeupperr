-- REVIEW ONLY: disable activity frontend first. No message/conversation rows are changed.
-- Keep obsolete Broadcast topics quarantined. Never restore the impersonatable transport.
BEGIN;
DROP FUNCTION IF EXISTS public.get_chat_activity(uuid);
DROP FUNCTION IF EXISTS public.publish_chat_activity(uuid,uuid,bigint,text,text,text,boolean,boolean);
DROP FUNCTION IF EXISTS chat_activity_private.publish(uuid,uuid,bigint,text,text,text,boolean,boolean);
-- Only short-lived activity state is discarded; publication membership is removed with the table.
DROP TABLE IF EXISTS public.chat_activity;
-- Keep private transport guards fail-closed while dropping the feature.
CREATE OR REPLACE FUNCTION public.can_join_chat_activity(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $function$ SELECT false; $function$;
DROP FUNCTION IF EXISTS public.can_read_chat_activity(uuid);
DROP FUNCTION IF EXISTS chat_activity_private.can_use(uuid,boolean);
-- Preserve conversation identity/permission trigger and corrected group-role RPC.
-- Preserve follow-up receipt guards, metadata trigger and secure group/invite/request RPCs.
-- Preserve public.can_use_chat_activity(text)=false and realtime.messages restrictive guards.
-- Leave the private schema in place; no CASCADE and no unrelated-policy changes.
COMMIT;
