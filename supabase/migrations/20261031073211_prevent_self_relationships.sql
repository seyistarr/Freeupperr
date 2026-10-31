-- Preserve historical rows for a reviewed cleanup. NOT VALID skips the historical
-- scan but enforces the invariant for every new INSERT and UPDATE, including
-- direct writes that do not use toggle_follow_with_notification.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.follows'::regclass and conname='follows_no_self_relationship'
  ) then
    alter table public.follows add constraint follows_no_self_relationship
      check (follower_id <> following_id) not valid;
  end if;
end $$;
commit;
-- After a separately reviewed cleanup, validate with:
-- ALTER TABLE public.follows VALIDATE CONSTRAINT follows_no_self_relationship;
