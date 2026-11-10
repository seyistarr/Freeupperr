-- REVIEW ONLY. Do not execute against production until RLS regression gate is approved.
-- FreeUpper message requests, additive preparation. This file intentionally does not
-- change existing messages or require the Cloudinary/view-once rollout.
begin;

alter table public.conversations
  add column if not exists request_status text not null default 'accepted',
  add column if not exists initiated_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.conversations'::regclass and conname='conversations_request_status_chk') then
    alter table public.conversations add constraint conversations_request_status_chk
      check (request_status in ('pending','accepted','ignored'));
  end if;
end $$;

create index if not exists conversations_request_status_idx
  on public.conversations(request_status) where request_status <> 'accepted';

-- On INSERT only, derive initiator from the JWT; never trust client-provided fields.
-- Existing group and personal note creation must remain unchanged.
create or replace function public.chat_initialize_dm_request()
returns trigger language plpgsql security definer
set search_path = '' as $$
declare
  mutual boolean;
begin
  if coalesce(new.is_group,false) or coalesce(new.is_note,false) then
    new.request_status := 'accepted';
    new.initiated_by := null;
    return new;
  end if;
  if auth.uid() is null then
    -- Service-created legacy conversations are accepted unless explicitly migrated.
    new.request_status := 'accepted';
    return new;
  end if;
  if new.user1_id is distinct from auth.uid()
     and new.user2_id is distinct from auth.uid() then
    raise exception 'Initiator must be a conversation participant' using errcode='42501';
  end if;
  new.initiated_by := auth.uid();
  select exists(
    select 1 from public.follows f
    where f.follower_id=new.user1_id and f.following_id=new.user2_id
  ) and exists(
    select 1 from public.follows f
    where f.follower_id=new.user2_id and f.following_id=new.user1_id
  ) into mutual;
  new.request_status := case when mutual then 'accepted' else 'pending' end;
  return new;
end $$;

drop trigger if exists trg_chat_initialize_dm_request on public.conversations;
create trigger trg_chat_initialize_dm_request before insert on public.conversations
for each row execute function public.chat_initialize_dm_request();

-- Enforce valid status transitions for direct REST updates AND calls via RPC.
-- Prevent changing the initiator or rewriting request state after ignoring.
create or replace function public.chat_guard_dm_request()
returns trigger language plpgsql security definer
set search_path = '' as $$
declare recipient uuid;
begin
  if new.initiated_by is distinct from old.initiated_by then
    raise exception 'Conversation initiator is immutable' using errcode='42501';
  end if;
  if new.request_status is not distinct from old.request_status then return new; end if;
  if coalesce(old.is_group,false) or coalesce(old.is_note,false)
     or old.request_status <> 'pending' or old.initiated_by is null then
    raise exception 'Invalid message request transition' using errcode='42501';
  end if;
  recipient := case when old.user1_id=old.initiated_by then old.user2_id
                    when old.user2_id=old.initiated_by then old.user1_id
                    else null end;
  if auth.uid() is distinct from recipient
     or new.request_status not in ('accepted','ignored') then
    raise exception 'Only the request recipient can accept or ignore'
      using errcode='42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_chat_guard_dm_request on public.conversations;
create trigger trg_chat_guard_dm_request before update on public.conversations
for each row execute function public.chat_guard_dm_request();

-- RPC uses the same existing UPDATE RLS and guard trigger; never bypasses recipient check.
create or replace function public.chat_respond_to_request(p_conversation_id uuid, p_action text)
returns text language plpgsql security invoker
set search_path = '' as $$
declare updated_status text;
begin
  if auth.uid() is null or p_action not in ('accepted','ignored') then
    raise exception 'Invalid request response' using errcode='42501';
  end if;
  update public.conversations c
     set request_status=p_action
   where c.id=p_conversation_id
     and coalesce(c.is_group,false)=false
     and coalesce(c.is_note,false)=false
     and c.request_status='pending'
     and c.initiated_by is distinct from auth.uid()
     and c.initiated_by is not null
     and auth.uid() in (c.user1_id,c.user2_id)
  returning c.request_status into updated_status;
  if updated_status is null then
    raise exception 'Request unavailable or already resolved' using errcode='42501';
  end if;
  return updated_status;
end $$;
revoke all on function public.chat_respond_to_request(uuid,text) from public,anon;
grant execute on function public.chat_respond_to_request(uuid,text) to authenticated;

-- Recipient's first reply accepts a pending direct-message request in the same transaction.
create or replace function public.chat_accept_request_on_reply()
returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  update public.conversations c set request_status='accepted'
   where c.id=new.conversation_id and c.request_status='pending'
     and coalesce(c.is_group,false)=false and coalesce(c.is_note,false)=false
     and c.initiated_by is distinct from new.sender_id
     and new.sender_id in (c.user1_id,c.user2_id)
     and auth.uid()=new.sender_id;
  return new;
end $$;
drop trigger if exists trg_chat_accept_request_on_reply on public.messages;
create trigger trg_chat_accept_request_on_reply after insert on public.messages
for each row execute function public.chat_accept_request_on_reply();

create or replace function public.get_group_member_counts(p_ids uuid[])
returns table(conversation_id uuid, member_count bigint)
language sql stable security definer set search_path = '' as $$
  select cm.conversation_id,count(*)::bigint
  from public.conversation_members cm
  where cm.conversation_id = any(p_ids)
    and coalesce(array_length(p_ids,1),0) between 1 and 100
    and exists (
      select 1 from public.conversation_members me
      where me.conversation_id=cm.conversation_id and me.user_id=auth.uid()
    )
  group by cm.conversation_id;
$$;
revoke all on function public.get_group_member_counts(uuid[]) from public,anon;
grant execute on function public.get_group_member_counts(uuid[]) to authenticated;

commit;

-- Important: this scoped migration DOES NOT fix legacy broad conversation UPDATE
-- grants or participant visibility. These must be audited and narrowed in the
-- next release gate. Do not ship independently before the RLS authorization matrix.
