// Opt-in LOCAL ONLY signed-JWT test. Does not contact hosted Supabase or create hosted users.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {schemaSQL,productionHelpers,migration,uid} from './helpers/chat-activity-fixture.js';
const enabled=process.env.FREEUPPER_LOCAL_ACTIVITY_AUTH==='1';
const origin='http://127.0.0.1:55433';
function sql(text){
 const r=spawnSync('docker',['exec','-i','fu-security-db','psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'});
 if(r.status!==0)throw new Error(r.stderr);return r.stdout;
}
test('isolated PostgREST validates signed user JWTs, actor identity and continuing-session revocation',{skip:!enabled,timeout:30000},async t=>{
 const settings=Object.fromEntries(readFileSync('/tmp/fu-security.env','utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
 function jwt(user,secret=settings.API_JWT_SECRET,expiresInSeconds=600){
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const data=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:user,role:user?'authenticated':'anon',iss:'freeupper-isolated-test',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+expiresInSeconds});
  return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');
 }
 if(process.env.FREEUPPER_LOCAL_ACTIVITY_REUSE!=='1') {
 sql(`DROP TABLE IF EXISTS public.chat_activity CASCADE;DROP TABLE IF EXISTS public.conversation_members;DROP TABLE IF EXISTS public.blocks;DROP TABLE IF EXISTS public.conversations CASCADE;
 CREATE TABLE IF NOT EXISTS realtime.messages(id uuid DEFAULT gen_random_uuid(),topic text NOT NULL,extension text NOT NULL,payload jsonb);
 ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA realtime TO anon,authenticated;
 GRANT SELECT,INSERT ON realtime.messages TO anon,authenticated;
 CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('realtime.topic',true),'') $$;\n`+schemaSQL+productionHelpers);
 sql(`INSERT INTO auth.users VALUES('${uid(1)}'),('${uid(2)}'),('${uid(3)}'),('${uid(4)}') ON CONFLICT DO NOTHING;
 INSERT INTO conversations(id,user1_id,user2_id,is_group,is_note,permissions) VALUES('${uid(10)}','${uid(1)}','${uid(2)}',false,false,DEFAULT),('${uid(11)}','${uid(1)}',NULL,true,false,DEFAULT);
 INSERT INTO conversation_members VALUES('${uid(11)}','${uid(1)}','owner'),('${uid(11)}','${uid(2)}','member'),('${uid(11)}','${uid(3)}','member');`);
 } else {
 sql("DELETE FROM public.chat_activity;DELETE FROM public.conversation_members;DELETE FROM public.blocks;DELETE FROM public.conversations;");
 sql(`INSERT INTO conversations(id,user1_id,user2_id,is_group,is_note,permissions) VALUES('${uid(10)}','${uid(1)}','${uid(2)}',false,false,DEFAULT),('${uid(11)}','${uid(1)}',NULL,true,false,DEFAULT);INSERT INTO conversation_members VALUES('${uid(11)}','${uid(1)}','owner'),('${uid(11)}','${uid(2)}','member'),('${uid(11)}','${uid(3)}','member');`);
 }
 sql(migration);sql(migration);sql("NOTIFY pgrst,'reload schema';");
 const call=async(user,path,body,token=jwt(user),method=body?'POST':'GET')=>{
  const r=await fetch(origin+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};
 };
 // Wait for the local REST schema notification (bounded, no production endpoint).
 for(let i=0;i<30;i++){
  const r=await call(uid(1),'/rpc/get_chat_activity',{p_conversation_id:uid(11)});
  if(r.status===200)break;
  if(i===29)throw new Error('Local schema cache did not refresh: '+JSON.stringify(r));
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 const args=(conv=uid(11),seq=1)=>({p_conversation_id:conv,p_source_id:uid(20),p_sequence:seq,p_event:'activity',p_kind:'recording'});
 await t.test('signed identity accepted; forged signature, anonymous and unknown user rejected',async()=>{
  assert.equal((await call(uid(1),'/rpc/publish_chat_activity',args())).status,200);
  assert.equal((await call(uid(1),'/rpc/publish_chat_activity',args(),jwt(uid(1),'wrong-isolated-secret-000000000000000'))).status,401);
  assert.equal((await call(uid(1),'/rpc/publish_chat_activity',args(),jwt(uid(1),settings.API_JWT_SECRET,-60))).status,401);
  assert.notEqual((await call(null,'/rpc/publish_chat_activity',args())).status,200);
  assert.equal((await call(uid(4),'/rpc/publish_chat_activity',args())).status,403);
 });
 await t.test('two other signed group users see server actor; payload UID and direct forgery rejected',async()=>{
  for(const user of [uid(2),uid(3)]){
   const r=await call(user,'/rpc/get_chat_activity',{p_conversation_id:uid(11)});
   assert.equal(r.status,200);assert.equal(r.data[0].user_id,uid(1));
  }
  assert.notEqual((await call(uid(1),'/rpc/publish_chat_activity',{...args(),userId:uid(2)})).status,200);
  assert.equal((await call(uid(1),'/chat_activity',{user_id:uid(2),conversation_id:uid(11)})).status,403);
 });
 await t.test('same valid JWT loses access after deletion and on a fresh request; remaining users retain access',async()=>{
  const token=jwt(uid(3));
  assert.equal((await call(uid(3),'/rpc/get_chat_activity',{p_conversation_id:uid(11)},token)).status,200);
  sql(`DELETE FROM conversation_members WHERE conversation_id='${uid(11)}' AND user_id='${uid(3)}';`);
  assert.equal((await call(uid(1),'/rpc/publish_chat_activity',args(uid(11),2))).status,200);
  assert.equal((await call(uid(3),'/rpc/get_chat_activity',{p_conversation_id:uid(11)},token)).status,403);
  assert.equal((await call(uid(3),'/chat_activity?conversation_id=eq.'+uid(11),undefined,token)).data.length,0);
  assert.equal((await call(uid(3),'/rpc/publish_chat_activity',args(uid(11),3),token)).status,403);
  assert.equal((await call(uid(2),'/rpc/get_chat_activity',{p_conversation_id:uid(11)})).status,200);
 });
 await t.test('verified HTTP users cannot exploit legacy conversation updates or the old null-owner role RPC',async()=>{
  sql(`GRANT SELECT,UPDATE ON public.conversations TO authenticated;CREATE POLICY fixture_legacy_conv ON conversations FOR ALL TO authenticated USING(true) WITH CHECK(true);`);
  try{
   assert.equal((await call(uid(4),'/conversations?id=eq.'+uid(11),{is_group:false},undefined,'PATCH')).status,403);
   assert.equal((await call(uid(2),'/conversations?id=eq.'+uid(11),{permissions:{send_messages:'admins'}},undefined,'PATCH')).status,403);
   assert.equal((await call(uid(4),'/rpc/set_member_role',{p_conversation_id:uid(11),p_target_user_id:uid(2),p_new_role:'admin'})).status,403);
   const role=await call(uid(1),'/rpc/set_member_role',{p_conversation_id:uid(11),p_target_user_id:uid(2),p_new_role:'admin'});
   assert.ok(role.status>=200&&role.status<300);
  }finally{sql('DROP POLICY fixture_legacy_conv ON public.conversations;');}
 });
 await t.test('direct-chat membership and blocking use the same signed authenticated identities',async()=>{
  assert.equal((await call(uid(1),'/rpc/publish_chat_activity',args(uid(10)))).status,200);
  assert.equal((await call(uid(2),'/rpc/get_chat_activity',{p_conversation_id:uid(10)})).status,200);
  assert.equal((await call(uid(4),'/rpc/get_chat_activity',{p_conversation_id:uid(10)})).status,403);
  sql(`INSERT INTO blocks VALUES('${uid(2)}','${uid(1)}');`);
  assert.equal((await call(uid(1),'/rpc/publish_chat_activity',args(uid(10),2))).status,403);
  assert.equal((await call(uid(2),'/rpc/get_chat_activity',{p_conversation_id:uid(10)})).status,403);
 });
 await t.test('concurrent authenticated typing/recording/media declarations preserve actors and reject revoked peers',async()=>{
  const elapsed=[];const kinds=['recording','photo','video','media'];
  await Promise.all(Array.from({length:32},async(_,i)=>{
   const user=uid(i%2+1),start=performance.now();
   const typing=i%5===0;
   const r=await call(user,'/rpc/publish_chat_activity',{...args(uid(11),100+i),
    p_event:typing?'typing':'activity',p_kind:typing?null:kinds[i%4],p_stage:typing||i%4===0?null:'uploading'});
   elapsed.push(performance.now()-start);assert.equal(r.status,200);assert.equal(typeof r.data,'boolean');
  }));
  const snapshot=await call(uid(2),'/rpc/get_chat_activity',{p_conversation_id:uid(11)});
  assert.equal(snapshot.status,200);assert(snapshot.data.length>=2);
  assert(snapshot.data.every(row=>[uid(1),uid(2)].includes(row.user_id)&&row.conversation_id===uid(11)));
  for(const user of [uid(3),uid(4)])assert.equal((await call(user,'/rpc/publish_chat_activity',args(uid(11),200))).status,403);
  elapsed.sort((a,b)=>a-b);
  console.log('Local 32-request authenticated burst, p95 '+Math.round(elapsed[Math.ceil(elapsed.length*.95)-1])+'ms; not a hosted capacity benchmark');
 });
});
