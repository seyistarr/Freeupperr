-- PROPOSED ONLY: do not deploy without synthetic authenticated RLS tests.
-- Addresses the permissive SELECT(true) policies found on 2026-11-10.
-- Separate from request-state migration so the permission diff is auditable.
begin;

drop policy if exists "members can view reads" on public.message_reads;
drop policy if exists "reads_select_policy" on public.message_reads;
create policy "chat_participants_can_view_reads"
  on public.message_reads for select to authenticated
  using (exists (
    select 1
    from public.messages m
    join public.conversations c on c.id=m.conversation_id
    where m.id=message_reads.message_id
      and (
        (coalesce(c.is_note,false) and c.owner_id=(select auth.uid()))
        or (coalesce(c.is_group,false) and not coalesce(c.is_note,false) and
            exists (select 1 from public.conversation_members cm
                    where cm.conversation_id=c.id and cm.user_id=(select auth.uid())))
        or (not coalesce(c.is_group,false) and not coalesce(c.is_note,false) and
            (c.user1_id=(select auth.uid()) or c.user2_id=(select auth.uid())) and
            not public.is_blocked_between(c.user1_id,c.user2_id))
      )
  ));

drop policy if exists "members can view reactions" on public.message_reactions;
drop policy if exists "reactions_select_policy" on public.message_reactions;
create policy "chat_participants_can_view_reactions"
  on public.message_reactions for select to authenticated
  using (exists (
    select 1
    from public.messages m
    join public.conversations c on c.id=m.conversation_id
    where m.id=message_reactions.message_id
      and (
        (coalesce(c.is_note,false) and c.owner_id=(select auth.uid()))
        or (coalesce(c.is_group,false) and not coalesce(c.is_note,false) and
            exists (select 1 from public.conversation_members cm
                    where cm.conversation_id=c.id and cm.user_id=(select auth.uid())))
        or (not coalesce(c.is_group,false) and not coalesce(c.is_note,false) and
            (c.user1_id=(select auth.uid()) or c.user2_id=(select auth.uid())) and
            not public.is_blocked_between(c.user1_id,c.user2_id))
      )
  ));

commit;

-- TEST GATE:
-- A and B in DM: both see receipts/reactions for that DM.
-- C not in DM: sees zero rows.
-- Group member sees the group's receipts/reactions; ex-member/nonmember sees zero.
-- My Note: only owner sees receipts/reactions.
-- Verify anonymous access sees zero.
-- Check for performance regression and RLS-policy recursion on nested messages.
-- NOTE: This file does not remediate existing conversation UPDATE policies or
-- unrelated grants; do not treat it as the complete chat security rollout.
