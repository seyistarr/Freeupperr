#!/usr/bin/env node
// Staging-only operator preparation. No backup content or secrets in stdout.
import { createClient } from '@supabase/supabase-js';
import { requireLegacyEnvironment } from '../../lib/protected-media/legacy-media-migration.js';
async function main() {
 requireLegacyEnvironment(process.env);
 const action=process.argv[2] || 'monitor';
 if(!['monitor','backup','restore-exercise'].includes(action)) throw Error();
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{db:{schema:'privacy_test'},auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await db.rpc(action==='monitor'?'privacy_v2_monitor':'synthetic_recovery_exercise',
  action==='monitor'?{}:{p_action:action,p_id:process.argv[3] || null});
 if(error)throw Error(); console.log(JSON.stringify(data));
 if(action==='monitor' && (data.safety_violation>0 || data.expired_drafts>0 || data.cleanup_retry>0 || data.failed_jobs>0 || data.due_unverified>0))process.exitCode=2;
}
main().catch(()=>{console.error('Staging exercise unavailable. No live post restore performed.');process.exitCode=1;});
