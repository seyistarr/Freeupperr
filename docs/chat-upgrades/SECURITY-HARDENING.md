# Chat security hardening after 7528928

**Production recommendation: NO-GO pending the release gates below.** Work continues on `feature/chat-exact-replacements`; the approved HTML/CSS layout, cards, composer and activity presentation are retained. No production data, schema, policies or services were changed. Nothing was pushed, merged or deployed.

## Findings and implemented fixes

### Activity authentication and membership revocation

The 7528928 private Broadcast design has two independent defects:

- Supabase calculates Broadcast channel permissions at join/token refresh and caches them. Removing membership cannot reliably eject an already-connected hostile subscriber.
- The client-supplied `payload.userId` is not authenticated by Broadcast membership RLS. A member can impersonate another member's activity.

The hardened implementation uses **authenticated RPC writes plus RLS-filtered Realtime Postgres Changes**. It does not use Broadcast for activity. This changes the transport, not the approved interface.

1. `publish_chat_activity` accepts conversation, source, sequence, event/kind/stage and booleans. It accepts **no sender ID**. A private, scoped function obtains `auth.uid()` from the JWT verified by Supabase/PostgREST and writes `chat_activity.user_id` itself. Timestamps and 4/7-second expiry are also server-assigned. Direct authenticated/anon INSERT/UPDATE/DELETE are denied, even if future permissive policies or grants are added.
2. `chat_activity` SELECT RLS rechecks current membership for each database change. A removed member's still-valid JWT and still-open socket do not grant access to subsequent rows. Reconnecting to the transport name confers no authority either. Official clients first request an authorized snapshot; outsiders/removed users fail that request.
3. The frontend joins **private** `chat-activity-db:<uuid>` channels. `can_join_chat_activity` and restrictive Realtime policies admit only current participants and deny all client Broadcast writes. A removed user cannot privately reconnect. Private join permissions are still only an admission check: Postgres Changes independently checks table RLS for every event, protecting against cached joins. A malicious public-flag subscription may join a routing label when hosted public access is enabled, but RLS still withholds unauthorized rows. The frontend installs only INSERT/UPDATE Postgres Changes handlers and never consumes or publishes client Broadcast events.
4. The obsolete `chat-activity:<uuid>` private Broadcast namespace is quarantined for anon/authenticated send and receive through restrictive policies. It is not used as a fallback. `can_use_chat_activity(text)` now returns false. Existing broad permissive Realtime policies cannot override those guards for private-channel probes. Public Broadcast channels bypass private authorization; their packets are never consumed by the new activity client. No application activity is published to them.
5. One-to-one authorization requires an actual participant and no block in either direction. Group authorization requires a current membership, with no fallback to legacy `user1_id`/`user2_id`. Sending additionally observes group admin-only permissions. Notes are excluded.
6. Per-browser source UUIDs and increasing sequences isolate tabs/sessions and reject reordered updates. Client sends are serialized with immutable destination IDs. Older queued active events expire rather than being sent arbitrarily late. Received actor identity comes from the authorized database row, not a nested payload UID. Participant checks in the renderer remain UI filtering, **not authentication**.
7. Reconnect snapshots, server expiry, local TTLs, cancellation, recording stop, failed uploads, conversation switching and channel termination retain their cleanup behavior. An authorization failure in a snapshot clears state and closes the official subscription. Transport disconnection cannot redirect pending uploads or messages.

The server authenticates which account declared the activity; it cannot attest that a microphone is actually recording. Activity remains cosmetic.

Supabase documents per-change RLS checks at <https://supabase.com/docs/guides/realtime/postgres-changes> and their cost at <https://supabase.com/docs/guides/realtime/benchmarks>. Broadcast cache behavior is documented at <https://supabase.com/docs/guides/realtime/authorization#updating-rls-policies>. An event already authorized and in flight before revocation cannot be recalled. This design does not promise physical socket ejection or removal of data a recipient has already received.

### Legacy membership-policy bypasses

Read-only production inspection confirmed two paths that could undermine an otherwise correct activity policy:

- Broad conversation UPDATE policies allow participants, including legacy direct-ID owners, to change identity columns. A removed group owner could attempt to turn a group into a direct conversation to regain authorization. A BEFORE UPDATE guard now forbids authenticated/anon changes to participants, type, note status, owner and creator. Trusted server operations remain possible. Ordinary name, theme, mute, pin, disappearing duration, timestamps and other metadata updates are unaffected.
- Group permission edits now require current owner/admin membership (or the note's owner). A non-admin cannot bypass admin-only sending by changing `permissions` through permissive legacy UPDATE RLS.
- Production `set_member_role` uses `v_caller_role != 'owner'`; for a non-member that expression is NULL and does not raise. The migration fixes this with explicit authentication, a null-safe owner check, existing-member validation and valid role validation. The public RPC signature is preserved as SECURITY INVOKER delegating to a private SECURITY DEFINER with empty search path and qualified objects. PUBLIC/anon execution is revoked. No exploit was attempted against production.

These guards are intentionally retained if activity itself is rolled back; restoring known authorization bypasses is not an acceptable feature rollback. Legitimate privileged ownership-transfer RPCs must still be reviewed in the hosted canary before release.

## Changed files

| Files | Change |
| --- | --- |
| `chat.js` | Server-authored activity transport, private admission plus per-event RLS consumption, source/sequence handling, private-media gates and late-response guards. |
| `chat.html`, `service-worker.js` | Cache versions only; no layout/CSS redesign. |
| `supabase/migrations/20261116172043_chat_activity_authorization.sql` | Corrected, unexecuted production proposal: activity state/RPC/RLS/publication/private admission, identity/permission guards and fixed role management. |
| `tests/chat-activity-*.test.js`, `tests/chat-upgrades-browser.test.js`, helper/fixture tests | SQL, JWT, real WebSocket and browser security/regression checks. |
| `package.json`, `package-lock.json` | Explicit pinned `ws` test dependency, using the already-installed 8.22.0 version. |
| `docs/chat-upgrades/*` | Current report, test outputs, read-only evidence/preflight, private-media contract, disable, retention and rollback procedures. |

## Private view-once compatibility

Production has `claim_view_once` and `view_once_consumptions` with a **30-second** default after opening, plus a viewer-only SELECT policy. It has neither `chat-private-upload` nor `view-once-open` in the Edge Function inventory. No chat/view-once storage bucket was returned. The API gateway does not allow either missing Edge endpoint. The existing private path had no server expiry in the blob viewer, and its media reply link was attached in a separate post-publication UPDATE.

No encryption/key-management protocol for private chat media exists in the inspected frontend/backend. Protected post-media delivery uses server-authorized Cloudinary downloads; that is not an encrypted, atomic view-once chat backend and must not be relabelled as one.

Implemented fail-closed changes:

- **New view-once sends no longer fall back to public Cloudinary media when the private flag is off.** The composer is retained on a rejected send. Normal photo/video/document sends are unchanged. Historical legacy messages retain their existing reader; their public URLs cannot be retroactively made private by frontend changes.
- A frontend flag alone is insufficient. Private operations require a fresh server capability response confirming the versioned private protocol, encrypted storage, atomic claim, atomic reply and server expiry. The absent capability RPC fails closed. This capability is a rollout check, not media authorization; a real backend must enforce every claim itself.
- The proposed upload contract carries `reply_to` into atomic server publication. The non-atomic client UPDATE fallback is removed.
- The disabled private reader requires the server's `x-freeupper-view-once-expires-at` response header, rejects missing/expired/>30-second expiry, and passes that deadline to the existing blob viewer. Late responses cannot open another selected conversation. Existing shielding, expiry and blob revocation are preserved.

**No private backend or encryption was fabricated or enabled.** The secure implementation requirements and unresolved key-custody decision are specified in `PRIVATE-VIEW-ONCE-CONTRACT.md`. Until implemented and audited, new view-once sending remains unavailable. This deliberate availability reduction is required to avoid a plaintext privacy downgrade.

## Production SQL compatibility review

The production project `jmjtqidirpmnegzvmiaq` was re-inspected using SELECT-only catalog queries. Evidence: `production-hardening-readonly.json`, with original detailed constraints/grants in `production-schema-readonly.json`.

- Conversations, memberships, block columns, RLS and existing helper signatures still match the migration. The activity table/functions are absent, confirming the original proposal was never applied.
- Membership has a unique `(conversation_id,user_id)` index; blocks have both-direction indexes. The new per-row membership lookup can use those indexes.
- `realtime.messages` RLS is enabled and there are still no existing policies. Its schema is compatible with namespace quarantine; no alteration of its managed columns is proposed.
- `supabase_realtime` exists, belongs to postgres, and is not an all-tables publication. The migration adds only the new activity table if necessary.
- The migration uses explicit SELECT grants for the new exposed table, restrictive RLS guards, fixed search paths, narrowly scoped function grants, server-authored timestamps and opaque primary keys. Replica identity remains DEFAULT: cleanup DELETE events reveal only an opaque random ID. The frontend does not subscribe to DELETE.
- `CREATE OR REPLACE`/named policy and trigger replacement is repeatable. The original never-applied migration filename is retained and corrected rather than presenting it as an already-deployed history entry. A PostgREST schema reload notification is included.
- Existing message tables, reads, reactions, conversations, group rows and post-media policies are not dropped or rewritten. The identity/permissions trigger and role RPC hardening are the explicit compatibility changes described above.

The private definer performs only an authenticated, validated activity write with a per-user source quota. No caller-selected actor, arbitrary JSON payload, topic or SQL is accepted. Expired state is hidden by RLS; publishing also prunes the author's sufficiently old state. Periodic administrative cleanup should be scheduled to enforce storage retention for inactive users; see `maintenance.REVIEW.sql`.

The baseline audit also recorded permissive legacy `message_reads` policies that need a separate receipt privacy/integrity review; this activity migration does not claim to fix them.

Hosted Realtime settings, gateway behavior under real production credentials and production-scale WAL latency remain unverified. The Postgres Changes design avoids reliance on cached Broadcast authorization, but load/latency and hosted-version behavior still require a canary. Legacy public `typing:` clients must be retired; there is intentionally no bridge to the unverified old transport.

## Tests and release gates

Exact results, initial infrastructure failures and test limits are recorded in `TEST-RESULTS.md`. Actual isolated Realtime tests reproduced the old cached-revocation and forged-UID behavior, then verified that the hardened private transport rejects reconnects and stops delivery to a removed user's still-open socket. Local SQL tests use the inspected production helper definitions. Signed-JWT integration uses isolated PostgreSQL/PostgREST and a local test issuer, not production accounts or a hosted sign-in flow. Browser tests use real markup/handlers with controlled adapters, not physical phones. The successful socket-specific outcome is recorded separately; HTTP authorization tests are never counted as WebSocket proof.

Production remains NO-GO until:

1. Review and approve the migration, including conversation identity/permission compatibility and the role RPC fix.
2. Validate the exact hosted Realtime/gateway version with direct and three-member group canaries, keeping the removed user's socket open, then trying reconnect, Broadcast injection and stale JWT reuse.
3. Load-test Postgres Changes fan-out/heartbeats and observe replication lag versus the 7-second TTL; configure server-side rate limits and short retention cleanup as needed.
4. Either implement/audit the private view-once protocol or explicitly approve a release with new view-once sends unavailable. Do not enable either private feature flag alone.
5. Test physical iPhone Safari, Android Chrome, installed PWA, background/foreground recording and media playback, Firefox/WebKit and screen readers. No such device testing is claimed here.

## Production deployment order — approval required

1. Complete isolated/hosted canary verification and code review. Snapshot current policies, function definitions and configuration for change control.
2. With explicit production approval, apply the reviewed SQL transaction first. Confirm new table RLS, grants, RPCs, trigger, publication and schema cache. Check that role changes, normal message sends and ordinary group metadata updates still work.
3. Validate production canaries with the old clients excluded from the new activity data path. Do not loosen policies to support an old client.
4. Deploy the frontend/cache update (`chat-security-v4`, service-worker v38) through the normal approved release process. Keep private view-once disabled and the missing endpoints unallowlisted. This task performs no deployment.
5. Monitor authorization failures, table size, WAL/fan-out latency and normal messaging. Schedule reviewed ephemeral-state cleanup. Private view-once needs a separate audited backend/key-management/gateway rollout before it can be enabled.

## Disable and rollback

For immediate feature disable, review/apply `disable-activity.REVIEW.sql` only after approval. It revokes publishing; existing indicators expire in at most 7 seconds after the last accepted in-flight write. Normal messaging is independent of activity RPC failures.

Prefer leaving the hardened frontend fail-closed, bumping the service-worker cache version forward for any forward patch. Do not blindly revert `chat.js` to `7528928`: that would restore the plaintext view-once send fallback. Any frontend rollback must retain the new private-media gates. `rollback.REVIEW.sql` removes only activity-specific RPCs/table/helper state. It preserves all messages/conversations, unrelated policies, the fixed group-role RPC, conversation identity/permission guards, and quarantine of obsolete Broadcast topics. No CASCADE is used by the production rollback. The test harness may reset disposable local schemas; those test-only operations are not production instructions.
