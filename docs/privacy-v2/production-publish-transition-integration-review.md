# Protected publishing transaction — production integration review

Status: **review only; not approved for activation**.

Reviewed against production Supabase project `jmjtqidirpmnegzvmiaq` and `docs/privacy-v2/protected-publish-transition-REVIEW.sql`.

## Verified schema

`public.post_upload_intents` has `post_id`, `owner_id`, `slot`, `cloudinary_public_id`, `resource_type`, `asset_id`, `state`, `cleanup_pending`, `cleanup_attempts`, `cleanup_after`, `created_at`.

`public.post_media_assets` has `id`, `post_id`, `owner_id`, `cloudinary_asset_id`, `cloudinary_public_id`, `resource_type`, `format`, `delivery_type`, `status`.

## Mandatory changes before replacing the disabled placeholder

1. Check the production release status **before any action**, including `cancel`, `reserve`, `register`, and `publish`. Require both `publishing=true` and `delivery=true`, plus the intended capabilities contract. No staging-only bypass.
2. Require a matching `privacy_v2_private.protected_post_origins` record for `p_post,p_owner`, with row locking, before touching intents, assets, or posts.
3. Keep the function `SECURITY INVOKER`, grant only `service_role`, and require server-side authenticated identity verification against `p_owner`; `p_owner` is not proof of ownership.
4. Validate `p.media_plan` with `privacy_v2_private.valid_protected_media_plan` before reservation and publication. The valid video plan uses **two slots**: video slot 0 and poster slot 20, but produces **one media reference**.
5. Ensure every registered asset matches the reserved public ID, owner, post, resource type, authenticated delivery, and Cloudinary verification completed by the API.
6. Publishing must atomically assemble registry-backed media references and update `publishing_state` / `is_hidden`; the protected-media trigger must accept exactly that reference shape.
7. Verify the new draft creator and `freeupper_public_only_guard_trigger` compatibility before any activation. The current public-only guard still rejects restricted INSERTs; merely toggling a release flag is not sufficient.
8. Review cancellation and cleanup semantics so published media cannot be cancelled and unregistered uploads cannot remain indefinitely accessible.
9. Keep `protected_first_release_status().publishing=false`, `delivery=false` and the public-only guard until end-to-end integration and security review are complete.

No production publishing transaction was activated by this review.
