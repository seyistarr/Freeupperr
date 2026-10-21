#!/usr/bin/env node
// Trusted operator only. S3 read credentials and staging secrets from a secret
// manager; no credentials in arguments/output. Dry run unless --apply.
import {execFileSync} from 'node:child_process';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {v2 as cloudinary} from 'cloudinary';
import {validateManifest,assertDue,digest} from './revocation-runner.mjs';
import {requireLegacyEnvironment} from '../../lib/protected-media/legacy-media-migration.js';
const aws=args=>JSON.parse(execFileSync('aws',[...args,'--output','json','--no-cli-pager'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
async function main(){
 requireLegacyEnvironment(process.env);
 if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error();
 if(!/^[a-f0-9]{40}$/.test(process.env.REVOCATION_APPROVED_SHA||''))throw Error();
 const apply=process.argv.includes('--apply'), dir=await mkdtemp(join(tmpdir(),'privacy-receipts-'));
 try {
  const manifest=validateManifest(JSON.parse(await readFile(new URL('./revocation-fixtures.json',import.meta.url),'utf8')));
  const receipts=[], evidence=[];
  for(const runner of ['first','second']) {
   const prefix='REVOCATION_'+runner.toUpperCase(),bucket=process.env[prefix+'_BUCKET'],account=process.env[prefix+'_ACCOUNT'];
   if(!/^freeupper-staging-revocation-[a-z0-9-]+$/.test(bucket||'')||!/^[0-9]{12}$/.test(account||''))throw Error();
   const key=`privacy-v2/${runner}.json`,head=aws(['s3api','head-object','--bucket',bucket,'--key',key,'--expected-bucket-owner',account]);
   if(!head.VersionId||head.ObjectLockMode!=='COMPLIANCE'||Date.parse(head.ObjectLockRetainUntilDate)<Date.now()+86400000)throw Error();
   const path=join(dir,runner+'.json');
   aws(['s3api','get-object','--bucket',bucket,'--key',key,'--expected-bucket-owner',account,'--version-id',head.VersionId,path]);
   const bytes=await readFile(path),data=JSON.parse(bytes);
   if(data.commit!==process.env.REVOCATION_APPROVED_SHA||data.job!==runner||data.repository!=='seyistarr/Freeupperr'||data.ref!=='refs/heads/feature/post-privacy-v2-integration'||!/^[0-9]+$/.test(data.execution||'')||data.runner!==runner||data.account!==account||data.manifest_sha256!==digest(JSON.stringify(manifest))||data.all_absent!==true||
     data.os!==(runner==='first'?'linux':'win32')||!Number.isFinite(Date.parse(head.LastModified))||
     Date.parse(data.checked_at)>Date.parse(head.LastModified)||Date.parse(head.LastModified)-Date.parse(data.checked_at)>600000)throw Error();
   assertDue({manifest,runner,now:Date.parse(data.checked_at),first:evidence[0]});
   const expected=manifest.jobs.flatMap(j=>j.urls.map((_,index)=>j.id+':'+index)).sort();
   if(!Array.isArray(data.probes)||JSON.stringify(data.probes.map(p=>p.job+':'+p.index).sort())!==JSON.stringify(expected)||
     data.probes.some(p=>![404,410].includes(p.status)))throw Error();
   if(runner==='second'&&(data.first_sha256!==digest(JSON.stringify(evidence[0]))||account===receipts[0].account||bucket===receipts[0].bucket||
     Date.parse(head.LastModified)-Date.parse(receipts[0].stored_at)<3600000))throw Error();
   evidence.push(data);receipts.push({runner,bucket,account,key,version:head.VersionId,sha256:digest(bytes),stored_at:head.LastModified,checked_at:data.checked_at,
     retention_until:head.ObjectLockRetainUntilDate,manifest_sha256:data.manifest_sha256});
  }
  if(Date.now()-Date.parse(receipts[1].checked_at)>3600000)throw Error();
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{db:{schema:'privacy_test'},auth:{persistSession:false,autoRefreshToken:false}});
  cloudinary.config({cloud_name:'sxdcqs5x',api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET,secure:true});
  for(const fixture of manifest.jobs) {
   const {data:job,error}=await db.from('legacy_media_jobs').select('*').eq('id',fixture.id).eq('owner_id','ea903e28-c74f-4202-9d4a-3dd9bd2a2178').single();
   if(error||!job||Date.parse(job.revocation_started_at)!==Date.parse(fixture.revoked_at)||!['revoking','verified'].includes(job.state))throw Error();
   const urls=[...new Set(job.plan.sources.flatMap(s=>s.probe_urls))].sort();
   if(JSON.stringify(urls)!==JSON.stringify([...fixture.urls].sort()))throw Error();
   for(const source of job.plan.sources)for(const lookup of [()=>cloudinary.api.resource_by_asset_id(source.asset_id),()=>cloudinary.api.resource(source.public_id,{type:'upload',resource_type:source.resource_type})]) {
    try {await lookup();throw Error('Source exists');}catch(error){if((error?.http_code??error?.error?.http_code)!==404)throw Error();}
   }
   // Recheck exact URLs from this verifier; this does not substitute for runners.
   for(const url of urls){const r=await fetch(url,{redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(20000)});await r.body?.cancel();if(![404,410].includes(r.status))throw Error();}
   if(apply){const {error}=await db.rpc('ingest_independent_revocation',{p_job:job.id,p_manifest:manifest,p_receipts:receipts});if(error)throw Error();}
  }
  console.log(JSON.stringify({dryRun:!apply,receiptsVerified:2,jobs:2,productionModified:false}));
 }finally{await rm(dir,{recursive:true,force:true});}
}
main().catch(()=>{console.error('Independent evidence ingestion blocked; inspect immutable receipts. No credentials logged.');process.exitCode=1;});
