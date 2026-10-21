#!/usr/bin/env node
// Explicit synthetic receiver exercise only. No email/Slack destination discovery.
import {createHmac,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {requireLegacyEnvironment} from '../../lib/protected-media/legacy-media-migration.js';
export function syntheticAlert(){return {schema:1,project:'tagkrhvgcbnybiuyvjxt',synthetic:true,kind:'privacy-v2-monitor-exercise',exercise_id:randomUUID(),sent_at:new Date().toISOString(),metrics:{safety_violation:1,expired_drafts:1},action:'exercise-only-no-production-action'};}
const mac=(secret,text)=>createHmac('sha256',secret).update(text).digest('hex');
export async function deliverSyntheticAlert({env,payload=syntheticAlert(),fetchImpl=fetch}){
 requireLegacyEnvironment(env);
 const secret=env.FREEUPPER_STAGING_ALERT_HMAC_KEY,url=new URL(env.FREEUPPER_STAGING_ALERT_URL);
 if(env.FREEUPPER_STAGING_ALERT_EXERCISE!=='authorized-synthetic-receiver'||typeof secret!=='string'||secret.length<32||url.protocol!=='https:'||url.origin!==env.FREEUPPER_STAGING_ALERT_ORIGIN||url.username||url.password||/^(localhost|[0-9.]+|\[)/i.test(url.hostname)||/\.(internal|local)$/.test(url.hostname))throw Error('Authorized staging receiver required');
 if(Object.keys(payload).some(key=>!['schema','project','synthetic','kind','exercise_id','sent_at','metrics','action'].includes(key))||Object.keys(payload.metrics||{}).sort().join(',')!=='expired_drafts,safety_violation'||Object.values(payload.metrics||{}).some(v=>v!==1)||payload.synthetic!==true||payload.project!=='tagkrhvgcbnybiuyvjxt'||payload.kind!=='privacy-v2-monitor-exercise')throw Error('Synthetic exercise required');
 const body=JSON.stringify(payload),response=await fetchImpl(url.href,{method:'POST',redirect:'manual',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-Freeupper-Exercise-Signature':mac(secret,body)},body});
 if(!response.ok)throw Error('Receiver did not acknowledge');
 const receipt=await response.json(),signature=receipt.signature||'',expected=mac(secret,payload.exercise_id+'\n'+receipt.received_at+'\n'+receipt.receipt_id);
 if(receipt.exercise_id!==payload.exercise_id||!/^[a-f0-9]{64}$/.test(signature)||typeof receipt.receipt_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(receipt.receipt_id)||!Number.isFinite(Date.parse(receipt.received_at))||Math.abs(Date.parse(receipt.received_at)-Date.now())>300000||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')))throw Error('Signed receiver acknowledgement required');
 return {exercise_id:payload.exercise_id,receiver_acknowledged:true,receipt_sha256:createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),downstream_alert_delivery_verified:false};
}
async function main(){
 const args=process.argv.slice(2);if(args.length>1||args.some(v=>v!=='--send-synthetic-alert'))throw Error();
 if(!args.length){console.log(JSON.stringify({dryRun:true,payload:syntheticAlert(),sent:false}));return;}
 console.log(JSON.stringify(await deliverSyntheticAlert({env:process.env})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Synthetic alert exercise blocked or unacknowledged; no destination or credentials logged.');process.exitCode=1;});
