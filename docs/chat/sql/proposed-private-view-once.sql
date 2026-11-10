-- REVIEW ONLY — NOT APPLIED TO PRODUCTION.
-- Private, server-registered view-once media. Legacy view-once rows are untouched.
begin;
create schema if not exists chat_private;
revoke all on schema chat_private from public, anon, authenticated;

create table if not exists chat_private.view_once_assets (
  message_id uuid primary key references public.messages(id) on delete cascade,
  uploader_id uuid not null references auth.users(id),
  cloudinary_asset_id text not null unique,
  cloudinary_public_id text not null,
  resource_type text not null check (resource_type in ('image','video')),
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  created_at timestamptz not null default now(),
  cleanup_after timestamptz not null default (now() + interval '7 days'),
  deleted_at timestamptz
);
create index if not exists view_once_assets_cleanup_idx on chat_private.view_once_assets(cleanup_after)
  where deleted_at is null;
revoke all on all tables in schema chat_private from public,anon,authenticated;

-- Only the Edge Function's service-role connection can register an upload.
create or replace function public.chat_register_private_asset(
  p_message_id uuid, p_sender uuid, p_asset_id text, p_public_id text,
  p_kind text, p_mime text, p_bytes bigint
) returns boolean language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  if p_asset_id is null or length(p_asset_id) not between 8 and 255
      or p_public_id is null or length(p_public_id) not between 3 and 255
      or p_kind not in ('image','video')
      or p_mime not in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm')
      or p_bytes not between 1 and 10485760 then
    raise exception 'Invalid registered asset' using errcode='22023';
  end if;
  select sender_id,metadata,media_url,media_urls into m
    from public.messages where id=p_message_id for update;
  if not found or m.sender_id is distinct from p_sender
     or m.metadata->>'view_once' is distinct from 'true'
     or m.media_url is not null or m.media_urls is not null then
    raise exception 'View-once message is not eligible' using errcode='42501';
  end if;
  insert into chat_private.view_once_assets (
    message_id,uploader_id,cloudinary_asset_id,cloudinary_public_id,
    resource_type,mime_type,byte_size
  ) values (p_message_id,p_sender,p_asset_id,p_public_id,p_kind,p_mime,p_bytes);
  return true;
end $$;
revoke all on function public.chat_register_private_asset(uuid,uuid,text,text,text,text,bigint)
  from public,anon,authenticated;
grant execute on function public.chat_register_private_asset(uuid,uuid,text,text,text,text,bigint)
  to service_role;

-- Claim only AFTER the private Cloudinary fetch returned a successful response.
-- The consumption row is never rolled back by another network call.
create or replace function public.chat_claim_private_asset(p_viewer uuid,p_message_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; m record; c record; claimed uuid;
begin
  if p_viewer is null then return jsonb_build_object('status','forbidden'); end if;
  select a.message_id,a.cloudinary_asset_id,a.resource_type,a.mime_type,
         a.cleanup_after,a.deleted_at
    into a from chat_private.view_once_assets a
    where a.message_id=p_message_id for update;
  if not found or a.deleted_at is not null or a.cleanup_after <= now() then
    return jsonb_build_object('status','not_found');
  end if;
  select m.id,m.sender_id,m.conversation_id,m.metadata,m.deleted_at,m.expires_at
    into m from public.messages m where m.id=p_message_id;
  if not found or m.sender_id=p_viewer or m.deleted_at is not null or
     (m.expires_at is not null and m.expires_at <= now()) or
     m.metadata->>'view_once' is distinct from 'true' then
    return jsonb_build_object('status','forbidden');
  end if;
  select c.id,c.is_group,c.is_note,c.owner_id,c.user1_id,c.user2_id
    into c from public.conversations c where c.id=m.conversation_id;
  if not found or coalesce(c.is_note,false) then
    return jsonb_build_object('status','forbidden');
  end if;
  if coalesce(c.is_group,false) then
    if not exists(select 1 from public.conversation_members cm
                  where cm.conversation_id=c.id and cm.user_id=p_viewer) then
      return jsonb_build_object('status','forbidden');
    end if;
  elsif p_viewer is distinct from c.user1_id and p_viewer is distinct from c.user2_id then
    return jsonb_build_object('status','forbidden');
  elsif public.is_blocked_between(c.user1_id,c.user2_id) then
    return jsonb_build_object('status','forbidden');
  end if;
  insert into public.view_once_consumptions(message_id,media_index,viewer_id)
    values(p_message_id,0,p_viewer) on conflict do nothing
    returning message_id into claimed;
  if claimed is null then return jsonb_build_object('status','already_viewed'); end if;
  if not coalesce(c.is_group,false) then
    update chat_private.view_once_assets set cleanup_after=least(cleanup_after,now()+interval '2 minutes')
      where message_id=p_message_id;
  end if;
  return jsonb_build_object('status','ok');
end $$;
revoke all on function public.chat_claim_private_asset(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_claim_private_asset(uuid,uuid) to service_role;

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
commit;

-- Cleanup must be a separate durable scheduled job, only marking deleted_at
-- after Cloudinary confirms deletion. Never schedule it via waitUntil sleep.
-- REVIEW GATE: verify function owner, exposed schema grants, revocations,
-- record uniqueness and synthetic recipient/nonparticipant/replay tests.
