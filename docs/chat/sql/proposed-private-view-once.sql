-- REVIEW ONLY — NOT APPLIED TO PRODUCTION.
-- Private, server-registered view-once media. Legacy view-once rows are untouched.
begin;
create schema if not exists chat_private;
revoke all on schema chat_private from public, anon, authenticated;

create table if not exists chat_private.view_once_assets (
  id uuid primary key default gen_random_uuid(),
  message_id uuid unique references public.messages(id) on delete set null,
  uploader_id uuid references auth.users(id) on delete set null,
  cloudinary_asset_id text not null unique,
  cloudinary_public_id text not null,
  resource_type text not null check (resource_type in ('image','video')),
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  created_at timestamptz not null default now(),
  cleanup_after timestamptz not null default (now() + interval '7 days'),
  deleted_at timestamptz,
  cleanup_attempts integer not null default 0,
  cleanup_last_error text,
  cleanup_locked_until timestamptz
);
create index if not exists view_once_assets_cleanup_idx on chat_private.view_once_assets(cleanup_after)
  where deleted_at is null;
-- Rows survive message deletion with message_id set null, so cleanup can still delete Cloudinary files.
create index if not exists view_once_assets_asset_id_idx on chat_private.view_once_assets(cloudinary_asset_id);
revoke all on all tables in schema chat_private from public,anon,authenticated;

-- Service-role Edge Function publishes only AFTER Cloudinary successfully uploads.
-- A message and its asset register in ONE transaction.
create or replace function public.chat_publish_private_view_once(
  p_conversation_id uuid, p_sender uuid, p_caption text,
  p_asset_id text, p_public_id text, p_kind text, p_mime text, p_bytes bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype; new_message_id uuid;
begin
  if p_sender is null or p_conversation_id is null or
      p_asset_id is null or length(p_asset_id) not between 8 and 255 or
      p_public_id is null or length(p_public_id) not between 3 and 255 or
      p_kind not in ('image','video') or
      p_mime not in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm') or
      p_bytes not between 1 and 10485760 or length(coalesce(p_caption,'')) > 2000 then
    raise exception 'Invalid private upload' using errcode='22023';
  end if;
  select * into c from public.conversations where id=p_conversation_id;
  if not found or coalesce(c.is_note,false) then
    raise exception 'Conversation unavailable' using errcode='42501';
  end if;
  -- First private-media canary is DM-only. Group permission RPCs rely on
  -- auth.uid() and must not be bypassed by the service-role publisher.
  if coalesce(c.is_group,false) or
     (p_sender is distinct from c.user1_id and p_sender is distinct from c.user2_id) or
     public.is_blocked_between(c.user1_id,c.user2_id) then
    raise exception 'Private DM sending unavailable' using errcode='42501';
  end if;
  insert into public.messages (
    conversation_id,sender_id,text,message_type,media_url,media_urls,metadata
  ) values (
    c.id,p_sender,coalesce(p_caption,''),'media',null,null,
    jsonb_build_object('view_once',true,'private_asset',true,
      'media_items',jsonb_build_array(jsonb_build_object('type',p_kind)))
  ) returning id into new_message_id;
  insert into chat_private.view_once_assets (
    message_id,uploader_id,cloudinary_asset_id,cloudinary_public_id,
    resource_type,mime_type,byte_size
  ) values (new_message_id,p_sender,p_asset_id,p_public_id,p_kind,p_mime,p_bytes);
  return new_message_id;
end $$;
revoke all on function public.chat_publish_private_view_once(uuid,uuid,text,text,text,text,text,bigint)
 from public,anon,authenticated;
grant execute on function public.chat_publish_private_view_once(uuid,uuid,text,text,text,text,text,bigint)
 to service_role;

-- A private marker is not proof that an asset was registered. Reject direct
-- REST inserts that spoof private_asset=true without a matching server-only
-- registry entry. The constraint trigger runs at transaction end, after the
-- atomic publisher has inserted BOTH records.
create or replace function chat_private.enforce_registered_private_message()
returns trigger language plpgsql security definer set search_path = '' as $
begin
  if not exists (
    select 1 from chat_private.view_once_assets a
    where a.message_id = new.id and a.deleted_at is null
      and a.uploader_id = new.sender_id
  ) then
    raise exception 'Private view-once asset has not been registered'
      using errcode='23514';
  end if;
  if new.message_type <> 'media' or
     new.metadata->>'view_once' is distinct from 'true' or
     new.media_url is not null or new.media_urls is not null or
     jsonb_typeof(new.metadata->'media_items') is distinct from 'array' or
     jsonb_array_length(new.metadata->'media_items') <> 1 then
    raise exception 'Invalid private view-once media contract'
      using errcode='23514';
  end if;
  return null;
end $;
revoke all on function chat_private.enforce_registered_private_message()
  from public,anon,authenticated;

drop trigger if exists chat_private_asset_registered on public.messages;
create constraint trigger chat_private_asset_registered
after insert or update on public.messages
deferrable initially deferred for each row
when ((new.metadata->>'private_asset') = 'true')
execute function chat_private.enforce_registered_private_message();

-- Once private asset metadata exists, neither sender nor recipient may
-- remove its marker, change asset identity, or attach a public media URL.
-- Caption edits and ordinary message deletion remain supported.
create or replace function chat_private.guard_private_message_update()
returns trigger language plpgsql security definer set search_path = '' as $
begin
  if old.metadata->>'private_asset' = 'true' and (
     new.metadata is distinct from old.metadata or
     new.sender_id is distinct from old.sender_id or
     new.conversation_id is distinct from old.conversation_id or
     new.media_url is distinct from old.media_url or
     new.media_urls is distinct from old.media_urls or
     new.message_type is distinct from old.message_type
  ) then
    raise exception 'Private view-once message fields are immutable'
      using errcode='42501';
  end if;
  return new;
end $;
revoke all on function chat_private.guard_private_message_update()
  from public,anon,authenticated;

drop trigger if exists chat_private_message_update_guard on public.messages;
create trigger chat_private_message_update_guard
before update on public.messages for each row
execute function chat_private.guard_private_message_update();

-- One-time consumption remains owned by the EXISTING public.claim_view_once
-- RPC, invoked with the verified recipient's JWT after private media is buffered.
-- Do not implement a competing claim/unclaim RPC.

-- Non-consuming authorization check before opening an upstream Cloudinary connection.
-- Caller is trusted ONLY because EXECUTE is restricted to service_role.
create or replace function public.chat_check_private_asset(p_viewer uuid,p_message_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; m record; c record;
begin
  select a.cloudinary_asset_id,a.resource_type,a.mime_type into a
    from chat_private.view_once_assets a
    where a.message_id=p_message_id and a.deleted_at is null and a.cleanup_after > now();
  if not found then return jsonb_build_object('status','not_found'); end if;
  select m.sender_id,m.conversation_id,m.deleted_at,m.expires_at into m
    from public.messages m where m.id=p_message_id and m.metadata->>'view_once'='true';
  if not found or m.sender_id=p_viewer or m.deleted_at is not null
     or (m.expires_at is not null and m.expires_at<=now()) then
    return jsonb_build_object('status','forbidden');
  end if;
  select c.* into c from public.conversations c where c.id=m.conversation_id;
  if not found or coalesce(c.is_note,false) then return jsonb_build_object('status','forbidden'); end if;
  if coalesce(c.is_group,false) then
    if not exists(select 1 from public.conversation_members cm
                  where cm.conversation_id=c.id and cm.user_id=p_viewer) then
      return jsonb_build_object('status','forbidden');
    end if;
  elsif p_viewer is distinct from c.user1_id and p_viewer is distinct from c.user2_id
      or public.is_blocked_between(c.user1_id,c.user2_id) then
    return jsonb_build_object('status','forbidden');
  end if;
  if exists(select 1 from public.view_once_consumptions v
            where v.message_id=p_message_id and v.media_index=0 and v.viewer_id=p_viewer) then
    return jsonb_build_object('status','already_viewed');
  end if;
  return jsonb_build_object('status','ok','asset_id',a.cloudinary_asset_id,
                            'resource_type',a.resource_type,'mime_type',a.mime_type);
end $$;
revoke all on function public.chat_check_private_asset(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_check_private_asset(uuid,uuid) to service_role;

-- Cleanup worker claims short leases to avoid multiple concurrent deletion attempts.
-- These RPCs are service_role-only; never grant to authenticated or anon.
create or replace function public.chat_claim_private_cleanup_batch(p_limit int default 25)
returns table(asset_id text, public_id text, kind text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid batch limit' using errcode='22023';
  end if;
  return query
  with due as (
    select a.id from chat_private.view_once_assets a
    where a.deleted_at is null
      and (a.message_id is null or a.cleanup_after <= now())
      and (a.cleanup_locked_until is null or a.cleanup_locked_until < now())
    order by a.cleanup_after asc
    limit p_limit
    for update skip locked
  ), claimed as (
    update chat_private.view_once_assets a set
      cleanup_attempts = a.cleanup_attempts + 1,
      cleanup_locked_until = now() + interval '3 minutes'
    from due where a.id=due.id
    returning a.cloudinary_asset_id,a.cloudinary_public_id,a.resource_type
  )
  select c.cloudinary_asset_id,c.cloudinary_public_id,c.resource_type from claimed c;
end $$;
revoke all on function public.chat_claim_private_cleanup_batch(int) from public,anon,authenticated;
grant execute on function public.chat_claim_private_cleanup_batch(int) to service_role;

create or replace function public.chat_finish_private_cleanup(
  p_asset_id text,p_success boolean,p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare affected int;
begin
  update chat_private.view_once_assets a
    set deleted_at = case when p_success then now() else a.deleted_at end,
        cleanup_last_error = case when p_success then null else left(coalesce(p_error,'Delete failed'),512) end,
        cleanup_locked_until = case when p_success then null else now()+interval '5 minutes' end
    where a.cloudinary_asset_id = p_asset_id and a.deleted_at is null;
  get diagnostics affected = row_count;
  return affected=1;
end $$;
revoke all on function public.chat_finish_private_cleanup(text,boolean,text) from public,anon,authenticated;
grant execute on function public.chat_finish_private_cleanup(text,boolean,text) to service_role;

-- Existing RLS table has SELECT grant but no SELECT policy as of 2026-11-10.
-- Restrict consumption reads to the authenticated viewer only. The existing
-- SECURITY DEFINER claim_view_once function handles writes/authorization.
drop policy if exists "chat_viewer_can_read_own_consumptions"
  on public.view_once_consumptions;
create policy "chat_viewer_can_read_own_consumptions"
  on public.view_once_consumptions for select to authenticated
  using (viewer_id = (select auth.uid()));

commit;

-- Cleanup must be a separate durable scheduled job, only marking deleted_at
-- after Cloudinary confirms deletion. Never schedule it via waitUntil sleep.
-- REVIEW GATE: verify function owner, exposed schema grants, revocations,
-- record uniqueness and synthetic recipient/nonparticipant/replay tests.
