# FreeUpper production Supabase security deployment — 2026-10-15

Production project: `jmjtqidirpmnegzvmiaq`
Applied migration: `harden_public_post_share_and_search_20261015`

## Verified deployed changes

- `public.record_share(uuid, uuid)`: rejects unauthenticated requests and user ID impersonation; verifies the target is an accessible public post; prevents duplicate share increments using the existing unique `shares(user_id,post_id)` constraint.
- `public.search_posts(text, integer)`: returns public, non-hidden, non-deleted posts from non-suspended public accounts; safely handles null text and clamps result limit.
- Read-only database checks confirmed both definitions include the new authorization checks and remain SECURITY DEFINER.

## Not deployed

- Audience-aware post SELECT RLS and `freeupper_can_view_post`.
- Draft `edit_post` replacement.
- Protected Cloudinary delivery, Followers / Mutuals / Only Me publishing.
- Authenticated end-to-end regression tests.

The production public-only posting guard remains active. Do not execute the REVIEW SQL from PR #5 or enable restricted audiences until protected media and access-control tests pass. This file records the applied migration; it is not a second migration to execute.
