-- SYNTHETIC TEST ONLY. Run after chat-private-bootstrap.sql and proposed-private-view-once.sql.
-- psql --set=ON_ERROR_STOP=1 fails CI immediately on unexpected SQL errors.
do $$
declare
  msg uuid;
  owner uuid:='00000000-0000-4000-8000-000000000001';
  peer uuid:='00000000-0000-4000-8000-000000000002';
  outsider uuid:='00000000-0000-4000-8000-000000000003';
  chat_id uuid:='11111111-1111-4111-8111-111111111111';
  found_count integer;
begin
  -- An unauthorized actor cannot publish on a DM they do not belong to.
  begin
    perform public.chat_publish_private_view_once(chat_id,outsider,'forbidden',
      'asset-outsider-001','folder/outside','image','image/jpeg',48);
    raise exception 'Unauthorized publisher was accepted';
  exception when sqlstate '42501' then null;
  end;
  select count(*) into found_count from public.messages;
  if found_count <> 0 then raise exception 'Unauthorized publish created a message'; end if;

  -- Publication inserts the message, protected asset, notifications and preview
  -- together, without a publicly accessible URL.
  msg := public.chat_publish_private_view_once(chat_id,owner,'protected image',
    'asset-private-001','folder/private','image','image/jpeg',48);
  if msg is null then raise exception 'No message returned'; end if;
  if not exists(select 1 from public.messages m
      join chat_private.view_once_assets a on a.message_id=m.id
      where m.id=msg and m.media_url is null and m.media_urls is null and
            m.metadata->>'view_once'='true' and m.metadata->>'private_asset'='true')
  then raise exception 'Published asset and message do not match'; end if;
  if not exists(select 1 from public.synthetic_message_notifications where message_id=msg)
  then raise exception 'Notification trigger did not run'; end if;
  if not exists(select 1 from public.conversations where id=chat_id and last_message_id=msg)
  then raise exception 'Conversation last-message trigger did not run'; end if;
  if not exists(select 1 from public.messages where id=msg and expires_at > now())
  then raise exception 'Message expiry trigger did not run'; end if;

  -- Immutable private metadata prevents changing delivery from private to public.
  begin
    update public.messages set media_url='https://example.invalid/leak.jpg' where id=msg;
    raise exception 'Private media URL mutation was accepted';
  exception when sqlstate '42501' then null;
  end;

  -- A direct private-marked insert must fail the deferred constraint.
  begin
    insert into public.messages(conversation_id,sender_id,message_type,metadata)
      values(chat_id,owner,'media',
        '{"view_once":true,"private_asset":true,"media_items":[{"type":"image"}]}'::jsonb);
    set constraints chat_private_asset_registered immediate;
    raise exception 'Forged private message was accepted';
  exception when sqlstate '23514' then null;
  end;

  -- Duplicate Cloudinary asset must rollback its entire transaction.
  begin
    perform public.chat_publish_private_view_once(chat_id,owner,'duplicate',
      'asset-private-001','folder/duplicate','image','image/jpeg',48);
    raise exception 'Duplicate asset unexpectedly accepted';
  exception when unique_violation then null;
  end;
  select count(*) into found_count from public.messages;
  if found_count<>1 then raise exception 'Failed publication left a message behind'; end if;
  if not exists(select 1 from public.view_once_consumptions v
      where false) then null; end if;
  raise notice 'PASS: synthetic publishing, triggers, rollback and immutability';
end $$;

-- Test deletion and orphan cleanup persistence.
do $$
declare msg uuid;
begin
 select message_id into msg from chat_private.view_once_assets where cloudinary_asset_id='asset-private-001';
 delete from public.messages where id=msg;
 if not exists(select 1 from chat_private.view_once_assets
      where cloudinary_asset_id='asset-private-001' and message_id is null)
 then raise exception 'Deletion orphaned private Cloudinary asset registry'; end if;
end $$;
