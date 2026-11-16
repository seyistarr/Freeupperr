-- REVIEW ONLY. Production inspected read-only 2026-11-16. Do not apply automatically.
-- This authorizes joins, NOT payload identity or immediate connected-client revocation.
BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'realtime.messages'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'realtime.messages RLS must already be enabled';
  END IF;
  IF NOT has_table_privilege('authenticated', 'realtime.messages', 'SELECT') OR
     NOT has_table_privilege('authenticated', 'realtime.messages', 'INSERT') THEN
    RAISE EXCEPTION 'Expected existing authenticated Realtime grants';
  END IF;
  IF to_regprocedure('public.is_blocked_between(uuid,uuid)') IS NULL OR
     to_regprocedure('public.can_send_in_conversation(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required production chat authorization helpers are absent';
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS chat_activity_private;
REVOKE ALL ON SCHEMA chat_activity_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA chat_activity_private TO authenticated;

-- Bypass recursive membership RLS only for this tightly scoped boolean lookup.
-- No user-selected identity, no dynamic SQL, explicit auth.uid(), fully qualified objects.
CREATE OR REPLACE FUNCTION chat_activity_private.can_use(p_topic text, p_sending boolean)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR p_topic IS NULL OR
     p_topic !~ '^chat-activity:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN false;
  END IF;
  v_id := substr(p_topic, 15)::uuid;
  RETURN EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = v_id AND NOT coalesce(c.is_note, false)
      AND CASE WHEN coalesce(c.is_group, false) THEN
        EXISTS (SELECT 1 FROM public.conversation_members m
                WHERE m.conversation_id = c.id AND m.user_id = v_uid)
        AND (NOT p_sending OR public.can_send_in_conversation(c.id))
      ELSE
        (v_uid = c.user1_id OR v_uid = c.user2_id)
        AND NOT public.is_blocked_between(c.user1_id, c.user2_id)
      END
  );
END
$function$;
REVOKE ALL ON FUNCTION chat_activity_private.can_use(text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chat_activity_private.can_use(text,boolean) TO authenticated;

-- Preserve the approved external function name without exposing a public definer.
CREATE OR REPLACE FUNCTION public.can_use_chat_activity(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT chat_activity_private.can_use(p_topic, false);
$function$;
REVOKE ALL ON FUNCTION public.can_use_chat_activity(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_chat_activity(text) TO authenticated;

DROP POLICY IF EXISTS chat_activity_receive ON realtime.messages;
CREATE POLICY chat_activity_receive ON realtime.messages FOR SELECT TO authenticated
USING (extension = 'broadcast' AND public.can_use_chat_activity((SELECT realtime.topic())));
DROP POLICY IF EXISTS chat_activity_send ON realtime.messages;
CREATE POLICY chat_activity_send ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (extension = 'broadcast' AND chat_activity_private.can_use((SELECT realtime.topic()), true));

-- Permissive policies OR together. Namespace-scoped restrictive policies keep a
-- future broad policy from bypassing this boundary, without altering other topics.
DROP POLICY IF EXISTS chat_activity_receive_guard ON realtime.messages;
CREATE POLICY chat_activity_receive_guard ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated
USING ((SELECT realtime.topic()) NOT LIKE 'chat-activity:%' OR
       (extension = 'broadcast' AND public.can_use_chat_activity((SELECT realtime.topic()))));
DROP POLICY IF EXISTS chat_activity_send_guard ON realtime.messages;
CREATE POLICY chat_activity_send_guard ON realtime.messages AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK ((SELECT realtime.topic()) NOT LIKE 'chat-activity:%' OR
       (extension = 'broadcast' AND chat_activity_private.can_use((SELECT realtime.topic()), true)));
DROP POLICY IF EXISTS chat_activity_anon_guard ON realtime.messages;
CREATE POLICY chat_activity_anon_guard ON realtime.messages AS RESTRICTIVE FOR ALL TO anon
USING ((SELECT realtime.topic()) NOT LIKE 'chat-activity:%')
WITH CHECK ((SELECT realtime.topic()) NOT LIKE 'chat-activity:%');
COMMIT;
