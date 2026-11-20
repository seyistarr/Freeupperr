-- REVIEW ONLY. Requires 20261116172043_chat_activity_authorization first.
-- Changes authorization only; no historical message/receipt/member rows are rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF to_regprocedure('chat_activity_private.can_use(uuid,boolean)') IS NULL OR
    to_regclass('public.message_reads') IS NULL OR to_regclass('public.group_join_requests') IS NULL OR
    NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.message_reads'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'Expected activity hardening and existing receipt RLS';
 END IF;
END $preflight$;

-- Internal lookup avoids legacy receipt/message RLS recursion. The actor is JWT-derived.
CREATE OR REPLACE FUNCTION chat_activity_private.can_read_receipt(p_message_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
  WHERE m.id=p_message_id AND CASE
   WHEN coalesce(c.is_note,false) THEN c.owner_id=auth.uid()
   WHEN coalesce(c.is_group,false) THEN EXISTS(
    SELECT 1 FROM public.conversation_members cm WHERE cm.conversation_id=c.id AND cm.user_id=auth.uid())
   ELSE (c.user1_id=auth.uid() OR c.user2_id=auth.uid())
    AND NOT public.is_blocked_between(c.user1_id,c.user2_id) END
 );
$function$;
REVOKE ALL ON FUNCTION chat_activity_private.can_read_receipt(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION chat_activity_private.can_read_receipt(uuid) TO authenticated;

DROP POLICY IF EXISTS "members can view reads" ON public.message_reads;
CREATE POLICY "members can view reads" ON public.message_reads FOR SELECT TO authenticated
USING(chat_activity_private.can_read_receipt(message_id));
DROP POLICY IF EXISTS reads_insert_policy ON public.message_reads;
CREATE POLICY reads_insert_policy ON public.message_reads FOR INSERT TO authenticated
WITH CHECK(user_id=auth.uid() AND chat_activity_private.can_read_receipt(message_id));
-- The existing client upserts; permit its own authorized conflict update, including concurrent tabs.
DROP POLICY IF EXISTS chat_reads_update ON public.message_reads;
CREATE POLICY chat_reads_update ON public.message_reads FOR UPDATE TO authenticated
USING(user_id=auth.uid() AND chat_activity_private.can_read_receipt(message_id))
WITH CHECK(user_id=auth.uid() AND chat_activity_private.can_read_receipt(message_id));
DROP POLICY IF EXISTS chat_reads_select_guard ON public.message_reads;
CREATE POLICY chat_reads_select_guard ON public.message_reads AS RESTRICTIVE FOR SELECT TO authenticated
USING(chat_activity_private.can_read_receipt(message_id));
DROP POLICY IF EXISTS chat_reads_insert_guard ON public.message_reads;
CREATE POLICY chat_reads_insert_guard ON public.message_reads AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK(user_id=auth.uid() AND chat_activity_private.can_read_receipt(message_id));
DROP POLICY IF EXISTS chat_reads_update_guard ON public.message_reads;
CREATE POLICY chat_reads_update_guard ON public.message_reads AS RESTRICTIVE FOR UPDATE TO authenticated
USING(user_id=auth.uid() AND chat_activity_private.can_read_receipt(message_id))
WITH CHECK(user_id=auth.uid() AND chat_activity_private.can_read_receipt(message_id));
DROP POLICY IF EXISTS chat_reads_delete_guard ON public.message_reads;
CREATE POLICY chat_reads_delete_guard ON public.message_reads AS RESTRICTIVE FOR DELETE TO authenticated USING(false);
DROP POLICY IF EXISTS chat_reads_anon_guard ON public.message_reads;
CREATE POLICY chat_reads_anon_guard ON public.message_reads AS RESTRICTIVE FOR ALL TO anon USING(false) WITH CHECK(false);
GRANT SELECT,INSERT,UPDATE ON public.message_reads TO authenticated;

CREATE OR REPLACE FUNCTION chat_activity_private.protect_receipt_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
BEGIN
 IF current_user IN ('anon','authenticated') THEN
  IF TG_OP='UPDATE' THEN
   IF ROW(NEW.message_id,NEW.user_id) IS DISTINCT FROM ROW(OLD.message_id,OLD.user_id) THEN
    RAISE EXCEPTION 'Receipt identity is immutable' USING ERRCODE='42501';
   END IF;
   NEW.read_at := coalesce(OLD.read_at,statement_timestamp());
  ELSE NEW.read_at := statement_timestamp();
  END IF;
 END IF;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION chat_activity_private.protect_receipt_identity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS chat_protect_receipt_identity ON public.message_reads;
CREATE TRIGGER chat_protect_receipt_identity BEFORE INSERT OR UPDATE ON public.message_reads
FOR EACH ROW EXECUTE FUNCTION chat_activity_private.protect_receipt_identity();

-- Preserve existing RPC signatures while closing missing-permission defaults and PUBLIC execution.
CREATE OR REPLACE FUNCTION chat_activity_private.update_group_info(p_conversation_id uuid,p_name text,p_description text,p_avatar text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_role text; v_permission text;
BEGIN
 SELECT m.role,coalesce(c.permissions->>'edit_group_info','admins') INTO v_role,v_permission
 FROM public.conversation_members m JOIN public.conversations c ON c.id=m.conversation_id
 WHERE m.conversation_id=p_conversation_id AND m.user_id=auth.uid() AND c.is_group AND NOT coalesce(c.is_note,false) FOR UPDATE OF m;
 IF auth.uid() IS NULL OR v_role IS NULL OR (v_permission<>'everyone' AND v_role NOT IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Group edit not authorized' USING ERRCODE='42501';
 END IF;
 UPDATE public.conversations SET group_name=coalesce(p_name,group_name),group_description=coalesce(p_description,group_description),
 group_avatar=coalesce(p_avatar,group_avatar),updated_at=statement_timestamp() WHERE id=p_conversation_id;
END $function$;
REVOKE ALL ON FUNCTION chat_activity_private.update_group_info(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION chat_activity_private.update_group_info(uuid,text,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.update_group_info(p_conversation_id uuid,p_name text DEFAULT NULL,p_description text DEFAULT NULL,p_avatar text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT chat_activity_private.update_group_info(p_conversation_id,p_name,p_description,p_avatar); $function$;
REVOKE ALL ON FUNCTION public.update_group_info(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_group_info(uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION chat_activity_private.get_or_create_invite_code(p_conversation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_role text; v_permission text; v_code text;
BEGIN
 SELECT m.role,coalesce(c.permissions->>'invite_via_link','admins') INTO v_role,v_permission
 FROM public.conversation_members m JOIN public.conversations c ON c.id=m.conversation_id
 WHERE m.conversation_id=p_conversation_id AND m.user_id=auth.uid() AND c.is_group AND NOT coalesce(c.is_note,false) FOR UPDATE OF m;
 IF auth.uid() IS NULL OR v_role IS NULL OR (v_permission<>'everyone' AND v_role NOT IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Group invite not authorized' USING ERRCODE='42501';
 END IF;
 SELECT invite_code INTO v_code FROM public.conversations WHERE id=p_conversation_id FOR UPDATE;
 IF v_code IS NULL THEN
  v_code:=replace(gen_random_uuid()::text,'-','');
  UPDATE public.conversations SET invite_code=v_code WHERE id=p_conversation_id;
 END IF;
 RETURN v_code;
END $function$;
REVOKE ALL ON FUNCTION chat_activity_private.get_or_create_invite_code(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION chat_activity_private.get_or_create_invite_code(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_or_create_invite_code(p_conversation_id uuid)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT chat_activity_private.get_or_create_invite_code(p_conversation_id); $function$;
REVOKE ALL ON FUNCTION public.get_or_create_invite_code(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_invite_code(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION chat_activity_private.join_group_via_code(p_invite_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_id uuid; v_approval boolean; v_uid uuid:=auth.uid();
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT id,coalesce((permissions->>'approve_new_members')::boolean,false) INTO v_id,v_approval
 FROM public.conversations WHERE invite_code=p_invite_code AND invite_enabled=true AND is_group=true AND NOT coalesce(is_note,false) FOR UPDATE;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Invalid or expired invite link' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.conversation_members WHERE conversation_id=v_id AND user_id=v_uid) THEN
  RETURN jsonb_build_object('status','already_member','conversation_id',v_id);
 END IF;
 IF v_approval THEN
  INSERT INTO public.group_join_requests(conversation_id,user_id) VALUES(v_id,v_uid)
  ON CONFLICT(conversation_id,user_id) DO UPDATE SET status='pending',created_at=statement_timestamp();
  RETURN jsonb_build_object('status','pending_approval','conversation_id',v_id);
 END IF;
 INSERT INTO public.conversation_members(conversation_id,user_id,role) VALUES(v_id,v_uid,'member') ON CONFLICT(conversation_id,user_id) DO NOTHING;
 RETURN jsonb_build_object('status','joined','conversation_id',v_id);
END $function$;
REVOKE ALL ON FUNCTION chat_activity_private.join_group_via_code(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION chat_activity_private.join_group_via_code(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.join_group_via_code(p_invite_code text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT chat_activity_private.join_group_via_code(p_invite_code); $function$;
REVOKE ALL ON FUNCTION public.join_group_via_code(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.join_group_via_code(text) TO authenticated;

CREATE OR REPLACE FUNCTION chat_activity_private.resolve_join_request(p_request_id uuid,p_approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_conv uuid; v_user uuid; v_role text; v_status text;
BEGIN
 IF auth.uid() IS NULL OR p_approve IS NULL THEN RAISE EXCEPTION 'Invalid approval request' USING ERRCODE='42501'; END IF;
 SELECT conversation_id,user_id,status INTO v_conv,v_user,v_status FROM public.group_join_requests WHERE id=p_request_id FOR UPDATE;
 IF v_user IS NULL OR v_status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'No pending request' USING ERRCODE='42501'; END IF;
 SELECT m.role INTO v_role FROM public.conversation_members m JOIN public.conversations c ON c.id=m.conversation_id
 WHERE m.conversation_id=v_conv AND m.user_id=auth.uid() AND c.is_group=true AND NOT coalesce(c.is_note,false) FOR UPDATE OF m;
 IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Only current administrators can resolve requests' USING ERRCODE='42501'; END IF;
 IF p_approve THEN
  INSERT INTO public.conversation_members(conversation_id,user_id,role) VALUES(v_conv,v_user,'member') ON CONFLICT(conversation_id,user_id) DO NOTHING;
 END IF;
 UPDATE public.group_join_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END WHERE id=p_request_id;
END $function$;
REVOKE ALL ON FUNCTION chat_activity_private.resolve_join_request(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION chat_activity_private.resolve_join_request(uuid,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.resolve_join_request(p_request_id uuid,p_approve boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT chat_activity_private.resolve_join_request(p_request_id,p_approve); $function$;
REVOKE ALL ON FUNCTION public.resolve_join_request(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_join_request(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION chat_activity_private.protect_conversation_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; v_field text;
BEGIN
 -- Existing reviewed SECURITY DEFINER group-info/invite RPCs remain trusted operations.
 IF current_user NOT IN ('anon','authenticated') THEN RETURN NEW; END IF;
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF coalesce(OLD.is_note,false) THEN
  IF OLD.owner_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'Not note owner' USING ERRCODE='42501'; END IF;
 ELSIF coalesce(OLD.is_group,false) THEN
  SELECT role INTO v_role FROM public.conversation_members WHERE conversation_id=OLD.id AND user_id=v_uid;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Not a current group member' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT coalesce(v_uid=OLD.user1_id OR v_uid=OLD.user2_id,false) OR public.is_blocked_between(OLD.user1_id,OLD.user2_id) THEN
   RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='42501';
  END IF;
 END IF;
 IF ROW(NEW.id,NEW.created_at,NEW.user1_id,NEW.user2_id,NEW.is_group,NEW.is_note,NEW.owner_id,NEW.created_by,NEW.typing_users)
  IS DISTINCT FROM ROW(OLD.id,OLD.created_at,OLD.user1_id,OLD.user2_id,OLD.is_group,OLD.is_note,OLD.owner_id,OLD.created_by,OLD.typing_users) THEN
  RAISE EXCEPTION 'Protected conversation identity' USING ERRCODE='42501';
 END IF;
 IF NOT coalesce(OLD.is_note,false) AND
  ROW(NEW.permissions,NEW.invite_code,NEW.invite_enabled) IS DISTINCT FROM ROW(OLD.permissions,OLD.invite_code,OLD.invite_enabled)
  AND (NOT coalesce(OLD.is_group,false) OR v_role IS NULL OR v_role NOT IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Only current administrators can change group administration' USING ERRCODE='42501';
 END IF;
 IF coalesce(OLD.is_group,false) AND NOT coalesce(OLD.is_note,false) AND v_role NOT IN ('owner','admin') THEN
  IF NEW.disappearing_duration IS DISTINCT FROM OLD.disappearing_duration OR
   (coalesce(OLD.permissions->>'edit_group_info','admins') <> 'everyone' AND
    ROW(NEW.group_name,NEW.group_avatar,NEW.group_description) IS DISTINCT FROM ROW(OLD.group_name,OLD.group_avatar,OLD.group_description)) THEN
   RAISE EXCEPTION 'Group administrator permission required' USING ERRCODE='42501';
  END IF;
 END IF;
 -- A participant may change only their own per-user preference entries, not another user's state.
 FOREACH v_field IN ARRAY ARRAY['muted_by','archived_by','pinned_by','hidden_by'] LOOP
  IF ARRAY(SELECT value FROM jsonb_array_elements_text(coalesce(nullif(to_jsonb(NEW)->v_field,'null'::jsonb),'[]'::jsonb)) AS x(value) WHERE value<>v_uid::text ORDER BY value)
   IS DISTINCT FROM ARRAY(SELECT value FROM jsonb_array_elements_text(coalesce(nullif(to_jsonb(OLD)->v_field,'null'::jsonb),'[]'::jsonb)) AS x(value) WHERE value<>v_uid::text ORDER BY value) THEN
   RAISE EXCEPTION 'Cannot modify another participant preference' USING ERRCODE='42501';
  END IF;
 END LOOP;
 IF ROW(NEW.last_message_id,NEW.last_sender_id,NEW.last_message_at) IS DISTINCT FROM ROW(OLD.last_message_id,OLD.last_sender_id,OLD.last_message_at)
  AND pg_trigger_depth() < 2 THEN
  RAISE EXCEPTION 'Last message metadata is server maintained' USING ERRCODE='42501';
 END IF;
 IF NEW.pinned_message_id IS DISTINCT FROM OLD.pinned_message_id AND NEW.pinned_message_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.messages m WHERE m.id=NEW.pinned_message_id AND m.conversation_id=OLD.id) THEN
  RAISE EXCEPTION 'Pinned message must belong to this conversation' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION chat_activity_private.protect_conversation_metadata() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS chat_protect_conversation_metadata ON public.conversations;
CREATE TRIGGER chat_protect_conversation_metadata BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION chat_activity_private.protect_conversation_metadata();
NOTIFY pgrst,'reload schema';
COMMIT;
