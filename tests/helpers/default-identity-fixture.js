import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
export const migration=await readFile('supabase/migrations/20261109051236_default_profile_identity.sql','utf8');
export const fixture=`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table auth.users(id uuid primary key default gen_random_uuid(), email text,raw_user_meta_data jsonb default '{}',provider text,email_confirmed_at timestamptz default now());
create table profiles(id uuid primary key references auth.users(id),
 freeupper_id text unique default ('FU'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 username text unique,display_name text,display_username text,avatar_url text,cover_url text,bio text,
 verified boolean default false,verified_status text,verification_status text,is_private boolean default false,
 hide_follower_count boolean,activity_status boolean,country text,created_at timestamptz default now(),
 suspended boolean default false,onboarding_completed boolean default false,profile_setup_completed_at timestamptz);
create unique index profiles_username_lower_idx on profiles(lower(username));
create function public.handle_new_user() returns trigger language plpgsql security definer as $$begin return new; end$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
alter table profiles enable row level security;
grant select,insert,update on profiles to authenticated; grant select on profiles to anon;
create policy profiles_public_select on profiles for select using(true);
create policy profiles_owner_insert on profiles for insert to authenticated with check(id=auth.uid());
create policy profiles_owner_update on profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create table posts(id uuid primary key default gen_random_uuid(),user_id uuid references profiles(id),title text,description text,content text,mentions jsonb default '[]',publish_payload jsonb,media_plan jsonb,created_at timestamptz default now());
create table comments(id uuid primary key default gen_random_uuid(),mentions jsonb default '[]');
`;
export async function setup(){const db=new PGlite();await db.exec(fixture);await db.exec(migration);return db;}
export async function register(db,provider='google',meta={}){return (await db.query('insert into auth.users(email,provider,raw_user_meta_data) values($1,$2,$3) returning id',['private@example.test',provider,meta])).rows[0].id;}
export async function profile(db,id){return (await db.query('select * from profiles where id=$1',[id])).rows[0];}
