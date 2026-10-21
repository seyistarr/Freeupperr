import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateManifest,assertDue,NOT_BEFORE,digest,assertRunnerContext} from '../scripts/privacy-v2/revocation-runner.mjs';
const manifest=JSON.parse(readFileSync(new URL('../scripts/privacy-v2/revocation-fixtures.json',import.meta.url)));
test('runner cannot qualify before global deadline, per-job 31 days or second check separation',()=>{
 validateManifest(manifest);
 assert.throws(()=>assertDue({manifest,runner:'first',now:NOT_BEFORE-1}),/Not due/);
 assert.doesNotThrow(()=>assertDue({manifest,runner:'first',now:NOT_BEFORE}));
 const first={runner:'first',checked_at:new Date(NOT_BEFORE).toISOString(),all_absent:true,manifest_sha256:digest(JSON.stringify(manifest))};
 assert.throws(()=>assertDue({manifest,runner:'second',now:NOT_BEFORE+3599999,first}),/one hour/);
 assert.doesNotThrow(()=>assertDue({manifest,runner:'second',now:NOT_BEFORE+3600000,first}));
 assert.throws(()=>assertDue({manifest,runner:'second',now:NOT_BEFORE+3600000,first:{...first,all_absent:false}}));
 assert.throws(()=>assertDue({manifest,runner:'second',now:NOT_BEFORE+3600000,first:{...first,manifest_sha256:'a'}}));
 const late=structuredClone(manifest);late.jobs[0].revoked_at='2026-11-01T00:00:00Z';
 assert.throws(()=>assertDue({manifest:late,runner:'first',now:NOT_BEFORE}),/Not due/);
});
test('runner forbids production, arbitrary legacy assets and non-fixture URLs',()=>{
 for(const change of [m=>m.cloud='production',m=>m.synthetic=false,m=>m.jobs[0].urls[0]+='?bust=1',m=>m.jobs[0].urls[0]=m.jobs[0].urls[0].replace('res.cloudinary.com','evil.example'),m=>m.jobs[0].urls[0]=m.jobs[0].urls[0].replace('legacy_acceptance_image','real-user')]) {
  const copy=structuredClone(manifest);change(copy);assert.throws(()=>validateManifest(copy));
 }
});
test('runner refuses unapproved or shared execution contexts before using AWS',()=>{
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'seyistarr/Freeupperr',GITHUB_REF:'refs/heads/feature/post-privacy-v2-integration',GITHUB_JOB:'first',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123'};
 assert.doesNotThrow(()=>assertRunnerContext(env,'first','linux'));
 assert.throws(()=>assertRunnerContext(env,'first','win32'));
 assert.throws(()=>assertRunnerContext(env,'second','linux'));
 for(const key of Object.keys(env)) assert.throws(()=>assertRunnerContext({...env,[key]:''},'first','linux'));
 assert.throws(()=>assertRunnerContext({...env,GITHUB_REF:'refs/heads/main'},'first','linux'));
});
