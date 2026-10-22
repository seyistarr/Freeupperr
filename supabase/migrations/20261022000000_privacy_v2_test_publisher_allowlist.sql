-- Default-deny test publisher allowlist. This migration does not activate
-- production release gates or populate any account IDs.
create schema if not exists privacy_v2_private;

create table if not exists privacy_v2_private.test_publishers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  approved_by uuid,
  revoked_at timestamptz
);
alter table privacy_v2_private.test_publishers enable row level security;
revoke all on privacy_v2_private.test_publishers from public, anon, authenticated;

create or replace function public.privacy_v2_test_publisher_allowed(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from privacy_v2_private.test_publishers t
    where t.user_id = p_user and t.revoked_at is null
  )
$$;
revoke all on function public.privacy_v2_test_publisher_allowed(uuid) from public, anon, authenticated;
grant execute on function public.privacy_v2_test_publisher_allowed(uuid) to service_role;

-- After independently verifying both accounts' auth UUIDs, add only the
-- two approved publisher IDs via an audited admin migration. @firstuser is
-- intentionally a non-follower viewer, not an approved test publisher.
-- NOTE: Existing CHECK(false) and protected release gates remain unchanged.
