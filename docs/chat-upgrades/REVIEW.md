> Historical implementation report for commit `7528928`. Security findings, corrected migration, current transport and release gates are superseded by [SECURITY-HARDENING.md](SECURITY-HARDENING.md).

# FreeUpper exact chat replacements — review package

**Recommendation: NO-GO for production.** Implementation is on local feature branch `feature/chat-exact-replacements`, based on freshly fetched main `4a19c659a1928b4d1ad39938ed05c5e7931f2d0b`. No push, merge, deployment, production SQL writes, staging writes, or production data changes were performed.

## Approved replacement implementation

The A1–A2, J1–J11, Round 3, K1–K10 and Fix 7 blocks pasted into the task were consulted directly. No separate uploaded replacement documents were present in the workspace. These pasted blocks are the baseline.

| Supplied section | Implementation |
| --- | --- |
| A1–A2 | All four existing filters retained; scroll wrapper, buttons, tab IDs, roving tabindex, panel labelling. Same SVGs and labels. |
| J1 | 32 playback waveform bars. |
| J2–J3 | Sending clock, single sent tick, purple read double tick, white chip on coloured bubbles; last-message query already includes recipient read rows. No delivered state added. |
| J4, J6–J8 | Shared reply info/thumbnail/quote builders, mixed media, image groups, video badges, captions, sender names, voice/document/poll descriptions, unavailable originals, cancel and jump. View-once previews reveal no thumbnail. |
| J5 | Deduplicate by ID, stable timestamp ordering, one static separator per local day using existing `dayLabel`. |
| J9–J11 | Count sync, active-tab reveal, horizontal wheel/scroll buttons, manual keyboard activation with arrows/Home/End and native Enter/Space. Composer/search keys remain independent. |
| Round 3 | Supplied final CSS block, with requested obsolete rules removed. Original underlying grid structure, play controls, shared media/poll surfaces, reactions and caption markup remain. |
| K1–K3 | Supplied activity kinds, wording, icons, 3-second heartbeat, 7-second remote expiry, private topic, participant filtering, polite activity bar between messages and composer, activity in header. |
| K4–K6 | Clear on message arrival, conversation close and recording stop; recording activity starts after recording actually starts. |
| K7–K8 | Mixed-media upload activity starts only on Send; real XHR progress, weighted across files; persistent progress on originating temporary message. |
| K9 | Existing disabled private view-once path retains activity with no invented percentage. Legacy Cloudinary view-once remains enabled as before. |
| K10, Fix 7 | Page-hide cleanup, supplied activity/progress CSS and reduced-motion rules. |

Existing composer, conversation cards/3D ordering, All/Unread/Groups/Requests filtering, request RPC gate, galleries, captions, polls/votes, reactions, groups, voice playback, disappearing messages, authentication and privacy feature flags remain. The UI is not redesigned.

## Changed files

| Files | Purpose |
| --- | --- |
| `chat.html` | A1/A2 markup, requested CSS removals, Round 3/Fix 7 styles, script cache version. |
| `chat.js` | J1–J11/K1–K10, destination/reply/progress/session guards and accessible reply jumps. |
| `service-worker.js` | Refresh precached chat assets for an eventual approved rollout. |
| `supabase/migrations/20261116172043_chat_activity_authorization.sql` | Review-only, idempotent private activity authorization. |
| `tests/chat-upgrades-browser.test.js`, `tests/chat-activity-database.test.js` | New browser and isolated SQL regression coverage. |
| `tests/chat-identity-integration.test.js`, `tests/chat-premium-browser.acceptance.mjs`, `tests/ui-sounds.test.js` | Keep existing assertions compatible with activity dependencies and cache version. |
| `docs/chat-upgrades/*` | Implementation/security report, catalog evidence, test results and rollback SQL. |

## Small compatibility and integration adjustments

1. **Immutable destinations:** `sendMessageToConv` accepts a captured conversation ID. Media, legacy image/video/document helpers and voice recording pass it through uploads and DB writes. Text/lightbox/poll completion callbacks update their captured conversation. Background completion does not render in a different selected room. Retry carries the message's original conversation ID.
2. **Media reply links:** capture reply ID before composer close, include it in optimistic messages and final media inserts (including legacy view-once). Private upload has no verified reply contract; after publication its own message is updated through existing authenticated message RLS and the returned reply link is checked. This path stays disabled. Do not enable until the backend is present and this non-atomic compatibility fallback is tested.
3. **Activity ownership:** sender operations capture their channel, conversation and session. A finished/cancelled old upload cannot stop a newer operation. Old subscription callbacks are rejected. Channel setup is guarded after awaited removal, member lookup and authentication. Empty/failed group membership lookup denies activity.
4. **Receiver races:** per-user, per-event versions invalidate delayed profile reads after stop, new events, message receipt or disconnect. TTL starts at event receipt, not profile-fetch completion. Membership is rechecked after profile fetch.
5. **Navigation races:** selection and message loading check their captured session after awaits. Poll/view-once lookup results cannot overwrite another room. Recording is cancelled on navigation; late microphone grants release their tracks. Recording chunks, recorder and destination belong to that recording.
6. **Pending upload state:** a map retains uploads across navigation/reloads. Progress mutates only its originating message and updates the DOM only in its room. AbortSignal support aborts Cloudinary XHRs; failure aborts sibling uploads. `cancelMediaUpload(id)` is available without adding an unrelated composer redesign. Page hide aborts pending Cloudinary media uploads. Closing the picker before Send starts no activity. Already committed DB writes cannot be undone by cancellation.
7. **Receipts:** the read chip says "Seen by a recipient" so one group reader is not presented as all members having read. Raw recipient-specific `message_reads` remain intact. No new all-read or delivered semantics are inferred.
8. **Accessibility/security:** reply jumps accept Enter/Space and reduced motion. Thumbnail/avatar attribute values and message selectors are escaped. Activity send promise failures are handled. Mixed-media header says "Sending media…". Private upload pending label says "Sending…", never a percentage.
9. **Disconnect behavior:** remote indicators clear on channel error/close/timeout. Broadcasts pause while disconnected; a still-running operation is announced again after successful resubscription. CLOSED terminates the local operation, and stale callbacks cannot revive it. New activity/typing is accepted after reconnect. Remote hard-close/network silence still expires after 7 seconds.
10. **Cache compatibility:** chat script URL and service-worker version/precache entry updated together. Existing isolated test fixtures now include activity dependencies and recognize the new script version.

Whitespace and attribute order may differ from pasted HTML; behavior, values and supplied SVG artwork are preserved. The final supplied Round 3 and Fix 7 CSS are used as the baseline without a substitute theme.

## Actual production database comparison (read-only)

Project: **FreeUpper**, `jmjtqidirpmnegzvmiaq`, Postgres **17.6.1.141**, inspected 2026-11-16. The separate **Freeupperr Staging** project was discovered but not modified. Catalog evidence is in `production-schema-readonly.json`; this contains metadata, not user messages or membership records.

- `public.conversations`: UUID PK; nullable UUID `user1_id`, `user2_id`; nullable booleans `is_group`, `is_note`; JSONB `permissions`; UUID owner/creator; direct participant FKs. The supplied basic column names match.
- `public.conversation_members`: UUID conversation/user columns, unique `(conversation_id,user_id)`, conversation FK with ON DELETE CASCADE, profile FK, text role. No `removed_at` column: revocation means deleting membership.
- Both tables have RLS. Conversation SELECT distinguishes groups, direct chats and notes. Member SELECT uses existing membership helpers. The migration does not replace their policies.
- **Blocking uses `public.blocks` and `public.is_blocked_between(uuid,uuid)`**, not the legacy `blocked_users` table. Existing direct-message INSERT checks that helper. Group INSERT checks current membership and `can_send_in_conversation`.
- `realtime.messages`: RLS enabled, broadcast extension is text, expected payload/topic columns exist. Authenticated SELECT and INSERT grants already exist. **No existing Realtime RLS policies** were returned by the catalog inspection. Thus private activity would be refused until separately approved SQL is applied.
- `messages` has `reply_to`, JSONB `metadata`, media arrays, integer `voice_duration`. There is no `delivered_at`. `message_reads` has `(message_id,user_id,read_at)`; the client uses these actual reader rows.
- Existing message triggers notify push, set disappearing expiry and update conversation metadata. Their definitions were inspected and are untouched.
- Production migration history inspected: latest recorded version `20261112174353`, `google_signup_display_name`; older `chat_poll_voting` exists. The repository does not contain the full legacy production chat DDL. No existing `can_use_chat_activity` function was found. No `chat_respond_to_request` function was returned; the existing UI's request transition stays fail-closed.
- Postgres Changes publication includes conversations, messages, message_reads, message_reactions and conversation_members. Publication membership does not authorize private Broadcast by itself.
- The frontend uses the authenticated shared Supabase client through `https://api.freeupper.com`. Existing gateway code preserves WebSocket upgrades and authentication. The new setup explicitly awaits `sb.realtime.setAuth()` and uses `config.private: true`; there is no public-topic fallback.
- The production Edge Function list has **no `chat-private-upload`**. The existing private view-once feature flag remains false; no missing backend was deployed.

**Configuration limit:** available Supabase tools exposed catalog queries and project metadata but not the hosted Realtime public/private settings or JWT expiry configuration. Those settings have not been independently verified. Authenticated live WebSocket access through the production gateway was not tested, because there are no isolated test credentials and production writes are prohibited.

## SQL changes and their reasons

Review migration: `supabase/migrations/20261116172043_chat_activity_authorization.sql`, generated using `supabase migration new`, never executed against a hosted project.

- Validate the exact `chat-activity:<canonical UUID>` shape before casting; malformed topic, null UID, note and missing conversation return false. Avoid broad exception swallowing.
- Match the production direct/group distinction: direct participants plus no block; groups require an existing membership, even if a removed member's UUID remains in `user1_id`.
- Receive allows current group members; broadcast send additionally respects existing group admin-only send permission.
- Put the required RLS-bypassing membership lookup in a private schema as a tightly scoped SECURITY DEFINER, fixed empty search path, qualified objects and explicit `auth.uid()`. Keep the approved public function name as SECURITY INVOKER. Revoke PUBLIC/anon execution; grant only authenticated schema usage and execution. No user-supplied identity parameter or dynamic SQL.
- Add SELECT/INSERT permissive policies using `realtime.topic()` and the broadcast extension, matching Supabase channel authorization probes.
- Add namespace-scoped **restrictive** authenticated send/receive guards and an anon guard, so another permissive policy cannot OR away the activity boundary. Other namespaces are not restricted by these guards.
- Named policy drop/recreate and function replacement are transactional and repeatable. Preflight checks require RLS, both existing grants and existing production authorization helpers. No production tables, conversation rows or message rows are changed. Do not modify the managed Realtime schema except supported policies.

## Security boundaries and unresolved blockers

**Immediate connected-member revocation is not provided by these SQL policies.** Supabase caches channel authorization at join and token update. Deleting group membership prevents the next join/authorization check, but a malicious connected removed member can continue receiving until reauthorization or JWT expiry. Local tests prove DB revocation, not live-socket ejection. A client membership listener or forced client rejoin would only protect cooperative clients. Before GO, verify a server-enforced ejection/revocation mechanism or approve a server-authorized relay/topic rotation design and test it with connected removed users.

**Broadcast identity is not authenticated by membership RLS.** A participant can set another allowed participant's `payload.userId`. Client allowlists reduce arbitrary unknown names but do not prove who sent an event. Activity stays cosmetic; no messages, read receipts or authorization decisions trust it. A server relay is needed if verifiable sender identity is required. Do not add a payload-UID RLS expression and assume it runs for each cached WebSocket message.

**Existing database risks, unchanged:** production `message_reads` SELECT includes a permissive `true` policy and its INSERT policy only compares user ID. The inspected policy does not itself require message participation; receipt privacy/integrity needs a separate authorized backend audit. Existing `set_member_role` has an unset search path and a `v_caller_role != 'owner'` null check that merits review; no exploit was attempted. Existing conversation UPDATE policies are broad, explaining the preserved request RPC gate. These are recorded rather than silently rewritten in a Realtime migration.

The isolated migration test does not model Supabase's WebSocket service, authorization cache, hosted settings or billing. No production security guarantee is inferred from a local SQL test alone.

## Validation and remaining work

See `TEST-RESULTS.md` for exact commands and results. Browser automation uses the actual chat HTML, styles and JavaScript with external requests blocked, initialization replaced with an isolated fixture seam, fake DB/upload adapters and synthetic recorder/XHR objects. Real production requests, physical microphones and mobile OS behavior are not exercised.

Before approval for production: verify hosted Realtime settings/JWT expiry and revocation strategy; run two-account direct and three-account group tests on an isolated hosted backend with the proposed migration; test non-member joins, connected removal, blocked users, private-channel reconnects and permissions; verify real Cloudinary failure/cancellation and concurrent sends; verify private view-once backend before enabling it. Perform physical iPhone Safari, Android Chrome and installed-PWA tests, plus Firefox/WebKit accessibility and VoiceOver/TalkBack checks. Image decode/layout shifts without stored dimensions remain a pre-existing limitation. English activity text remains as supplied.

## Rollback and deployment gate

`rollback.REVIEW.sql` removes only this migration's policies/functions, preserving all messages/conversations and unrelated policies. The private schema is deliberately left in place rather than using CASCADE. First roll back/disable the new frontend activity, terminate or reauthorize existing sockets on the server, then apply the reviewed rollback only after explicit approval. A function/policy drop alone does not eject cached connections. With the inspected production baseline of zero Realtime policies, dropping these policies returns private activity to default deny. Recheck policy inventory if anything changes before rollout.

Frontend rollback restores the previous chat HTML/JS and service-worker assets from the base commit, with a new cache version rather than reusing an old worker cache. No application data rollback is needed.

**Stop here:** no automatic merge, frontend deploy, Cloudflare action or production SQL execution. The branch and migration are ready for code review; production remains NO-GO for the blockers above.
