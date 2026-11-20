// Opt-in only: GET requests and anonymous private-channel admission; no account/data writes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
if(process.env.FREEUPPER_HOSTED_READONLY!=='1')throw new Error('Set FREEUPPER_HOSTED_READONLY=1 explicitly');
const project='jmjtqidirpmnegzvmiaq';
const curl=config=>{
 const r=spawnSync('curl',['--config','-'],{input:config,encoding:'utf8',maxBuffer:2e6});
 if(r.status!==0)throw new Error('Read-only HTTPS transport failed (curl code '+r.status+')');
 return r.stdout;
};
const source=curl('silent\nshow-error\nmax-time = 20\nurl = "https://freeupper.com/auth.js"\n');
const key=source.match(/const\s+SUPABASE_ANON_KEY\s*=\s*(['"])(.*?)\1/)?.[2];
assert(key,'Expected published legacy anonymous client configuration');
const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());
assert.equal(claims.ref,project,'Stop on project mismatch');assert.equal(claims.role,'anon');
const direct='https://'+project+'.supabase.co',gateway='https://api.freeupper.com';
const id=randomUUID();const results=[];
function get(origin,path,token=key){
 // The published key is passed on stdin, never put in shell arguments or logs.
 const config=['silent','show-error','max-time = 20','request = "GET"','url = "'+origin+path+'"',
  'header = "apikey: '+key+'"','header = "Authorization: Bearer '+token+'"','write-out = "\\n%{http_code}"'].join('\n');
 const output=curl(config);const split=output.lastIndexOf('\n');let body;try{body=JSON.parse(output.slice(0,split));}catch{}
 return {status:Number(output.slice(split+1)),errorCode:body?.code};
}
for(const origin of [direct,gateway]){
 for(const path of ['/rest/v1/chat_activity?select=id&limit=0','/rest/v1/message_reads?select=message_id&limit=0','/rest/v1/rpc/get_chat_activity?p_conversation_id='+id]){
  const result=get(origin,path);results.push({transport:origin===direct?'direct':'gateway',case:path.split('?')[0],...result});
  // PostgREST maps anonymous insufficient_privilege to 401, authenticated denial to 403.
  assert([401,403].includes(result.status)&&result.errorCode==='42501','Require SQL permission denial, not merely an invalid-key response');
 }
 const [header,,signature]=key.split('.');
 const forged=header+'.'+Buffer.from(JSON.stringify({...claims,role:'authenticated',sub:randomUUID()})).toString('base64url')+'.'+signature;
 const {status,errorCode}=get(origin,'/rest/v1/chat_activity?select=id&limit=0',forged);
 results.push({transport:origin===direct?'direct':'gateway',case:'invalid JWT rejection',status,errorCode});
 assert([401,403].includes(status),'Invalid JWT must be rejected');
}
async function join(origin){
 const url=new URL(origin.replace(/^http/,'ws')+'/realtime/v1/websocket');url.searchParams.set('apikey',key);url.searchParams.set('vsn','1.0.0');
 const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
 return new Promise(resolve=>{
  let socket,done=false;
  const finish=result=>{if(done)return;done=true;clearTimeout(timer);socket?.terminate();resolve(result);};
  const timer=setTimeout(()=>finish({outcome:'timeout'}),15000);
  try{socket=new WebSocket(url,{agent:proxy?new HttpsProxyAgent(proxy):undefined});}catch{finish({outcome:'setup_error'});return;}
  socket.on('error',error=>finish({outcome:'network_error',code:error.code||'unknown'}));
  socket.on('unexpected-response',(_,res)=>{res.resume();finish({outcome:'http_refused',status:res.statusCode});});
  socket.on('open',()=>socket.send(JSON.stringify({topic:'realtime:chat-activity-db:'+id,event:'phx_join',ref:'1',payload:{access_token:key,config:{private:true,broadcast:{self:false},presence:{key:''},postgres_changes:[]}}})));
  socket.on('message',raw=>{let p;try{p=JSON.parse(raw);}catch{return;}
   if(p.event==='phx_reply'&&p.ref==='1'){
    const reason=String(p.payload?.response?.reason||p.payload?.response?.message||'').replaceAll(key,'[redacted]').slice(0,160);
    finish({outcome:p.payload?.status==='error'?'private_refused':'unexpected_admission',reason});
   }
  });
 });
}
for(const origin of [direct,gateway]){
 const result=await join(origin);results.push({transport:origin===direct?'direct':'gateway',case:'anonymous private Realtime join',...result});
 const denied=result.outcome==='private_refused'&&/permission|authoriz/i.test(result.reason)||result.outcome==='http_refused'&&[401,403].includes(result.status);
 assert(denied,'Private admission safety gate failed: '+JSON.stringify(result));
}
console.log(JSON.stringify({project,mode:'read-only; anonymous/invalid-token only; no authorized-user or revocation claim',results},null,2));
