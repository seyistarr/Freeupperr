-- Synthetic PostgreSQL-only preflight. Run against a NEW disposable database,
-- never against FreeUpper production or a connected Supabase project.
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable
  as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.conversations(
  id uuid primary key, user1_id uuid, user2_id uuid,
  is_group boolean default false, is_note boolean default false,
  owner_id uuid
);
create table public.conversation_members(conversation_id uuid,user_id uuid);
create table public.messages(
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id),
  sender_id uuid not null,
  text text,
  message_type text,
  media_url text,
  media_urls text[],
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  expires_at timestamptz
);
create table public.view_once_consumptions(
  message_id uuid references public.messages(id) on delete cascade,
  viewer_id uuid not null,
  media_index integer not null,
  primary key(message_id,viewer_id,media_index)
);
alter table public.view_once_consumptions enable row level security;
grant select on public.view_once_consumptions to authenticated;
create function public.is_blocked_between(uuid,uuid) returns boolean
  language sql stable as $$select false$$;

-- Synthetic AFTER INSERT side-effect, representative of the live notification
-- trigger. Rollback must also roll back this transactional audit record.
create table public.test_notifications(message_id uuid);
create function public.test_notify_message() returns trigger language plpgsql as $$
begin
  insert into public.test_notifications values(new.id);
  return new;
end $$;
create trigger test_notify_message after insert on public.messages
  for each row execute function public.test_notify_message();

\i docs/chat/sql/proposed-private-view-once.sql

insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333');
insert into public.conversations(id,user1_id,user2_id) values (
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222'
);

-- Authorized sender publishes once; the deferred private-asset constraint
-- succeeds only because publisher also registered the asset.
select public.chat_publish_private_view_once(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 'Private test caption','asset-00000001','freeupper-chat-viewonce/first',
 'image','image/jpeg',125
);
do $$
begin
  if (select count(*) from public.messages) <> 1 then
    raise exception 'Expected one published message';
  end if;
  if (select count(*) from public.test_notifications) <> 1 then
    raise exception 'Expected one notification side-effect';
  end if;
  if (select count(*) from chat_private.view_once_assets) <> 1 then
    raise exception 'Expected one bound private asset';
  end if;
end $$;

-- A spoofed private marker without registration must fail, including when the
-- caller tries to force deferred constraints before transaction completion.
do $$
begin
  begin
    insert into public.messages(conversation_id,sender_id,message_type,metadata)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111','media',
      '{"view_once":true,"private_asset":true,"media_items":[{"type":"image"}]}'::jsonb
    );
    set constraints chat_private_asset_registered immediate;
    raise exception 'Expected forged private marker rejection';
  exception when check_violation then null;
  end;
  if (select count(*) from public.messages) <> 1 or
     (select count(*) from public.test_notifications) <> 1 then
    raise exception 'Spoof rollback leaked a message or notification';
  end if;
end $$;

-- Sender/asset identity must not be mutable post-publication; text editing
-- alone remains permitted.
do $$
declare v_id uuid;
begin
  select id into v_id from public.messages limit 1;
  begin
    update public.messages set metadata='{}'::jsonb where id=v_id;
    raise exception 'Expected metadata immutability rejection';
  exception when insufficient_privilege then null;
  end;
  update public.messages set text='Edited caption' where id=v_id;
  if (select text from public.messages where id=v_id) <> 'Edited caption' then
    raise exception 'Caption editing broken';
  end if;
end $$;

-- Service RPC still denies nonmembers and group conversations.
do $$
begin
  begin
    perform public.chat_publish_private_view_once(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33333333-3333-4333-8333-333333333333',
      'forbidden','asset-00000002','freeupper-chat-viewonce/second',
      'image','image/jpeg',125
    );
    raise exception 'Expected nonparticipant rejection';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.messages) <> 1 or
     (select count(*) from public.test_notifications) <> 1 then
    raise exception 'Denied publish changed message or notification counts';
  end if;
end $$;

-- Asset ID duplication must roll back both message and notification.
do $$
begin
  begin
    perform public.chat_publish_private_view_once(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'duplicate asset','asset-00000001','freeupper-chat-viewonce/third',
      'image','image/jpeg',125
    );
    raise exception 'Expected duplicate-asset rejection';
  exception when unique_violation then null;
  end;
  if (select count(*) from public.messages) <> 1 or
     (select count(*) from public.test_notifications) <> 1 then
    raise exception 'Failed publish leaked message or notification';
  end if;
end $$;

-- Viewer-only read policy: recipient can see consumption, stranger cannot.
insert into public.view_once_consumptions(message_id,viewer_id,media_index)
select id,'22222222-2222-4222-8222-222222222222',0 from public.messages limit 1;
grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
begin
  if (select count(*) from public.view_once_consumptions) <> 1 then
    raise exception 'Recipient should see their own consumption';
  end if;
end $$;
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if (select count(*) from public.view_once_consumptions) <> 0 then
    raise exception 'Stranger must not see recipient consumption';
  end if;
end $$;
reset role;
select 'synthetic private-view-once PostgreSQL tests passed' as result;
