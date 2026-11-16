-- REVIEW ONLY. Explicit approval required before production execution.
-- Stops new activity publication without changing messages, conversations or memberships.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.publish_chat_activity(uuid,uuid,bigint,text,text,text,boolean,boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION chat_activity_private.publish(uuid,uuid,bigint,text,text,text,boolean,boolean) FROM authenticated;
COMMIT;
