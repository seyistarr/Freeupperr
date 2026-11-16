import {readFileSync} from 'node:fs';
export const migration=readFileSync('supabase/migrations/20261116172043_chat_activity_authorization.sql','utf8');
export const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const catalog=JSON.parse(readFileSync('docs/chat-upgrades/production-hardening-readonly.json','utf8')).catalog;
export const productionHelpers=['is_blocked_between','can_send_in_conversation'].map(name=>catalog.find(x=>x.section==='functions').detail.find(x=>x.proname===name).definition.trim()+';').join('\n');
export const schemaSQL=`
CREATE TABLE public.conversations(id uuid PRIMARY KEY,user1_id uuid,user2_id uuid,is_group boolean DEFAULT false,is_note boolean DEFAULT false,owner_id uuid,created_by uuid,permissions jsonb DEFAULT '{"send_messages":"everyone"}');
CREATE TABLE public.conversation_members(conversation_id uuid REFERENCES conversations(id),user_id uuid,role text,UNIQUE(conversation_id,user_id));
CREATE TABLE public.blocks(blocker_id uuid,blocked_id uuid);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.conversation_members TO authenticated;
CREATE POLICY fixture_members_self ON public.conversation_members FOR SELECT TO authenticated USING(user_id=auth.uid());
`;
export async function setup(db){
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA realtime;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth,realtime TO anon,authenticated;
 CREATE TABLE realtime.messages(id uuid DEFAULT gen_random_uuid(),topic text NOT NULL,extension text NOT NULL,payload jsonb);
 ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT ON realtime.messages TO anon,authenticated;
 CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('realtime.topic',true),'') $$;
 CREATE PUBLICATION supabase_realtime;`);
 await db.exec(schemaSQL+productionHelpers);
 await db.exec(`INSERT INTO auth.users VALUES('${uid(1)}'),('${uid(2)}'),('${uid(3)}'),('${uid(4)}');
 INSERT INTO conversations(id,user1_id,user2_id,is_group,is_note,permissions) VALUES('${uid(10)}','${uid(1)}','${uid(2)}',false,false,DEFAULT),
 ('${uid(11)}','${uid(1)}',NULL,true,false,DEFAULT),('${uid(12)}','${uid(1)}',NULL,false,true,DEFAULT);
 INSERT INTO conversation_members VALUES('${uid(11)}','${uid(1)}','owner'),('${uid(11)}','${uid(2)}','member'),('${uid(11)}','${uid(3)}','member');`);
 await db.exec(migration);
}
export async function asUser(db,user,sql,args=[],role='authenticated'){
 await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${user||''}',false);`);
 try{return await db.query(sql,args);}finally{await db.exec('RESET ROLE');}
}
export const publish=(db,user,conv=uid(11),sequence=1,extra={})=>asUser(db,user,
 'SELECT public.publish_chat_activity($1,$2,$3,$4,$5,$6,$7,$8) AS accepted',
 [conv,extra.source||uid(20),sequence,extra.event||'activity',extra.kind===undefined?'recording':extra.kind,extra.stage||null,extra.plural||false,extra.active??true]);
