#!/usr/bin/env node
// Operator only: load staging secrets through a secret manager, never arguments.
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { v2 as cloudinary } from 'cloudinary';
import { LegacyMediaMigration, requireLegacyEnvironment, attestLegacySource } from '../lib/protected-media/legacy-media-migration.js';
import { UUID } from '../lib/protected-media/legacy-media-plan.js';

async function main() {
  const [command='plan',postId,...args]=process.argv.slice(2);
  const options=args.filter(v=>v.startsWith('--'));
  const positional=args.filter(v=>!v.startsWith('--'));
  const visibility=positional[0];
  const allowed=['attest','plan','status','prepare','copy','quarantine','revoke','observe','finalize','abandon','refreshProbes'];
  if(!allowed.includes(command) || !UUID.test(postId || '') || options.some(v=>v!=='--apply') || positional.length>(command==='prepare'?1:0)) throw Error('Invalid command');
  requireLegacyEnvironment(process.env);
  const auth=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.getUser(process.env.FREEUPPER_LEGACY_OWNER_TOKEN || '');
  if(error || !data?.user?.id) throw Error('Staging owner authentication required');
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false},db:{schema:'privacy_test'}});
  cloudinary.config({cloud_name:'sxdcqs5x',api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET,secure:true});
  const migration=new LegacyMediaMigration({db,cloudinary,ownerId:data.user.id,postId,env:process.env});
  const apply=options.includes('--apply');
  if(command==='attest') {
    const {post}=await migration.inspect();
    const evidence=JSON.parse(await readFile(process.env.FREEUPPER_LEGACY_PROVENANCE_FILE,'utf8'));
    console.log(JSON.stringify(await attestLegacySource({db,cloudinary,post,evidence,dryRun:!apply}))); return;
  }
  if(command==='plan' || command==='prepare' && !apply) {
    const p=await migration.plan(); console.log(JSON.stringify({dryRun:true,postId,copies:p.entries.length,sources:p.sources.length,
      oldUrlProbes:p.sources.reduce((n,s)=>n+s.probe_urls.length,0),restrictedVisibilityBlocked:true})); return;
  }
  if(command==='status' || !apply) {
    const {job}=await migration.inspect(); console.log(JSON.stringify({dryRun:!apply,state:job?.state || 'not_prepared',
      postId,requestedOperation:command,revocationStartedAt:job?.revocation_started_at || null,
      lastError:job?.last_error || null,restrictedVisibilityBlocked:job?.state!=='complete'})); return;
  }
  let job;
  if(command==='prepare') job=await migration.prepare(visibility);
  else if(command==='observe') job=await migration.observe(process.env.FREEUPPER_REVOCATION_VANTAGE);
  else job=await migration[command]();
  console.log(JSON.stringify({postId,state:job.state,restrictedVisibilityBlocked:job.state!=='complete'}));
}
main().catch(()=>{console.error('Legacy migration did not complete. Credentials and upstream diagnostics were not logged. Inspect the owner-scoped job and retry.');process.exitCode=1;});
