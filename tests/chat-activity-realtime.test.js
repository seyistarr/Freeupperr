// LOCAL ONLY. Run after chat-activity-authenticated.test.js has initialized the isolated DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import WebSocket from 'ws';
import {uid,migration} from './helpers/chat-activity-fixture.js';
const enabled=process.env.FREEUPPER_LOCAL_ACTIVITY_REALTIME==='1';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function sql(text){const r=spawnSync('docker',['exec','-i','fu-security-db','psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr);return r.stdout;}
test('real local Supabase Realtime rejects obsolete private channels and rechecks membership on continuing sockets',{skip:!enabled,timeout:60000},async t=>{
 const settings=Object.fromEntries(readFileSync('/tmp/fu-security.env','utf8').trim().split('\n').map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const jwt=user=>{const data=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:user,role:'authenticated',iss:'freeupper-isolated-test',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600});return data+'.'+createHmac('sha256',settings.API_JWT_SECRET).update(data).digest('base64url');};
 sql(migration);
 sql(`DELETE FROM public.chat_activity WHERE source_id='${uid(30)}';
 ALTER TABLE realtime.messages ADD COLUMN IF NOT EXISTS event text, ADD COLUMN IF NOT EXISTS private boolean DEFAULT false, ADD COLUMN IF NOT EXISTS inserted_at timestamp DEFAULT now(), ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
 INSERT INTO conversation_members VALUES('${uid(11)}','${uid(3)}','member') ON CONFLICT DO NOTHING;
 UPDATE conversations SET permissions='{"send_messages":"everyone"}' WHERE id='${uid(11)}';DELETE FROM blocks;`);
 const sockets=[];
 async function subscribe(user,conv=uid(11),privateChannel=false,overrideTopic=null){
  const token=jwt(user),packets=[],rows=[];
  const topic=overrideTopic||(privateChannel?'chat-activity:':'chat-activity-db:')+conv;
  const socket=new WebSocket('ws://127.0.0.1:55434/socket/websocket?apikey='+token+'&vsn=1.0.0',{headers:{Host:'realtime-dev.localhost'}});
  sockets.push(socket);
  socket.on('message',raw=>{const p=JSON.parse(raw.toString());packets.push(p);if(p.event==='postgres_changes'&&p.payload.data.type!=='DELETE')rows.push(p.payload.data.record);});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  socket.send(JSON.stringify({topic:'realtime:'+topic,event:'phx_join',ref:'1',payload:{access_token:token,config:{private:true,broadcast:{self:false},presence:{key:''},postgres_changes:privateChannel?[]:[{event:'*',schema:'public',table:'chat_activity',filter:'conversation_id=eq.'+conv}]}}}));
  for(let i=0;i<100;i++){
   const failure=packets.find(p=>p.event==='phx_reply'&&p.payload.status==='error');
   if(failure)return {socket,packets,rows,refused:true};
   if(privateChannel&&packets.some(p=>p.event==='phx_reply'&&p.payload.status==='ok'))return {socket,packets,rows,refused:false};
   if(packets.some(p=>p.event==='system'&&p.payload.extension==='postgres_changes'&&p.payload.status==='ok'))return {socket,packets,rows,refused:false};
   await wait(100);
  }
  throw new Error('Local Realtime subscription did not initialize: '+JSON.stringify(packets));
 }
 const publish=async(kind,seq,conv=uid(11))=>{
  const r=await fetch('http://127.0.0.1:55433/rpc/publish_chat_activity',{method:'POST',headers:{Authorization:'Bearer '+jwt(uid(1)),'Content-Type':'application/json'},body:JSON.stringify({p_conversation_id:conv,p_source_id:uid(30),p_sequence:seq,p_event:'activity',p_kind:kind})});
  const text=await r.text();assert.equal(r.status,200,text);assert.equal(JSON.parse(text),true,'fresh source sequence must be accepted');
 };
 const until=async predicate=>{for(let i=0;i<60;i++){if(predicate())return;await wait(100);}assert.ok(predicate(),'Expected authorized Realtime event');};
 try{
  await t.test('baseline private Broadcast caches revocation and accepts a forged payload UID (isolated namespace only)',async()=>{
   const topic='fixture-cached:'+uid(11);
   sql(`CREATE POLICY fixture_cached_receive ON realtime.messages FOR SELECT TO authenticated USING(extension='broadcast' AND realtime.topic()='${topic}' AND public.can_read_chat_activity('${uid(11)}'));
    CREATE POLICY fixture_cached_send ON realtime.messages FOR INSERT TO authenticated WITH CHECK(extension='broadcast' AND realtime.topic()='${topic}' AND public.can_read_chat_activity('${uid(11)}'));`);
   try{
    const sender=await subscribe(uid(1),uid(11),true,topic),receiver=await subscribe(uid(3),uid(11),true,topic);
    assert.equal(sender.refused,false);assert.equal(receiver.refused,false);
    const send=kind=>sender.socket.send(JSON.stringify({topic:'realtime:'+topic,event:'broadcast',ref:'2',payload:{type:'broadcast',event:'activity',payload:{userId:uid(2),kind}}}));
    send('photo');await until(()=>receiver.packets.some(p=>p.event==='broadcast'&&p.payload.payload.kind==='photo'));
    const packet=receiver.packets.find(p=>p.event==='broadcast');
    assert.equal(packet.payload.payload.userId,uid(2),'member 1 can forge member 2 inside the old payload');
    sql(`DELETE FROM conversation_members WHERE conversation_id='${uid(11)}' AND user_id='${uid(3)}';`);
    send('video');await until(()=>receiver.packets.some(p=>p.event==='broadcast'&&p.payload.payload.kind==='video'));
    const reconnect=await subscribe(uid(3),uid(11),true,topic);assert.equal(reconnect.refused,true);
    sender.socket.terminate();receiver.socket.terminate();
   }finally{
    sql(`DROP POLICY fixture_cached_receive ON realtime.messages;DROP POLICY fixture_cached_send ON realtime.messages;
     INSERT INTO conversation_members VALUES('${uid(11)}','${uid(3)}','member') ON CONFLICT DO NOTHING;`);
   }
  });
  const kept=await subscribe(uid(2)),removed=await subscribe(uid(3)),outsider=await subscribe(uid(4));
  await t.test('three signed users: participants receive verified actor; outsider receives no rows',async()=>{
   await publish('recording',1);
   await until(()=>kept.rows.some(r=>r.sequence===1)&&removed.rows.some(r=>r.sequence===1));
   assert.equal(kept.rows[0].user_id,uid(1));await wait(500);assert.equal(outsider.rows.length,0);
  });
  await t.test('authenticated client cannot inject a forged Broadcast into the hardened private transport',async()=>{
   const malicious=await subscribe(uid(2));
   malicious.socket.send(JSON.stringify({topic:'realtime:chat-activity-db:'+uid(11),event:'broadcast',ref:'2',payload:{type:'broadcast',event:'activity',payload:{userId:uid(1),kind:'video',spoof:true}}}));
   await wait(600);
   assert.equal(removed.packets.some(p=>p.event==='broadcast'&&p.payload.payload?.spoof),false);
   malicious.socket.terminate();
  });
  await t.test('already-connected removed user stays on socket but receives no subsequent activity',async()=>{
   sql(`DELETE FROM conversation_members WHERE conversation_id='${uid(11)}' AND user_id='${uid(3)}';`);
   const before=removed.rows.length;
   await publish('video',2);
   await until(()=>kept.rows.some(r=>r.sequence===2));await wait(1200);
   assert.equal(removed.rows.length,before);assert.equal(removed.socket.readyState,WebSocket.OPEN);
  });
  await t.test('removed and outsider reconnects cannot read; obsolete private activity topic refuses all clients',async()=>{
   const reconnect=await subscribe(uid(3));
   await publish('photo',3);await until(()=>kept.rows.some(r=>r.sequence===3));await wait(800);
   assert.equal(reconnect.rows.length,0);
   assert.equal(reconnect.refused,true);
   const old=await subscribe(uid(3),uid(11),true);assert.equal(old.refused,true);
   const oldParticipant=await subscribe(uid(2),uid(11),true);assert.equal(oldParticipant.refused,true);
  });
  await t.test('one-to-one socket loses row access after a block without JWT renewal',async()=>{
   const direct=await subscribe(uid(2),uid(10));
   await publish('recording',1,uid(10));await until(()=>direct.rows.some(r=>r.sequence===1));
   sql(`INSERT INTO blocks VALUES('${uid(2)}','${uid(1)}');`);
   // Mutate only isolated event row as admin to test RECEIVE RLS, independently of publisher refusal.
   sql(`UPDATE chat_activity SET sequence=2,updated_at=statement_timestamp(),expires_at=statement_timestamp()+interval '7 seconds' WHERE conversation_id='${uid(10)}';`);
   await wait(1200);assert.equal(direct.rows.some(r=>r.sequence===2),false);
  });
 }finally{for(const socket of sockets)socket.terminate();}
});
