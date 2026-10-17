-- Deep Linking V2: REVIEW ONLY. Do not run on production without schema/security review.
-- Generate a random 10-character base64url code with 56 bits of entropy.
-- Requires pgcrypto installed in the extensions schema; verify before applying.
create or replace function public.generate_post_short_code()
returns text language sql volatile set search_path = '' as $$
  select translate(rtrim(pg_catalog.encode(extensions.gen_random_bytes(7), 'base64'), '='), '+/', '-_')
$$;
-- A 7-byte input produces 10 base64url characters (56 bits).
-- The unique primary key on post_short_links handles collisions.
-- Proposed backfill: run in bounded batches under a privileged migration role.
-- Insert only records without a link; retry failed collisions in a later batch.
-- Example (review schema and runtime first):
-- insert into public.post_short_links(code, post_id)
-- select public.generate_post_short_code(), p.id
-- from public.posts p
-- where not exists (select 1 from public.post_short_links l where l.post_id=p.id)
-- order by p.id limit 1000
-- on conflict do nothing;
-- Do not expose the generator to anon/authenticated users.
revoke all on function public.generate_post_short_code() from public, anon, authenticated;
