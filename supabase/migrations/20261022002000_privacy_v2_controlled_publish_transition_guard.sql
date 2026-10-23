-- Controlled Privacy V2 release: prepare only. DO NOT APPLY before
-- validating the production deployment, authenticated delivery, and rollback.
-- The release must not use a global bypass of post authorization.
-- Required invariants:
-- 1. Only approved test publishers can create restricted drafts.
-- 2. Only approved test publishers can transition drafts to published.
-- 3. Viewers remain governed by authorize_protected_asset and approved_edge.
-- 4. Public-only behavior for existing posts remains unchanged.
-- 5. Release must be independently revocable without changing post visibility.
--
-- This migration deliberately adds a database-level publishing transition
-- guard while leaving the release-control CHECK(false) intact.
create or replace function privacy_v2_private.enforce_test_publisher_on_post()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility in ('followers','friends','only_me')
     and (
       tg_op = 'INSERT'
       or (tg_op = 'UPDATE' and (
         old.visibility is distinct from new.visibility
         or old.publishing_state is distinct from new.publishing_state
         or old.is_hidden is distinct from new.is_hidden
       ))
     )
     and not public.privacy_v2_test_publisher_allowed(new.user_id)
  then
    raise exception 'Restricted publishing requires approved test publisher'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function privacy_v2_private.enforce_test_publisher_on_post()
from public, anon, authenticated;
drop trigger if exists privacy_v2_controlled_publisher_guard on public.posts;
create trigger privacy_v2_controlled_publisher_guard
before insert or update of visibility, publishing_state, is_hidden on public.posts
for each row execute function privacy_v2_private.enforce_test_publisher_on_post();
