-- Approval required. Disable frontend activity first; existing sockets need server-side termination.
-- Removes only objects owned by this migration. No messages or conversations are changed.
BEGIN;
DROP POLICY IF EXISTS chat_activity_receive ON realtime.messages;
DROP POLICY IF EXISTS chat_activity_send ON realtime.messages;
DROP POLICY IF EXISTS chat_activity_receive_guard ON realtime.messages;
DROP POLICY IF EXISTS chat_activity_send_guard ON realtime.messages;
DROP POLICY IF EXISTS chat_activity_anon_guard ON realtime.messages;
DROP FUNCTION IF EXISTS public.can_use_chat_activity(text);
DROP FUNCTION IF EXISTS chat_activity_private.can_use(text,boolean);
-- Deliberately leave the empty private schema; do not CASCADE unrelated objects.
COMMIT;
