-- Run manually in the PRODUCTION Supabase SQL Editor as an authorized administrator.
-- READ ONLY. Do not use a service-role key in a browser or share access tokens.
-- Confirm that each returned account belongs to the intended person before approving.
select
  lower(p.username) as username,
  p.id as profile_user_id,
  u.id as auth_user_id,
  (p.id = u.id) as matches_auth_identity
from public.profiles as p
left join auth.users as u on u.id = p.id
where lower(p.username) in ('archangelstr', 'freeupper', 'firstuser')
order by lower(p.username);

-- Expected: exactly one row per username, and matches_auth_identity=true.
-- @firstuser is for denial testing only; NEVER insert into test_publishers.
-- Approval requires separate review of the IDs and the audience/relationship matrix.
