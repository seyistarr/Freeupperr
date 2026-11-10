-- SYNTHETIC TEST DATABASE ONLY. Never run against FreeUpper production.
-- Invoked on an empty PostgreSQL instance before proposed-private-view-once.sql.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
create table public.conversations (
 id uuid primary key, user1_id uuid, user2_id uuid,
 is_group boolean default false, is_note boolean default false,
 owner_id uuid, disappearing_duration integer,
 last_message_id uuid,last_message_at timestamptz,last_sender_id uuid,
 updated_at timestamptz default now()
);
create table public.conversation_members(
 conversation_id uuid,user_id uuid,role text
);
create table public.messages(
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id),
 sender_id uuid not null references auth.users(id),
 text text, message_type text default 'text', media_url text, media_urls text[],
 metadata jsonb default '{}'::jsonb,
 created_at timestamptz default now(),
 expires_at timestamptz,deleted_at timestamptz
);
create table public.view_once_consumptions (
 message_id uuid references public.messages(id) on delete cascade,
 viewer_id uuid references auth.users(id),
 media_index integer not null check(media_index>=0),
 opened_at timestamptz default now(),
 expires_at timestamptz default now()+interval '30 seconds',
 primary key(message_id,viewer_id,media_index)
);
alter table public.view_once_consumptions enable row level security;
grant usage on schema auth to authenticated;
grant usage on schema public to authenticated,anon,service_role;
grant select on public.view_once_consumptions to authenticated;
create or replace function public.is_blocked_between(a uuid,b uuid) returns boolean
language sql stable as $$select false$$;
create table public.synthetic_message_notifications (
 message_id uuid primary key, noted_at timestamptz default now()
);
create or replace function public.test_message_notify() returns trigger
language plpgsql as $$
begin
  insert into public.synthetic_message_notifications(message_id) values(new.id);
  return new;
end $$;
create trigger trg_notify_new_message after insert on public.messages
for each row execute function public.test_message_notify();
create or replace function public.test_last_message() returns trigger
language plpgsql as $$
begin
  update public.conversations set last_message_id=new.id,
   last_message_at=new.created_at,last_sender_id=new.sender_id,
   updated_at=new.created_at where id=new.conversation_id;
  return new;
end $$;
create trigger trigger_update_conversation_last_message after insert on public.messages
for each row execute function public.test_last_message();
create or replace function public.test_expiry() returns trigger
language plpgsql as $$
declare duration int;
begin
 select disappearing_duration into duration from public.conversations where id=new.conversation_id;
 if duration > 0 then new.expires_at:=now()+make_interval(secs=>duration); end if;
 return new;
end $$;
create trigger trg_set_message_expiry before insert on public.messages
for each row execute function public.test_expiry();
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000003');
insert into public.conversations(id,user1_id,user2_id,disappearing_duration) values
 ('11111111-1111-4111-8111-111111111111',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',60);
