-- SELECT-only review script. Does not alter production or read chat message contents.
SELECT table_schema,table_name,column_name,data_type,is_nullable,column_default
FROM information_schema.columns
WHERE (table_schema='public' AND table_name IN ('conversations','conversation_members','blocks','chat_activity','view_once_consumptions'))
   OR (table_schema='realtime' AND table_name='messages')
ORDER BY table_schema,table_name,ordinal_position;
SELECT * FROM pg_policies
WHERE schemaname='realtime' OR (schemaname='public' AND tablename IN ('conversations','conversation_members','blocks','chat_activity'));
SELECT n.nspname,p.proname,p.prosecdef,p.proacl,p.proconfig,pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prokind='f' AND n.nspname IN ('public','chat_activity_private')
 AND p.proname IN ('is_blocked_between','can_send_in_conversation','set_member_role','can_use_chat_activity','can_join_chat_activity','can_read_chat_activity','publish_chat_activity','get_chat_activity');
SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relreplident
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='realtime' AND c.relname='messages') OR (n.nspname='public' AND c.relname IN ('conversations','conversation_members','chat_activity'));
SELECT pubname,puballtables,pubowner::regrole FROM pg_publication WHERE pubname='supabase_realtime';
SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime';
SELECT * FROM information_schema.role_table_grants WHERE (table_schema='realtime' AND table_name='messages') OR (table_schema='public' AND table_name IN ('conversation_members','chat_activity'));
