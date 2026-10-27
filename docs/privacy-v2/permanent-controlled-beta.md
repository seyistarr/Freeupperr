# Permanent controlled beta — 2026-10-27

## Acceptance evidence

The product owner reported completed real-user production acceptance on 2026-10-27:
Followers image playback and unfollow revocation; Only Me owner publishing/playback
and unrelated-account denial; Mutuals image/video playback and unrelated-account
denial; Studio video publishing, poster rendering and playback; verification-post
removal disappearing for the tested viewer. These are user-reported authenticated
checks, not Codex impersonation or synthetic JWT tests.

Final activation is gated on independent storage/API/metadata checks, complete
remote deletion after upload-signature expiry, and the full automated suite.
The implementation migration installs the permanent boundary with release gates
off. Activation is a separate administrator transaction after those checks.

## Permanent boundary

Only these immutable account IDs can publish Followers, Mutuals or Only Me posts:

| Account | Auth account ID |
| --- | --- |
| @archangelstr | 9341af03-e007-4fc6-9c23-b06073379088 |
| @freeupper | a0a53cb6-be86-4862-b267-f7f43d4cf324 |
| @MasterCraft | 5b5bd4b3-22df-41e7-8e6e-2dae82ee68df |

The database additionally requires the existing two publisher lists and an
unsuspended profile. Expanding either list cannot expand the three-account
boundary. @firstuser cannot publish restricted posts, but its owner/follower/
mutual viewer permissions are unchanged. Ordinary Public publishing is preserved.

There is no unrestricted-publishing control. `restricted_enabled` enables only
this server-enforced beta. `delivery_verified` and `publishing_verified` must also
be true. `protected_first_release_status().legacy_conversion` remains false;
Public-to-restricted conversion and the old global publishing API aliases remain
disabled. The normal composer and Studio use the existing production JWT system
and the protected-publishing Edge Function through api.freeupper.com.

Temporary verification publishing is permanently disabled in both Edge and SQL,
even if its old window row is re-enabled. Verification markers cannot become
permanent posts. Their read/delivery lifetime remains denied after shutdown;
owner-scoped cleanup and private audit records remain available at
`/privacy-verification.html`. New permanent posts do not receive temporary markers
or a 24-hour published-post expiry. Unfinished drafts still expire after one hour.

## Privacy and cleanup

Every protected media request authenticates the existing JWT with Supabase Auth,
then checks owner/approved follower/approved mutual authorization and current
post/registry state. Only Me is owner-only. Cloudinary authenticated assets are
streamed with `private, no-store`; signed download URLs are never returned.
Images, videos and separately registered posters use the same authorization.

The normal Delete Post RPC and direct owner deletion retain a hidden, failed,
deleted tombstone and queue authenticated image/video deletion with invalidation.
This prevents foreign-key cascades from erasing cleanup reservations. Delivery
stops immediately; upload reservations must be at least 65 minutes old before
remote deletion, preventing a still-valid upload signature recreating an asset.
Cleanup is leased, retryable, idempotent and never reports a remote failure as
success. Restoration of retired protected posts is denied.

The Cloudflare Worker runs maintenance every five minutes. A separate 256-bit
maintenance key is stored only as a Cloudflare secret and a SHA-256 database hash;
only the Edge service role can validate it. Maintenance can expire drafts, claim
already-retired reservations, delete their authenticated objects, and record
fixed storage probes. It cannot publish, supply a viewer identity, return media,
choose an arbitrary public ID, or bypass normal-user authorization. It is not
exposed as a web route. The browser roles cannot call maintenance RPCs or read
its key/audit tables.

Post RLS remains the audience boundary for feeds, profiles and direct reads.
Restrictive child-row policies apply that boundary to comments, likes, reposts,
notifications and other post metadata. Restricted notifications cannot be pushed
to unrelated recipients. Public search and share-preview RPCs explicitly select
Public, visible, nondeleted posts; sound rows cannot expose a protected source.
Protected posts cannot gain public media URL or sound metadata.

## Operator inspection / emergency stop

```sql
select public.protected_first_release_status();
select * from privacy_v2_private.release_control;
select enabled from privacy_v2_private.verification_control;
select p.username, public.protected_publisher_beta_allowed(p.id)
from public.profiles p
where p.username in ('archangelstr','freeupper','MasterCraft','firstuser');
select created_at, results from privacy_v2_private.security_audits order by id desc limit 1;
select post_id, state, cleanup_pending, cleanup_after, cleanup_attempts
from public.post_upload_intents where state='cleanup';
-- Stops publishing and delivery; background cleanup remains independent.
update privacy_v2_private.release_control set restricted_enabled=false where singleton;
-- Independently revoke scheduled maintenance if its key is compromised.
update privacy_v2_private.cleanup_worker_key set enabled=false where singleton;
```

## Normal-browser release smoke test

Close older FreeUpper tabs/PWA windows and reopen freeupper.com. Sign in normally
as an approved publisher, use Create or Studio, choose the restricted audience
before selecting a file, and publish. Verify the post in separate owner, approved
follower, mutual and unrelated sessions. Owner: all audiences; one-way follower:
Followers only; mutual: Followers and Mutuals; unrelated or signed out: none.
Unfollow and reload to confirm revocation. @firstuser must retain authorized
viewing while restricted publishing remains unavailable. Delete through the
normal post menu, confirm immediate denial, and inspect the cleanup queue after
the 65-minute reservation cutoff. Existing Public posts and share previews must
still work. No Codex Cloud sign-in or copied session credentials are required.
