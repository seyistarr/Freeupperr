-- REVIEW ONLY. Replaces the never-applied 7528928 Broadcast proposal.
-- Production catalog checked read-only. Apply only after explicit approval.
-- Activity uses Postgres Changes: RLS is evaluated for EACH change, not a cached Broadcast join.
BEGIN;
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='realtime.messages'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'Expected realtime.messages RLS';
  END IF;
  IF to_regprocedure('public.is_blocked_between(uuid,uuid)') IS NULL OR
     to_regprocedure('public.can_send_in_conversation(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required production authorization helpers are absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    RAISE EXCEPTION 'Expected existing Realtime publication';
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS chat_activity_private;
REVOKE ALL ON SCHEMA chat_activity_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA chat_activity_private TO authenticated;

CREATE TABLE IF NOT EXISTS public.chat_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id uuid NOT NULL,
  event text NOT NULL CHECK(event IN ('typing','activity')),
  kind text CHECK(kind IN ('recording','photo','video','media')),
  stage text CHECK(stage IN ('preparing','uploading')),
  plural boolean NOT NULL DEFAULT false,
  active boolean NOT NULL,
  sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE(conversation_id,user_id,source_id,event),
  CHECK(expires_at > updated_at AND expires_at <= updated_at + interval '7 seconds'),
  CHECK((event='typing' AND kind IS NULL AND stage IS NULL) OR
        (event='activity' AND ((active AND kind IS NOT NULL) OR NOT active)))
);
-- DEFAULT replica identity exposes only opaque id on DELETE, not conversation/user keys.
ALTER TABLE public.chat_activity REPLICA IDENTITY DEFAULT;
ALTER TABLE public.chat_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_activity TO authenticated;
CREATE INDEX IF NOT EXISTS chat_activity_user_expiry_idx ON public.chat_activity(user_id,expires_at);
CREATE INDEX IF NOT EXISTS chat_activity_expiry_idx ON public.chat_activity(expires_at);

-- Legacy conversation UPDATE policies are permissive. A removed user1 owner must
-- not regain activity access by changing a group into a direct conversation.
CREATE OR REPLACE FUNCTION chat_activity_private.protect_conversation_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
BEGIN
 IF current_user IN ('anon','authenticated') THEN
  IF ROW(NEW.user1_id,NEW.user2_id,NEW.is_group,NEW.is_note,NEW.owner_id,NEW.created_by)
      IS DISTINCT FROM ROW(OLD.user1_id,OLD.user2_id,OLD.is_group,OLD.is_note,OLD.owner_id,OLD.created_by) THEN
   RAISE EXCEPTION 'Conversation identity requires an authorized server operation' USING ERRCODE='42501';
  END IF;
  IF NEW.permissions IS DISTINCT FROM OLD.permissions AND coalesce(OLD.is_group,false) AND
     NOT (coalesce(OLD.is_note,false) AND OLD.owner_id=auth.uid()) AND NOT EXISTS(
      SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=OLD.id
       AND m.user_id=auth.uid() AND m.role IN ('owner','admin')) THEN
   RAISE EXCEPTION 'Only current group administrators can change permissions' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION chat_activity_private.protect_conversation_identity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS chat_activity_protect_conversation_identity ON public.conversations;
CREATE TRIGGER chat_activity_protect_conversation_identity
 BEFORE UPDATE OF user1_id,user2_id,is_group,is_note,owner_id,created_by,permissions ON public.conversations
 FOR EACH ROW EXECUTE FUNCTION chat_activity_private.protect_conversation_identity();

-- Fix confirmed production null-owner bypass; preserve the approved group-role RPC signature.
CREATE OR REPLACE FUNCTION chat_activity_private.set_member_role(p_conversation_id uuid,p_target_user_id uuid,p_new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_role text; v_target text;
BEGIN
 IF auth.uid() IS NULL OR p_new_role IS NULL OR p_new_role NOT IN ('admin','member') THEN
  RAISE EXCEPTION 'Invalid group-role request' USING ERRCODE='42501';
 END IF;
 SELECT m.role INTO v_role FROM public.conversation_members m JOIN public.conversations c ON c.id=m.conversation_id
 WHERE m.conversation_id=p_conversation_id AND m.user_id=auth.uid()
  AND coalesce(c.is_group,false) AND NOT coalesce(c.is_note,false) FOR UPDATE OF m;
 IF v_role IS DISTINCT FROM 'owner' THEN
  RAISE EXCEPTION 'Only the current group owner can change roles' USING ERRCODE='42501';
 END IF;
 SELECT m.role INTO v_target FROM public.conversation_members m
 WHERE m.conversation_id=p_conversation_id AND m.user_id=p_target_user_id FOR UPDATE;
 IF v_target IS NULL OR v_target='owner' THEN
  RAISE EXCEPTION 'Invalid target group member' USING ERRCODE='42501';
 END IF;
 UPDATE public.conversation_members SET role=p_new_role
 WHERE conversation_id=p_conversation_id AND user_id=p_target_user_id;
END;
$function$;
REVOKE ALL ON FUNCTION chat_activity_private.set_member_role(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION chat_activity_private.set_member_role(uuid,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.set_member_role(p_conversation_id uuid,p_target_user_id uuid,p_new_role text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT chat_activity_private.set_member_role(p_conversation_id,p_target_user_id,p_new_role); $function$;
REVOKE ALL ON FUNCTION public.set_member_role(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid,uuid,text) TO authenticated;

-- Explicit identity lookup avoids recursive legacy membership RLS. No caller-selected UID.
CREATE OR REPLACE FUNCTION chat_activity_private.can_use(p_conversation_id uuid,p_sending boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.conversations c WHERE c.id=p_conversation_id
   AND NOT coalesce(c.is_note,false)
   AND CASE WHEN coalesce(c.is_group,false) THEN
    EXISTS(SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id=auth.uid())
    AND (NOT p_sending OR public.can_send_in_conversation(c.id))
   ELSE (auth.uid()=c.user1_id OR auth.uid()=c.user2_id)
    AND NOT public.is_blocked_between(c.user1_id,c.user2_id) END
 );
$function$;
REVOKE ALL ON FUNCTION chat_activity_private.can_use(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chat_activity_private.can_use(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_chat_activity(p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $function$ SELECT chat_activity_private.can_use(p_conversation_id,false); $function$;
REVOKE ALL ON FUNCTION public.can_read_chat_activity(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_chat_activity(uuid) TO authenticated;

DROP POLICY IF EXISTS chat_activity_read ON public.chat_activity;
CREATE POLICY chat_activity_read ON public.chat_activity FOR SELECT TO authenticated
USING(public.can_read_chat_activity(conversation_id));
DROP POLICY IF EXISTS chat_activity_read_guard ON public.chat_activity;
CREATE POLICY chat_activity_read_guard ON public.chat_activity AS RESTRICTIVE FOR SELECT TO authenticated
USING(public.can_read_chat_activity(conversation_id) AND expires_at > statement_timestamp());
-- Even an accidental future direct write grant + permissive policy cannot forge activity.
DROP POLICY IF EXISTS chat_activity_insert_guard ON public.chat_activity;
CREATE POLICY chat_activity_insert_guard ON public.chat_activity AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(false);
DROP POLICY IF EXISTS chat_activity_update_guard ON public.chat_activity;
CREATE POLICY chat_activity_update_guard ON public.chat_activity AS RESTRICTIVE FOR UPDATE TO authenticated USING(false) WITH CHECK(false);
DROP POLICY IF EXISTS chat_activity_delete_guard ON public.chat_activity;
CREATE POLICY chat_activity_delete_guard ON public.chat_activity AS RESTRICTIVE FOR DELETE TO authenticated USING(false);
DROP POLICY IF EXISTS chat_activity_anon_guard ON public.chat_activity;
CREATE POLICY chat_activity_anon_guard ON public.chat_activity AS RESTRICTIVE FOR ALL TO anon USING(false) WITH CHECK(false);

CREATE OR REPLACE FUNCTION chat_activity_private.publish(
 p_conversation_id uuid,p_source_id uuid,p_sequence bigint,p_event text,
 p_kind text,p_stage text,p_plural boolean,p_active boolean)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_now timestamptz := clock_timestamp(); v_count integer;
BEGIN
 IF NOT chat_activity_private.can_use(p_conversation_id,true) THEN
  RAISE EXCEPTION 'Activity unavailable' USING ERRCODE='42501';
 END IF;
 IF p_source_id IS NULL OR p_sequence IS NULL OR p_sequence NOT BETWEEN 1 AND 9007199254740991 OR
    p_event IS NULL OR p_event NOT IN ('typing','activity') OR p_active IS NULL OR p_plural IS NULL OR
    (p_event='typing' AND (p_kind IS NOT NULL OR p_stage IS NOT NULL)) OR
    (p_event='activity' AND p_active AND (p_kind IS NULL OR p_kind NOT IN ('recording','photo','video','media'))) OR
    (p_kind IS NOT NULL AND p_kind NOT IN ('recording','photo','video','media')) OR
    (p_stage IS NOT NULL AND p_stage NOT IN ('preparing','uploading')) THEN
  RAISE EXCEPTION 'Invalid activity' USING ERRCODE='22023';
 END IF;
 -- Serialize one user's source quota/cleanup without locking conversation membership.
 PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 41617));
 IF NOT chat_activity_private.can_use(p_conversation_id,true) THEN
  RAISE EXCEPTION 'Activity unavailable' USING ERRCODE='42501';
 END IF;
 DELETE FROM public.chat_activity WHERE user_id=v_uid AND expires_at < v_now - interval '1 minute';
 IF NOT EXISTS(SELECT 1 FROM public.chat_activity WHERE conversation_id=p_conversation_id AND user_id=v_uid AND source_id=p_source_id AND event=p_event)
    AND (SELECT count(*) FROM public.chat_activity WHERE user_id=v_uid) >= 128 THEN
  RAISE EXCEPTION 'Activity source limit' USING ERRCODE='54000';
 END IF;
 INSERT INTO public.chat_activity(conversation_id,user_id,source_id,event,kind,stage,plural,active,sequence,updated_at,expires_at)
 VALUES(p_conversation_id,v_uid,p_source_id,p_event,p_kind,p_stage,p_plural,p_active,p_sequence,v_now,
        v_now + CASE WHEN p_event='typing' THEN interval '4 seconds' ELSE interval '7 seconds' END)
 ON CONFLICT(conversation_id,user_id,source_id,event) DO UPDATE
 SET kind=excluded.kind,stage=excluded.stage,plural=excluded.plural,active=excluded.active,
     sequence=excluded.sequence,updated_at=excluded.updated_at,expires_at=excluded.expires_at
 WHERE public.chat_activity.sequence < excluded.sequence;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count=1;
END;
$function$;
REVOKE ALL ON FUNCTION chat_activity_private.publish(uuid,uuid,bigint,text,text,text,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION chat_activity_private.publish(uuid,uuid,bigint,text,text,text,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_chat_activity(
 p_conversation_id uuid,p_source_id uuid,p_sequence bigint,p_event text,
 p_kind text DEFAULT NULL,p_stage text DEFAULT NULL,p_plural boolean DEFAULT false,p_active boolean DEFAULT true)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=''
AS $function$
 SELECT chat_activity_private.publish(p_conversation_id,p_source_id,p_sequence,p_event,p_kind,p_stage,p_plural,p_active);
$function$;
REVOKE ALL ON FUNCTION public.publish_chat_activity(uuid,uuid,bigint,text,text,text,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_chat_activity(uuid,uuid,bigint,text,text,text,boolean,boolean) TO authenticated;

-- An authorized snapshot restores state after reconnect; table RLS also applies to direct REST.
CREATE OR REPLACE FUNCTION public.get_chat_activity(p_conversation_id uuid)
RETURNS SETOF public.chat_activity LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $function$
BEGIN
 IF NOT public.can_read_chat_activity(p_conversation_id) THEN
  RAISE EXCEPTION 'Activity unavailable' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT a.* FROM public.chat_activity a WHERE a.conversation_id=p_conversation_id
  AND a.active AND a.expires_at > statement_timestamp();
END;
$function$;
REVOKE ALL ON FUNCTION public.get_chat_activity(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_activity(uuid) TO authenticated;

DO $publication$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND puballtables)
    AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='chat_activity') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_activity;
 END IF;
END
$publication$;

-- No server activity uses Broadcast. Deny both directions on the obsolete namespace,
-- even if another permissive policy is installed. A public topic may still join;
-- the new client listens only to RLS-filtered postgres_changes, NEVER Broadcast.
DROP POLICY IF EXISTS chat_activity_receive ON realtime.messages;
DROP POLICY IF EXISTS chat_activity_send ON realtime.messages;
DROP POLICY IF EXISTS chat_activity_receive_guard ON realtime.messages;
DROP POLICY IF EXISTS chat_activity_send_guard ON realtime.messages;
DROP POLICY IF EXISTS chat_activity_anon_guard ON realtime.messages;
CREATE POLICY chat_activity_receive_guard ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING(coalesce((SELECT realtime.topic()),'') NOT LIKE 'chat-activity:%');
CREATE POLICY chat_activity_send_guard ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon,authenticated
WITH CHECK(coalesce((SELECT realtime.topic()),'') NOT LIKE 'chat-activity:%');
-- Keep the approved legacy function name fail-closed; it no longer authorizes Broadcast.
CREATE OR REPLACE FUNCTION public.can_use_chat_activity(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $function$ SELECT false; $function$;
REVOKE ALL ON FUNCTION public.can_use_chat_activity(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_chat_activity(text) TO authenticated;
-- Private join is an admission check only. Postgres Changes still checks row RLS
-- for every event after admission, so a cached join does not preserve data access.
CREATE OR REPLACE FUNCTION public.can_join_chat_activity(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $function$
 SELECT CASE WHEN p_topic ~ '^chat-activity-db:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  THEN public.can_read_chat_activity(substr(p_topic,18)::uuid) ELSE false END;
$function$;
REVOKE ALL ON FUNCTION public.can_join_chat_activity(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_join_chat_activity(text) TO authenticated;
DROP POLICY IF EXISTS chat_activity_db_join ON realtime.messages;
CREATE POLICY chat_activity_db_join ON realtime.messages FOR SELECT TO authenticated
USING(extension='broadcast' AND public.can_join_chat_activity((SELECT realtime.topic())));
DROP POLICY IF EXISTS chat_activity_db_receive_guard ON realtime.messages;
CREATE POLICY chat_activity_db_receive_guard ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated
USING(coalesce((SELECT realtime.topic()),'') NOT LIKE 'chat-activity-db:%' OR
      (extension='broadcast' AND public.can_join_chat_activity((SELECT realtime.topic()))));
DROP POLICY IF EXISTS chat_activity_db_send_guard ON realtime.messages;
CREATE POLICY chat_activity_db_send_guard ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon,authenticated
WITH CHECK(coalesce((SELECT realtime.topic()),'') NOT LIKE 'chat-activity-db:%');
DROP POLICY IF EXISTS chat_activity_db_anon_guard ON realtime.messages;
CREATE POLICY chat_activity_db_anon_guard ON realtime.messages AS RESTRICTIVE FOR ALL TO anon
USING(coalesce((SELECT realtime.topic()),'') NOT LIKE 'chat-activity-db:%')
WITH CHECK(coalesce((SELECT realtime.topic()),'') NOT LIKE 'chat-activity-db:%');

NOTIFY pgrst,'reload schema';
COMMIT;
