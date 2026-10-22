-- Defense in depth: restrict creation of new nonpublic posts to explicitly
-- approved controlled-test publishers. Does NOT turn on release flags.
create or replace function privacy_v2_private.enforce_test_publisher_on_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.visibility in ('followers', 'friends', 'only_me')
     and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.visibility is distinct from new.visibility))
     and not public.privacy_v2_test_publisher_allowed(new.user_id) then
    raise exception 'Restricted publishing requires approved test publisher' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function privacy_v2_private.enforce_test_publisher_on_post() from public, anon, authenticated;
drop trigger if exists privacy_v2_controlled_publisher_guard on public.posts;
create trigger privacy_v2_controlled_publisher_guard
before insert or update of visibility on public.posts
for each row execute function privacy_v2_private.enforce_test_publisher_on_post();
