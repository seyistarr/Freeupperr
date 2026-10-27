# Temporary production verification mode

This is a testing lane, not production privacy acceptance. Normal delivery and
publishing release flags remain false; legacy conversion remains false. No
authenticated production acceptance is claimed by the automated fixtures.

## Boundaries

Only the existing account IDs for @archangelstr, @freeupper and @MasterCraft may
create verification drafts. The hard limit remains in the database even if an
older beta allowlist is accidentally expanded. Both existing publisher lists and
an unsuspended profile are also required. @firstuser is excluded from publishing.
Viewers need not be beta publishers: normal owner, approved-follower, mutual and
Only Me authorization still applies on every media request.

The administrator-controlled window lasts at most seven days. Every verification
post expires within 24 hours or at the window's expiry, whichever comes first.
Each owner may have at most ten unretired verification posts. Retire expired posts
to free that quota. There is no public flag, query parameter or alternate JWT that
can enable verification. Existing posts cannot be marked or converted.

A marker in `privacy_v2_private.verification_posts` is inserted atomically with a
new draft. The marker is mandatory for the verification signing/publishing lane
and for delivery while normal delivery remains disabled. Marker ownership,
expiry, retirement, mode state and publisher eligibility are checked server-side.
The existing registered-asset, complete-plan, poster and audience checks remain.
Verification lifetime is also a restrictive post-read policy, so expiry or
retirement removes the post from authenticated reads as well as media delivery.

All uploads use Cloudinary `authenticated` delivery and signed, owner-scoped
reservations. The browser receives opaque registry IDs and authenticated media
bytes through `/api/post-media`, never signed download URLs. Normal Public posts
continue using their existing path.

## Test on freeupper.com with normal sessions

1. Sign in normally on **https://freeupper.com/privacy-verification.html** as one
   of the three approved accounts. Close older FreeUpper tabs/PWA windows first
   and open this page fresh so the updated uploader is loaded. Use an existing
   browser session or the normal
   Sign in button. No Codex Cloud sign-in, copied JWT or special credentials are
   required. The page shows the actual verification window expiry.
2. Open **Create a verification post**. Choose **Only Me**, then select a small
   local photo and publish. Select the audience *before* choosing files, so the
   public uploader is never used. The audience note must say temporary
   verification. Refresh the verification page: the new post should be listed
   with its ID, audience, state and expiry. Use **Open post** to view it.
3. Open **Studio**, choose a plain local video without effects/music/text layers,
   then choose **Only Me** and publish. Verify playback and a real poster image
   on the video page and on your profile. The poster is a separate authenticated
   asset in slot 20. If either upload/registration fails, publication must fail.
4. Repeat with separate **Followers** and **Mutuals** posts. Use a one-way approved
   follower, a mutual follower and a stranger in separate normal browser profiles
   or devices. Keep these sessions separate from the publisher.

   | Viewer | Followers | Mutuals | Only Me |
   | --- | --- | --- | --- |
   | Owner | allow | allow | allow |
   | Approved one-way follower | allow | deny | deny |
   | Approved mutual | allow | allow | deny |
   | Signed-in stranger | deny | deny | deny |
   | Signed out | deny | deny | deny |

   Check homepage, video links and profile grids where appropriate. After
   unfollowing, reloading the post must deny access. Private accounts still need
   explicit owner approval; an active follow row alone must not grant access.
5. Open a copied media route without a session or with an invalid/expired token:
   it must not return media. In browser Network tools, media requests should carry
   the existing session's Bearer token, return `private, no-store`, and never
   redirect to a Cloudinary download URL. Do not paste tokens into reports.
6. For each uploaded Cloudinary public ID from the upload response, request its
   unsigned `image/authenticated` or `video/authenticated` URL, and the equivalent
   `image/upload` or `video/upload` URL, in a signed-out browser. Neither may
   expose the verification asset. Do not mark this check passed without testing
   actual uploaded assets.
7. Sign in as @firstuser: restricted publishing must remain unavailable. Attempts
   to call the publishing function directly must be denied. This is a publisher
   exclusion; ordinary authorized viewing still follows the audience rules.
8. Confirm that an existing Public post still loads while signed out. Confirm
   restricted contents do not appear in anonymous previews, public search or
   cached responses. Record device, account role, post IDs, observed statuses and
   any failures. **Production acceptance remains pending until these real-user
   checks have actually been completed.**

## Cleanup

Return to **https://freeupper.com/privacy-verification.html** in the owner's normal
session. Click **Remove verification post** for every test post. The server first
retires the marker, hides/deletes the post and invalidates its registry assets,
so access stops before remote deletion. Deletion waits until issued upload
signatures expire (65 minutes from reservation), preventing late uploads from
recreating an object after cleanup is reported complete. It then deletes both authenticated image
and video resources for each reserved public ID with Cloudinary invalidation.
Only the authenticated owner's marked verification posts can be affected.

If the page says deletion is pending, use **Retry pending asset cleanup** later.
Leases prevent duplicate concurrent cleanup, and a failed/unknown remote result
is never reported as completed. Cleanup remains available after the verification
window expires or publisher eligibility is revoked. Retired markers are retained
as an audit trail; normal posts are not touched.

## Operator controls (database administrator only)

Inspect without exposing signing data:

```sql
select * from privacy_v2_private.verification_control;
select public.protected_first_release_status();
select post_id, owner_id, created_at, expires_at, retired_at
from privacy_v2_private.verification_posts order by created_at desc;
```

Stop the lane immediately (also stops existing verification delivery/read access):

```sql
update privacy_v2_private.verification_control set enabled=false where singleton;
```

Retire expired verification posts for owners who have not cleaned them up, then
let owners retry cleanup in the page or use the existing protected cleanup worker:

```sql
select public.retire_verification_post(owner_id,post_id)
from privacy_v2_private.verification_posts
where retired_at is null and expires_at<=now();
```

The deployer enables only this new seven-day window after automated tests and
backend/frontend deployment succeed. Do not set `delivery_verified`,
`publishing_verified` or general `restricted_enabled` to run these tests. None of
those flags is used as evidence of production acceptance by this feature.
