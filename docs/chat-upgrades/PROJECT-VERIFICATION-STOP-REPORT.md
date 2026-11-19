# Project verification after stop — 2026-11-16

All database writes were stopped. No cleanup, rollback, Auth seeding, deployment, merge or push was performed after the stop. Subsequent database requests were SELECT-only catalog/audit queries.

## Verified project mapping

| Reference | Registered name | Verified role |
| --- | --- | --- |
| `jmjtqidirpmnegzvmiaq` | FreeUpper | Actual production application backend |
| `tagkrhvgcbnybiuyvjxt` | Freeupperr Staging | Separate project registered as staging in the same organization; not the live application's backend |

This conclusion does not rely on the Git branch or on a connector's selected project.

Evidence from the live application and Cloudflare control plane:

- `https://freeupper.com/auth.js` and the www redirect serve configuration using `https://api.freeupper.com`. The public client's project-reference claim and session-storage namespace both identify `jmjtqidirpmnegzvmiaq`. No key value is included in this report.
- Cloudflare's live Worker domain assignments show `freeupper.com` and `www.freeupper.com` assigned to `freeupper-web`, and `api.freeupper.com` assigned to `freeupper-api`, all in the production environment and enabled.
- The active 100% versions are web `52a80774-c6aa-4cf5-9ec7-092ac51e207a` and API `3bcc4400-f4ce-44ad-a13b-b0d4213f1c7a`.
- Both active versions have `SUPABASE_URL` and `SUPABASE_ANON_KEY` secret bindings. Cloudflare exposes their names/types, not their values. No secret binding value was retrieved or changed. The web Worker also has its existing `ASSETS` and `PRIVACY_CLEANUP_TOKEN` bindings.
- The deployed Worker scripts reference only `jmjtqidirpmnegzvmiaq.supabase.co`; neither references `tagkrhvgcbnybiuyvjxt`. The API script explicitly rejects an upstream hostname other than `jmjtqidirpmnegzvmiaq.supabase.co`.
- A GET-only check of `/auth/v1/settings` through `api.freeupper.com`, using the live application's public client configuration without logging its key, returned HTTP 200. The corresponding direct production endpoint returned HTTP 200 and the same canonical response fingerprint: `41225a0c7f2914112517f75916e66debfe023fb72e3886d1cd0ec73be43f83b0`. No user login was attempted.
- GitHub main currently resolves to `4a19c659a1928b4d1ad39938ed05c5e7931f2d0b`; its client and API Worker configuration agree with the live project reference. The local workspace remains on the previously requested feature branch at `4d2cb95`; no checkout or merge was performed.

The other project is labelled **Freeupperr Staging** and has earlier `privacy_v2_staging_*` migration history. These observations support staging classification; they do not establish a new authorization to change it. Neither live Worker references it.

## Why the staging project was selected

The previous task requested hosted staging canaries using existing resources. The connector listed `tagkrhvgcbnybiuyvjxt` as Freeupperr Staging, separately from FreeUpper production, so it was selected for isolated staging preparation. It was not selected or represented as production. The production/staging mapping and proposed staging write footprint should have been made explicit for confirmation before that schema change.

## Changes already made to the staging project

It is **not** correct to report that no changes occurred.

The following migration succeeded before the stop:

- Version: `20261116195437`
- Name: `chat_canary_production_shape_baseline`
- Source: `staging/bootstrap.STAGING-ONLY.sql`
- Source SHA-256: `a6179971e7af2a5aaccb9f4df9da62d0e0b4e2b8f70cd0f37f3d1bf810d27bbc`

Its verified footprint is six empty public tables (`profiles`, `conversations`, `conversation_members`, `messages`, `message_reads`, `blocks`), their constraints, nine supporting functions from production metadata, one sequence (`blocks_id_seq`), eighteen public RLS policies, two message triggers (conversation metadata update and expiry), and four Realtime publication entries. No production rows or push/mail notification trigger were copied.

The subsequent `chat_canary_activity_hardening` migration request returned **declined**. The audit confirms:

- No migration history entry for that name.
- No `public.chat_activity` table.
- No new activity publisher/snapshot/private-join functions or conversation-identity guard function.
- No Realtime policies from the proposed activity migration.
- Zero inserted canary accounts; the existing Auth user count remains fourteen.
- Zero profile rows and zero conversations. No canary messages, logins or uploads were created.

The baseline includes legacy permission definitions; it is not a completed or security-verified canary environment. No attempt has been made to remove or alter these objects after the stop. Cleanup would itself modify the project and requires approval.

## Read-only comparison with the correct production project

`jmjtqidirpmnegzvmiaq` was checked using catalog SELECTs only:

- Production conversation identity columns match the prepared migration: UUID IDs/participants/owner/creator, boolean group/note flags, JSONB permissions.
- `conversation_members` has the expected conversation/profile foreign keys and unique `(conversation_id,user_id)` constraint.
- Existing helper signatures match: `is_blocked_between(uuid,uuid) -> boolean`, `can_send_in_conversation(uuid) -> boolean`, and `set_member_role(uuid,uuid,text) -> void`.
- `realtime.messages` RLS is enabled; authenticated SELECT/INSERT grants are present; there are currently no Realtime policies.
- The `supabase_realtime` publication exists, is owned by postgres, and is not an all-tables publication.
- Production still has no `chat_activity` table or the proposed publisher/snapshot RPCs.
- Latest recorded production migration remains `20261112174353_google_signup_display_name`; neither canary migration appears there.

No mismatch was identified in these checked schema prerequisites. The intended security changes, hosted behavior and rollout still require review; catalog compatibility is not a production GO decision. The prepared activity migration remains unchanged (SHA-256 `ee0310640a51c7fecbd92249bcc3a47bf18602c4c5631b88e2b9388eb186e737`). It was not executed against production.

## Hold state

No further writes to either Supabase project, no automatic rollback/cleanup, no SQL migration, deployment, merge or push will occur without explicit approval. Hosted canary/load verification is paused. Existing preparation artifacts are uncommitted; tracked application code remains at `4d2cb95`.
