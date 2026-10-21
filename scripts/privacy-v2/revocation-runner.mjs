#!/usr/bin/env node
// Read-only Cloudinary probes; AWS OIDC credentials can ONLY write synthetic evidence.
// Never calls a migration RPC. Independent evidence still needs authorized ingestion.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export const NOT_BEFORE = Date.parse('2026-11-20T21:04:08Z');
export const digest = value => createHash('sha256').update(value).digest('hex');
export function validateManifest(manifest) {
  if (manifest?.project !== 'tagkrhvgcbnybiuyvjxt' || manifest.cloud !== 'sxdcqs5x' ||
      manifest.synthetic !== true || !Array.isArray(manifest.jobs) || manifest.jobs.length !== 2) throw Error('Synthetic staging manifest required');
  for (const job of manifest.jobs) {
    if (!/^[a-f0-9-]{36}$/.test(job.id) || !Number.isFinite(Date.parse(job.revoked_at)) || !Array.isArray(job.urls) || !job.urls.length) throw Error('Invalid job');
    for (const url of job.urls) {
      const parsed = new URL(url);
      if (parsed.origin !== 'https://res.cloudinary.com' || parsed.search || parsed.hash || parsed.username || parsed.password ||
        !/^\/sxdcqs5x\/(image|video)\/upload\/(?:so_0\/)?(?:v[0-9]+\/)?freeupper-privacy-v2-staging\/ea903e28-c74f-4202-9d4a-3dd9bd2a2178\/legacy_acceptance_(image|video)\.(png|mp4|jpg)$/.test(parsed.pathname)) throw Error('Non-fixture URL rejected');
    }
  }
  return manifest;
}
export function assertDue({ manifest, runner, now, first }) {
  if (!['first', 'second'].includes(runner) || !Number.isFinite(now)) throw Error('Invalid runner');
  const deadline = Math.max(NOT_BEFORE, ...manifest.jobs.map(j => Date.parse(j.revoked_at) + 31 * 86400000));
  if (now < deadline) throw Error('Not due: waiting period remains active');
  if (runner === 'second' && (!first || first.runner !== 'first' || first.all_absent !== true || first.manifest_sha256 !== digest(JSON.stringify(manifest)) ||
      !Number.isFinite(Date.parse(first.checked_at)) || Date.parse(first.checked_at) < deadline || now - Date.parse(first.checked_at) < 3600000)) throw Error('Independent first check plus one hour required');
}
export function assertRunnerContext(env,runner,platform) {
  if(!['first','second'].includes(runner) || env.GITHUB_ACTIONS!=='true' || env.GITHUB_REPOSITORY!=='seyistarr/Freeupperr' ||
    env.GITHUB_REF!=='refs/heads/feature/post-privacy-v2-integration' || env.GITHUB_JOB!==runner ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'') || !/^[0-9]+$/.test(env.GITHUB_RUN_ID||'') ||
    platform!==(runner==='first'?'linux':'win32')) throw Error('Reviewed independent GitHub runner context required');
}
function aws(args) { return JSON.parse(execFileSync('aws', [...args, '--output', 'json', '--no-cli-pager'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] })); }
async function main() {
  const manifest = validateManifest(JSON.parse(await readFile(new URL('./revocation-fixtures.json', import.meta.url), 'utf8')));
  const runner = process.env.REVOCATION_RUNNER;
  assertRunnerContext(process.env,runner,process.platform);
  const firstAccount = process.env.REVOCATION_FIRST_ACCOUNT, secondAccount = process.env.REVOCATION_SECOND_ACCOUNT;
  if (!/^[0-9]{12}$/.test(firstAccount || '') || !/^[0-9]{12}$/.test(secondAccount || '') || firstAccount === secondAccount) throw Error('Two isolated AWS execution identities required');
  const identity = aws(['sts','get-caller-identity']);
  if (identity.Account !== (runner === 'first' ? firstAccount : secondAccount)) throw Error('Wrong runner environment');
  const bucket = process.env.REVOCATION_EVIDENCE_BUCKET;
  if (!/^freeupper-staging-revocation-[a-z0-9-]+$/.test(bucket || '')) throw Error('Staging evidence bucket required');
  const config = aws(['s3api','get-object-lock-configuration','--bucket',bucket]);
  if (config.ObjectLockConfiguration?.ObjectLockEnabled !== 'Enabled' || (config.ObjectLockConfiguration?.Rule?.DefaultRetention?.Mode !== 'COMPLIANCE' || (config.ObjectLockConfiguration?.Rule?.DefaultRetention?.Days || 0)<90)) throw Error('Immutable compliance retention required');
  let first;
  if (runner === 'second') {
    const firstBucket=process.env.REVOCATION_FIRST_BUCKET;
    if (!/^freeupper-staging-revocation-[a-z0-9-]+$/.test(firstBucket || '') || firstBucket===bucket) throw Error('Separate first evidence bucket required');
    const head=aws(['s3api','head-object','--bucket',firstBucket,'--expected-bucket-owner',firstAccount,'--key','privacy-v2/first.json']);
    if (!head.VersionId) throw Error('First receipt version required');
    aws(['s3api','get-object','--bucket',firstBucket,'--expected-bucket-owner',firstAccount,'--key','privacy-v2/first.json','--version-id',head.VersionId,'first.json']);
    if (head.ObjectLockMode !== 'COMPLIANCE' || Date.parse(head.ObjectLockRetainUntilDate) <= Date.now()) throw Error('First evidence is not immutable');
    first = JSON.parse(await readFile('first.json','utf8'));
    if (first.account !== firstAccount || Date.now()-Date.parse(head.LastModified)<3600000) throw Error('First receipt must be at least one hour old');
  }
  assertDue({manifest,runner,now:Date.now(),first});
  const checked_at = new Date().toISOString(), probes = [];
  for (const job of manifest.jobs) for (const [index,url] of job.urls.entries()) {
    const response = await fetch(url, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(20000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    probes.push({job:job.id,index,status:response.status,sha256:digest(bytes),bytes:bytes.length,
      date:response.headers.get('date'),cache_control:response.headers.get('cache-control'),server_timing:response.headers.get('server-timing')});
  }
  // Failed probes are preserved too. They can never qualify for revocation.
  const all_absent = probes.every(p => [404,410].includes(p.status));
  const evidence = {schema:1,runner,account:identity.Account,execution:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,
    os:process.platform,commit:process.env.GITHUB_SHA,job:process.env.GITHUB_JOB,repository:process.env.GITHUB_REPOSITORY,ref:process.env.GITHUB_REF,checked_at,manifest_sha256:digest(JSON.stringify(manifest)),first_sha256:first?digest(JSON.stringify(first)):null,all_absent,probes,
    qualifying:false,reason:'Independent evidence candidate; trusted server ingestion and origin absence checks still required'};
  await writeFile('evidence.json', JSON.stringify(evidence));
  const key = all_absent ? `privacy-v2/${runner}.json` : `privacy-v2/failed/${runner}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.json`;
  const result = aws(['s3api','put-object','--bucket',bucket,'--expected-bucket-owner',identity.Account,'--key',key,'--body','evidence.json','--if-none-match','*']);
  if (!result.VersionId) throw Error('Versioned immutable receipt required');
  // Inherit the bucket's COMPLIANCE default. The writer has no retention-changing
  // permission and cannot override/shorten it, including during PutObject.
  const stored=aws(['s3api','head-object','--bucket',bucket,'--expected-bucket-owner',identity.Account,'--key',key,'--version-id',result.VersionId]);
  if(stored.ObjectLockMode!=='COMPLIANCE'||Date.parse(stored.ObjectLockRetainUntilDate)<Date.now()+89*86400000)throw Error('Immutable retention not confirmed');
  await writeFile('receipt.json',JSON.stringify({bucket,key,version:result.VersionId,sha256:digest(await readFile('evidence.json'))}));
  if (!all_absent) throw Error('Old media remains reachable; immutable failure evidence recorded');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('Revocation runner blocked or incomplete. No qualifying observation submitted.'); process.exitCode=1;
});
