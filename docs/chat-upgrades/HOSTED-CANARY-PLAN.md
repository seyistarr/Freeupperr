# Production canary plan — approval required

Target: `jmjtqidirpmnegzvmiaq`. No fixtures have been created. Creating accounts, inserting messages/receipts/activity, blocking, changing memberships and cleanup are production writes and require separate approval. Do not substitute real users or conversations, including for rollback-based tests.

## Existing fixture inventory

Read-only search on 2026-11-20 found zero Auth accounts carrying the known `chat_canary_run`/admin-purpose markers or the previous `chatcanary…@example.invalid` naming, and zero matching candidate conversations. Differently named fixtures may exist; they require explicit owner identification and proof that they are disposable before use. Unmarked users must not be repurposed.

## Exact minimum fixture set

Proposed run ID: `chatcanary20261120r1`. Before approval/execution, verify these exact identities do not already exist. Stop on a collision; never reset an existing account's password or reuse its data.

| Alias | Temporary account | Role and limits |
| --- | --- | --- |
| P1 | `chatcanary20261120r1-p1@example.invalid` | Ordinary authenticated user; owner of only the canary group |
| P2 | `chatcanary20261120r1-p2@example.invalid` | Ordinary authenticated participant; revocation and reapproval target |
| O | `chatcanary20261120r1-outsider@example.invalid` | Ordinary authenticated outsider; never added to either conversation |

Provision through the supported Auth Admin service/operator workflow with confirmed `.invalid` addresses and no outgoing emails. Do not directly insert into `auth.users`/`auth.identities`. Record server-issued Auth/profile IDs and creation timestamps in a private run manifest; preserve automatically generated identity fields. Set an admin-controlled `chat_canary_run` marker and `purpose=freeupper-chat-canary`, with matching display labels. Markers identify fixtures; they are not authentication or authorization. All account roles remain normal authenticated users, not application admins/service roles.

Use fresh strong passwords and short-lived real Auth sessions, held only in an approved temporary secret store. Never commit passwords, signing keys, access/refresh tokens or admin credentials. Provisioning access and isolated-user credentials are not currently available to this work.

Hide profiles from suggestions and use private/no-post profiles before use. Verify the fixture accounts have no real followers, contacts, push subscriptions or existing relationships. Do not attach real devices, mailboxes or social accounts. If isolation cannot be established, stop provisioning/testing and report it.

| Alias | New dedicated fixture | Required ownership |
| --- | --- | --- |
| D | Direct conversation P1 ↔ P2 | Both accounts must be run-manifest canaries |
| G | Group named `chatcanary20261120r1 group` | P1 owner; P2 member; O excluded |
| N | Note named `chatcanary20261120r1 note` | P1 owner only; no other members |

Record all generated conversation/membership UUIDs. Verify that no real-user UUID appears in participants, owner, creator or member rows. Do not change any existing conversation. Add no relationships to real accounts.

Initial message manifest: `D1` P1 text in D; `D2` P2 reply to D1; `G1` P1 text in G; `N1` P1 text in N. Use only clearly labelled inert canary text. No real attachment URLs or historical messages. Record all message UUIDs, each returned receipt composite key, activity source UUID/row ID, join-request ID and block ID as the tests create them. Record all notifications associated with these messages/actors; only canary accounts may be recipients.

Two participants support direct and two-member group acceptance and revocation. Three-or-more-member group wording/fan-out requires a fourth separately approved account so O remains an outsider; it is not covered by this minimum fixture set. New private view-once sends stay disabled throughout.

## Test sequence after explicit fixture-lifecycle approval

1. Validate real Auth login/session/JWT expiry/refresh for P1/P2/O. Use only their provider-issued JWTs. Confirm target-project identity before any client connection; do not emulate authenticated identities using admin SQL session variables.
2. Through both the direct provider and API gateway, have P1/P2 subscribe privately to D/G and publish typing/recording/photo/video/mixed declarations. Verify actor identity comes from server rows and O cannot join/read/publish. Attempt only bounded fixture-scoped identity-forgery/direct-write/Broadcast cases; no real user IDs or filenames.
3. Exercise D1/D2 reply and receipt flow: P2 marks D1 read; repeat/concurrent upserts preserve first-read time. P1 sees accurate P2 receipts; O sees none and cannot forge a reader. P1-only note receipts remain isolated. Verify browser rendering, existing composer/cards/tabs/replies and responsive layouts using the unchanged candidate frontend; do not deploy it to production.
4. Hold P2's original group socket/JWT open. P1 removes only the recorded P2 membership from G. Publish another P1 event and prove P2 receives no future rows while P1 still does. Test reconnect/snapshot/receipt access denial and stale JWT reuse; reject P2's unauthorized role or approval requests. Do not remove P2 from any other conversation or act on real memberships.
5. With approval-required invite mode on G, let P2 submit a pending request. P2/O cannot approve it; P1 can explicitly approve it and restore only the recorded canary membership. Verify member role, not owner/admin. O remains excluded throughout.
6. Insert only the P1↔P2 canary block. Hold direct sockets open and verify activity/receipt access stops; verify both block directions in bounded separate cases. Remove only those recorded block IDs. Group behavior follows membership rules; do not claim a direct block removes group membership.
7. Exercise heartbeat/expiry, concurrent sources, recording start/cancel/send/discard, simulated upload preparing/progress/cancel/failure, conversation switching, channel drop/reconnect and expired/refreshing Auth. Record arrival latency and fan-out, not fabricated progress. Simulated composer/media adapters are not real microphone/Cloudinary proof.
8. Real uploads or microphone/device trials require an additional explicit resource plan: small synthetic assets, identified Cloudinary public IDs/storage paths and deletion authorization. No real uploads, media-resource creation or physical-device pass is included by approving this minimum data-fixture plan alone.

Stop on any unexpected authorization/admission, cross-user row, mutation outside the manifest, missing denial, receipt corruption or unexplained state change. Close local test clients and report the gate; do not loosen policies, restore old Broadcast, change global Auth settings or silently repair production data. Cleanup after a failure must remain within its approved scope; stop it too if boundaries are uncertain.

## Cleanup procedure — separately approved, manifest-only

Cleanup permission must explicitly cover the new fixture lifecycle. No cleanup action has run. Do not infer permission to remove real data from permission to create fixtures.

1. Stop publishers/recorders and close test sockets; revoke only canary refresh sessions through supported Auth controls. Record that JWT validity and membership revocation differ; do not rotate global secrets. Let activity expire, then inventory remaining recorded rows.
2. Audit all inbound foreign keys/references to the three canary Auth/profile IDs and all recorded conversations/messages. Verify every dependent row belongs to this run and involves only canaries. **If any non-manifest conversation, relationship, message, notification or real-user reference exists, stop cleanup.** Do not delete an account whose Auth/profile cascade could affect outside data.
3. Remove only recorded canary block, activity, request and notification artifacts, using privileged cleanup restricted to exact manifest IDs and ownership assertions. Browser-role receipt DELETE is intentionally denied; never weaken RLS to clean up. No broad prefix/age-based delete or expired-message job.
4. In an approved transaction, validate D/G/N ownership/member sets and expected row IDs/counts, then delete only those recorded conversation UUIDs. Review the existing FK cascade footprint first; it must contain only manifest-created messages, memberships, reads/reactions and requests. Any mismatch or outside message/reply/pin reference aborts the transaction. No schema `CASCADE`, truncation or policy/history reset.
5. Only after all external dependencies are verified absent, delete the three exact canary Auth accounts using the supported Admin workflow and verify their profile/identity cleanup. Do not issue raw broad Auth SQL or delete by email prefix. Record partial outcomes if any Admin operation fails; stop for review rather than broadening scope.
6. Read-only verification: all recorded fixture IDs are absent, no canary activity remains, both migration versions and security definitions are unchanged, and no non-fixture row was targeted. Remove temporary credentials/tokens from the local secret store only after retaining the non-secret audit manifest/results.

Required approval scope, if desired: create the three identified accounts and D/G/N fixtures, perform only the bounded write/revocation/block/receipt/request tests above, then remove only their manifest-verified artifacts and accounts. No real users, production deployment, migration replay, RLS relaxation, private view-once enabling or unlisted media resources are included.
