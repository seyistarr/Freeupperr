# FreeUpper production post authorization — read-only audit

**Review only. No SQL executed that changes data, policy or functions.** Production project `jmjtqidirpmnegzvmiaq`. Do not use OTD/OCIDE staging for FreeUpper tests.

## Verified via read-only PostgreSQL catalog queries

- `posts.visibility` is nullable text with default `'public'::text`.
- Four permissive `posts` SELECT policies — `Anyone can view posts`, `Enable read access for all users`, `Posts are viewable by everyone`, and `Public read posts` — all use `USING (true)`. Permissive policies combine with OR, so adding a restrictive audience policy without replacing/bounding these does **not** secure restricted posts.
- `Users can manage own posts` is a permissive FOR ALL policy using `auth.uid() = user_id`; owner access needs deliberate handling in any replacement.
- Insert and update policies permit own-row operations based on `auth.uid() = user_id`; they do not constrain `visibility` to `public`.
- `edit_post(p_post_id uuid, p_content text, p_title text, p_description text, p_category text, p_tags text[], p_visibility text)` is SECURITY DEFINER. The final argument defaults to `'public'` and UPDATE uses `visibility = COALESCE(p_visibility, visibility)`. Calls omitting visibility therefore set it to public. The function checks ownership but does not validate audience or protected-media state.
- `record_share(p_post_id uuid,p_user_id uuid)` is SECURITY DEFINER and inserts using the supplied `p_user_id` without verifying it equals `auth.uid()` or that the post is viewable.
- `search_posts(query text,limit_count integer)` is SECURITY DEFINER; it filters `p.visibility='public'` and `p.is_deleted=false` but does not enforce author private-account rules or `p.is_hidden`.

## Risks and safe release constraints

1. Existing direct Supabase clients/RPC callers can bypass browser-only audience gates. **Do not claim restricted publishing is secure**.
2. For a public-only interim release, add a *separately tested* database-level guard that prevents new restricted post inserts and changes to restricted visibility, while preserving legacy restricted rows and legitimate edits to them. The precise implementation must be checked against all writers and existing data; do not simply overwrite all rows to public.
3. A complete protected-audience release requires replacing overlapping SELECT policies atomically, checking all privileged functions and media delivery, and testing owner, follower, mutual, stranger and private-author scenarios.
4. Do not change production RLS/functions without a rollback plan, independent staging tests and explicit owner approval.

## Proposed test matrix

- Anonymous and stranger read of public post from public author.
- Anonymous and stranger cannot read public-labeled post from private author (per agreed privacy semantics).
- Owner sees own posts, including Only Me; follower sees Followers; mutual sees Friends; stranger sees neither.
- Unapproved/revoked follower loses access.
- Existing public image/video/text uploads and feed/search/profile continue to work.
- Omitted `p_visibility` in edit_post does not silently change audience.
- record_share rejects impersonation and unauthorized post access.
- search_posts does not leak hidden, private-author or restricted posts.
- No direct insert/update can publish public Cloudinary media with a restricted visibility label.

## Immediate status

**Blocked for main.** Cloudinary CI tests are not equivalent to database policy integration or real end-to-end playback tests. Do not merge the experimental review branch wholesale.
