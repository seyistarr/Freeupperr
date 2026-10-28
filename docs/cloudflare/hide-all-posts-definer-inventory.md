# Production definer inventory (2026-10-28)

Read-only catalog snapshot of all 138 SECURITY DEFINER functions in public and privacy_v2_private (303 total functions). All 138 are owned by postgres. Bodies were screened for post/related-table reads, returned data, session identity and dynamic execution. This inventory records existing exposure; it is not a blanket security certification of unrelated chat, account, or marketplace workflows. No OTD/OCIDE schema is included or changed.

| Function | Search path | anon | authenticated | service_role |
|---|---|---|---|---|
| `privacy_v2_private.approved_edge(p_follower uuid, p_following uuid)` | ['search_path=""'] | no | no | yes |
| `privacy_v2_private.author_not_suspended(p_user_id uuid)` | ['search_path=""'] | yes | yes | no |
| `privacy_v2_private.enforce_protected_origin_owner()` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.enforce_restricted_release_gate()` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.enforce_test_publisher_on_post()` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.guard_protected_origin_identity()` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.guard_protected_post_media()` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.guard_protected_publisher_allowlist()` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.is_approved_protected_publisher(p_user uuid)` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.protected_metadata_guard()` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.protected_post_retirement_guard()` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.protected_publish_allowed(p_owner uuid, p_post uuid)` | ['search_path=""'] | no | no | yes |
| `privacy_v2_private.queue_protected_retirement(p_post uuid, p_owner uuid)` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.release_security_evidence_ready()` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.restricted_notification_guard()` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.sync_follow_approval()` | ['search_path=""'] | no | no | no |
| `privacy_v2_private.verification_owner_active(p_owner uuid)` | ['search_path=""'] | no | no | yes |
| `privacy_v2_private.verification_post_active(p_post uuid, p_owner uuid)` | ['search_path=""'] | no | no | yes |
| `privacy_v2_private.verification_publisher_eligible(p_owner uuid)` | ['search_path=""'] | no | no | yes |
| `public.add_view(p_post_id uuid, p_user_id uuid, p_session_id text)` | ['search_path=public'] | yes | yes | yes |
| `public.allocate_post_short_code(p_post_id uuid)` | ['search_path=""'] | no | no | no |
| `public.apply_verification_approval()` | ['search_path=public'] | yes | yes | yes |
| `public.authorize_protected_asset(p_asset uuid, p_viewer uuid)` | ['search_path=""'] | no | no | yes |
| `public.block_user(p_blocked_id uuid)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.can_send_in_conversation(p_conversation_id uuid)` | ['search_path=public'] | yes | yes | yes |
| `public.cast_chat_poll_vote(p_message_id uuid, p_option_index integer)` | ['search_path=""'] | no | yes | no |
| `public.claim_release_workflow_audit(p_run uuid)` | ['search_path=""'] | no | no | yes |
| `public.claim_verification_cleanup(p_owner uuid, p_post uuid)` | ['search_path=""'] | no | no | yes |
| `public.claim_view_once(p_message_id uuid, p_media_index integer)` | ['search_path=""'] | no | yes | no |
| `public.complete_release_workflow_audit(p_run uuid, p_passed boolean, p_result jsonb)` | ['search_path=""'] | no | no | yes |
| `public.conversation_created_by(p_conversation_id uuid, p_user_id uuid)` | ['search_path=public'] | no | yes | no |
| `public.conversation_has_any_members(p_conversation_id uuid)` | ['search_path=public'] | yes | yes | yes |
| `public.count_pending_verifications()` | UNSET | yes | yes | yes |
| `public.create_mention_notification(p_receiver_id uuid, p_post_id uuid, p_comment_id uuid)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.create_notification(p_receiver_id uuid, p_actor_id uuid, p_type text, p_post_id uuid, p_comment_id uuid)` | ['search_path=public, pg_temp'] | no | no | no |
| `public.create_original_sound_for_post(p_post_id uuid, p_audio_url text, p_art_url text, p_title text)` | ['search_path=public'] | no | yes | no |
| `public.create_post_short_link_on_insert()` | ['search_path=""'] | no | no | no |
| `public.create_protected_draft(p_owner uuid, p_post uuid, p_visibility text, p_plan jsonb, p_fields jsonb)` | ['search_path=""'] | no | no | yes |
| `public.create_verification_draft(p_owner uuid, p_post uuid, p_visibility text, p_plan jsonb, p_fields jsonb)` | ['search_path=""'] | no | no | yes |
| `public.decrement_comment_count(p_post_id uuid, p_parent_id uuid)` | ['search_path=""'] | no | no | no |
| `public.delete_comment(p_comment_id uuid)` | ['search_path=""'] | no | yes | no |
| `public.delete_comment(p_comment_id uuid, p_user_id uuid)` | ['search_path=""'] | no | yes | no |
| `public.delete_post(p_post_id uuid)` | ['search_path=""'] | no | yes | no |
| `public.edit_comment(p_comment_id uuid, p_message text)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.edit_comment(p_comment_id uuid, p_user_id uuid, p_message text)` | ['search_path=""'] | no | yes | no |
| `public.edit_post(p_post_id uuid, p_content text, p_title text, p_description text, p_category text, p_tags text[], p_visibility text)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.expire_protected_drafts()` | ['search_path=""'] | no | no | yes |
| `public.get_bookmarks()` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.get_feature_flags()` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.get_my_admin_access()` | ['search_path=""'] | no | yes | no |
| `public.get_my_private_profile()` | ['search_path=""'] | no | yes | no |
| `public.get_my_unread_message_count()` | ['search_path=""'] | no | yes | no |
| `public.get_notifications(limit_count integer, offset_count integer)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.get_or_create_invite_code(p_conversation_id uuid)` | UNSET | yes | yes | yes |
| `public.get_profile_by_freeupper_id(p_freeupper_id text)` | ['search_path=""'] | yes | yes | no |
| `public.get_profile_identity_by_id(p_user_id uuid)` | ['search_path=""'] | yes | yes | no |
| `public.get_public_post_by_short_code(p_code text)` | ['search_path=""'] | yes | yes | no |
| `public.get_public_post_seo_metadata(p_code text)` | ['search_path=""'] | yes | no | no |
| `public.get_public_profile_seo_status(p_freeupper_id text)` | ['search_path=""'] | yes | yes | no |
| `public.get_public_short_code_for_post(p_post_id uuid)` | ['search_path=""'] | yes | yes | no |
| `public.get_public_video_seo(p_code text)` | ['search_path=""'] | yes | no | no |
| `public.get_sound_stats(p_sound_id text)` | UNSET | yes | yes | yes |
| `public.get_suggestions(p_limit integer, p_offset integer)` | UNSET | yes | yes | yes |
| `public.get_unread_message_count(p_user_id uuid)` | ['search_path=""'] | no | no | yes |
| `public.get_user_settings()` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.handle_new_user()` | UNSET | yes | yes | yes |
| `public.increment_comment_count(p_post_id uuid, p_parent_id uuid)` | UNSET | yes | yes | yes |
| `public.increment_listing_views(p_listing_id uuid)` | UNSET | yes | yes | yes |
| `public.increment_sound_usage(p_sound_id text)` | UNSET | yes | yes | yes |
| `public.increment_view_count(post_id bigint)` | UNSET | yes | yes | yes |
| `public.is_admin()` | ['search_path=""'] | no | yes | no |
| `public.is_admin_user(uid uuid)` | ['search_path=""'] | no | yes | no |
| `public.is_blocked_between(p_user_a uuid, p_user_b uuid)` | ['search_path=public'] | no | yes | no |
| `public.is_conversation_member(conv_id uuid, uid uuid)` | ['search_path=public'] | yes | yes | yes |
| `public.is_member_of_conversation(p_conversation_id uuid)` | ['search_path=public'] | yes | yes | yes |
| `public.is_owner_or_admin_of_conversation(p_conversation_id uuid)` | ['search_path=public'] | yes | yes | yes |
| `public.join_group_via_code(p_invite_code text)` | UNSET | yes | yes | yes |
| `public.list_admin_profiles()` | ['search_path=""'] | no | yes | no |
| `public.list_deleted_posts()` | ['search_path=""'] | no | yes | no |
| `public.list_my_sessions_admin(p_user_id uuid)` | ['search_path=auth, public'] | no | no | yes |
| `public.list_public_post_sitemap(p_after text, p_limit integer)` | ['search_path=""'] | yes | no | no |
| `public.list_verification_posts(p_owner uuid)` | ['search_path=""'] | no | no | yes |
| `public.log_audit(p_action text, p_target_type text, p_target_id uuid, p_ip text, p_user_agent text)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.mark_all_notifications_read()` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.mark_notification_read(p_notification_id bigint)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.mute_user(p_muted_id uuid)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.notify_comment_like()` | ['search_path=public, pg_temp'] | yes | yes | yes |
| `public.notify_new_comment()` | ['search_path=public, pg_temp'] | yes | yes | yes |
| `public.notify_new_message()` | UNSET | yes | yes | yes |
| `public.notify_new_social_notification()` | ['search_path=""'] | no | no | no |
| `public.notify_post_like()` | ['search_path=public, pg_temp'] | yes | yes | yes |
| `public.notify_repost()` | ['search_path=public, pg_temp'] | yes | yes | yes |
| `public.parse_mentions(p_post_id uuid, p_content text)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.permanent_post_readable(p_post uuid, p_owner uuid)` | ['search_path=""'] | no | yes | no |
| `public.permanently_delete_post(p_post_id uuid)` | ['search_path=""'] | no | yes | no |
| `public.privacy_release_status()` | ['search_path=""'] | yes | yes | yes |
| `public.privacy_v2_approved_edge(p_follower uuid, p_following uuid)` | ['search_path=""'] | no | yes | no |
| `public.privacy_v2_test_publisher_allowed(p_user uuid)` | ['search_path=""'] | no | no | yes |
| `public.protect_profile_identity_fields()` | ['search_path=""'] | no | no | no |
| `public.protect_profile_privileged_columns()` | UNSET | no | no | no |
| `public.protected_cleanup_worker_authorized(p_token text)` | ['search_path=""'] | no | no | yes |
| `public.protected_first_capabilities()` | ['search_path=""'] | no | no | yes |
| `public.protected_first_release_status()` | ['search_path=""'] | no | no | yes |
| `public.protected_media_release_allowed(p_asset uuid)` | ['search_path=""'] | no | no | yes |
| `public.protected_publisher_beta_allowed(p_user uuid)` | ['search_path=""'] | no | no | yes |
| `public.protected_publishing_access(p_owner uuid, p_post uuid)` | ['search_path=""'] | no | no | yes |
| `public.protected_publishing_capabilities()` | ['search_path=""'] | no | no | yes |
| `public.protected_studio_beta_status()` | ['search_path=""'] | no | yes | no |
| `public.publish_restricted_text(p_owner uuid, p_post uuid, p_visibility text, p_fields jsonb, p_template text)` | ['search_path=""'] | no | no | yes |
| `public.record_protected_security_audit(p_results jsonb)` | ['search_path=""'] | no | no | yes |
| `public.record_share(p_post_id uuid, p_user_id uuid)` | ['search_path=public, pg_temp'] | yes | yes | yes |
| `public.release_audit_relationships()` | ['search_path=""'] | no | no | yes |
| `public.report_content(p_target_type text, p_target_id uuid, p_reason text)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.resolve_join_request(p_request_id uuid, p_approve boolean)` | UNSET | yes | yes | yes |
| `public.restore_post(p_post_id uuid)` | ['search_path=""'] | no | yes | no |
| `public.retire_verification_post(p_owner uuid, p_post uuid)` | ['search_path=""'] | no | no | yes |
| `public.revoke_my_session(p_session_id uuid)` | ['search_path=auth, public'] | yes | yes | yes |
| `public.revoke_other_sessions(current_session_id uuid)` | ['search_path=auth, public'] | yes | yes | yes |
| `public.rls_auto_enable()` | ['search_path=pg_catalog'] | yes | yes | yes |
| `public.search_posts(query text, limit_count integer)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.set_member_role(p_conversation_id uuid, p_target_user_id uuid, p_new_role text)` | UNSET | yes | yes | yes |
| `public.sync_sound_usage()` | ['search_path=""'] | yes | yes | yes |
| `public.toggle_bookmark(p_post_id uuid)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.toggle_bookmark(p_post_id uuid, p_user_id uuid)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.toggle_comment_like(p_comment_id uuid)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.toggle_comment_like(p_comment_id uuid, p_user_id uuid)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.toggle_follow_with_notification(p_target_id uuid)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.toggle_like(p_post_id bigint, p_user_id uuid)` | ['search_path=""'] | no | yes | no |
| `public.toggle_pin_comment(p_comment_id uuid, p_user_id uuid)` | ['search_path=""'] | no | yes | no |
| `public.toggle_post_like(p_post_id uuid)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.toggle_repost(p_post_id uuid, p_comment text)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.toggle_repost(p_post_id uuid, p_user_id uuid, p_comment text)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.unblock_user(p_blocked_id uuid)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.unmute_user(p_muted_id uuid)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.update_avatar(p_avatar_url text)` | UNSET | yes | yes | yes |
| `public.update_group_info(p_conversation_id uuid, p_name text, p_description text, p_avatar text)` | UNSET | yes | yes | yes |
| `public.update_user_setting(p_key text, p_value text)` | ['search_path=public, pg_temp'] | no | yes | no |
| `public.verification_post_readable(p_post uuid, p_owner uuid)` | ['search_path=""'] | no | yes | no |
