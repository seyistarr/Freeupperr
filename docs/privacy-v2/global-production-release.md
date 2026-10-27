# Global Privacy V2 production release

Every existing, non-anonymous Supabase Auth user with a nonsuspended profile is
eligible to publish Public, Followers, Mutuals (`friends`), and Only Me
(`only_me`). The historical publisher lists and test-account IDs do not grant
publishing eligibility. @firstuser has the same publishing eligibility as other
normal users; its unrelated-viewer permissions are unchanged.

The global migration preserves the singleton release row and replaces its
permanent-off CHECK with a verified-activation constraint. Enabling requires both
verification flags, genuine stored production evidence of valid-vs-expired
Cloudinary download signatures, retired/cleaned verification posts, and disabled
temporary verification. The migration does not activate the flags itself.
Durable audit evidence avoids a new permanent lock when no private assets remain.
Legacy public-media conversion stays disabled.

Create and Studio refresh readiness through the authenticated status RPC. Their
selectors retain the `friends` mapping, contain no audience Coming Soon labels,
and never silently reset a selected restricted audience to Public. Plain text
publishes atomically behind the existing post RLS; images and videos use the
existing authenticated Cloudinary registration pipeline. Videos require a
separately registered authenticated poster. Unrendered media effects/music/text
layers remain blocked from the protected upload path.

Reviewed service-only audience changes update metadata and delivery authorization
on the same registered post. Direct client changes remain denied. Registered
private posts cannot be converted to Public or gain public media URLs.

Normal deletion hides a post and revokes media access immediately while retaining
recoverability for seven days. `/recently-deleted.html`, linked from the owner's
profile, supports Restore and Delete permanently. Permanent deletion is
irreversible, denies even the owner's ordinary metadata REST access, and queues authenticated asset destruction after any issued upload
signatures expire (65 minutes from reservation). Existing deletion timestamps are
preserved. Cancellation/abandoned drafts also queue cleanup. The Cloudflare cron
continues every five minutes independently of publishing availability.

## Production verification

The owner previously reported real-user verification for Followers/unfollow,
Mutuals images/videos, Only Me, Studio poster/playback and removal. Automated
fixtures are kept distinct from those reports.

The maintenance audit records real Cloudinary statuses and never returns signed
URLs. Credential rotation accepts platform-verified project anon JWTs plus the
independent maintenance key. Updating a Cloudflare secret creates a version;
that version must also be deployed. The source preserves JWT verification and
normal owner/follower/mutual authorization.

`protected-release-audit` is a one-use operator workflow. An administrator queues
a private, expiring audit row; the Edge Function requires a platform-verified JWT
and the independent maintenance key before claiming it. It redeems admin-generated
one-time links through Supabase Auth for the four explicitly authorized test
accounts, sends genuine user JWTs through api.freeupper.com/freeupper.com, and
revokes only those newly created sessions. It sends no sign-in email and returns
no login material. Test IDs in this driver identify test subjects, not an
allowlist. A failed live workflow records its exact failed check and disables the
release flags. Browser roles cannot queue, claim, or attest runs.

The live driver verifies normal account readiness, anonymous rejection, real
image/video/poster upload/registration/publication, metadata and byte delivery,
actual follower/mutual relationships, Only Me, unsigned Cloudinary denial,
private/no-store responses, text privacy, publishing by @firstuser outside the
old beta, audience changes, normal deletion/restoration, permanent deletion and
cancellation. Audit posts are retired afterward; their new upload reservations
observe the same 65-minute cleanup delay. These are server-authorized live API
tests, not claims of a newly performed interactive browser acceptance session.

## Inspect / stop

```sql
select public.protected_first_release_status();
select public.protected_first_capabilities();
select public.protected_publishing_capabilities();
select * from privacy_v2_private.release_control;
select created_at,results from privacy_v2_private.security_audits order by id desc limit 5;
select id,state,result from privacy_v2_private.release_workflow_audits order by created_at desc;
select post_id,state,cleanup_pending,cleanup_after,cleanup_attempts
from public.post_upload_intents where state='cleanup';
-- Stops publishing/delivery without stopping cleanup:
update privacy_v2_private.release_control set restricted_enabled=false where singleton;
```

Production `/__migration/health` reads current release capabilities from Supabase
and reports whether the read was verified. It does not expose secrets or account
metadata. Normal Public routes and the API gateway retain their existing paths.
