// Trusted operator workflow. Never import this module into browser code.
import { randomUUID } from 'node:crypto';
import { stagingPublishingEnabled } from './staging-publishing-server.js';
import { planLegacyPost, verifySource, probeUrls, validateProbeUrl, hash, UUID, REVOCATION_WAIT_MS } from './legacy-media-plan.js';
import { verifyStagingAsset } from './verify-staging-asset.js';

export function requireLegacyEnvironment(env) {
  if (!stagingPublishingEnabled(env) || env.FREEUPPER_LEGACY_MIGRATION !== 'enabled-in-isolated-staging') {
    throw Error('Legacy migration is limited to the isolated staging branch');
  }
}
const notFound = error => (error?.error?.http_code ?? error?.http_code) === 404;
async function optionalResource(operation) {
  try { return await operation(); } catch(error) { if(notFound(error)) return null; throw Error('Cloudinary identity lookup failed'); }
}
function sourceMatches(asset, source) {
  if (!asset || asset.asset_id!==source.asset_id || asset.public_id!==source.public_id || asset.type!=='upload' ||
      asset.resource_type!==source.resource_type || asset.version!==source.version) throw Error('Source identity changed');
}
async function verifyProvenance(db,post,asset) {
  const {data,error}=await db.rpc('verified_legacy_source',{p_owner:post.user_id,p_post:post.id,
    p_asset:asset.asset_id,p_public_id:asset.public_id,p_version:asset.version,p_type:asset.resource_type});
  if(error || data!==true) throw Error('Reviewed upload ownership provenance required');
  return true;
}
export async function buildLegacyPlan({post, cloudinary, db}) {
  const plan=planLegacyPost(post), sources=[];
  for (const entry of plan.entries) {
    let source=sources.find(s => s.public_id===entry.public_id && s.resource_type===entry.resource_type);
    if(!source) {
      const asset=await cloudinary.api.resource(entry.public_id,{resource_type:entry.resource_type,type:'upload',context:true,max_results:500});
      verifySource(asset,entry,post,await verifyProvenance(db,post,asset));
      source={asset_id:asset.asset_id,public_id:asset.public_id,resource_type:asset.resource_type,version:asset.version,probe_urls:[]};
      sources.push(source);
      // Snapshot every known derivative before deleting the source, including posters/audio.
      source.probe_urls=probeUrls(asset,plan.entries.filter(e=>e.public_id===source.public_id&&e.resource_type===source.resource_type));
    }
    entry.source_asset_id=source.asset_id;
    entry.target_public_id='freeupper-privacy-v2-staging/'+post.user_id+'/asset_'+hash(post.id+'\n'+entry.url+'\n'+entry.type).slice(0,32);
  }
  const {data:conflicts,error}=await db.rpc('legacy_reference_conflicts',{p_post:post.id,p_sources:sources});
  if(error || conflicts!==0) throw Error('Shared references or dependency inventory require review');
  return {...plan,sources};
}
// Explicit operator attestation after reviewing independent upload/audit records.
// It never infers ownership from an editable post row or Cloudinary context.
export async function attestLegacySource({db,cloudinary,post,evidence,dryRun=true}) {
  const keys=['asset_id','post_id','owner_id','public_id','resource_type','version','evidence_sha256','reviewed_by'];
  if(!evidence || Object.keys(evidence).some(k=>!keys.includes(k)) ||
    evidence.post_id!==post.id || evidence.owner_id!==post.user_id ||
    !/^[a-f0-9]{64}$/.test(evidence.evidence_sha256 || '') ||
    !/^[A-Za-z0-9_.@-]{2,100}$/.test(evidence.reviewed_by || '')) throw Error('Reviewed provenance evidence required');
  const asset=await cloudinary.api.resource_by_asset_id(evidence.asset_id,{context:true,max_results:500});
  verifySource(asset,evidence,post,true);
  if(asset.asset_id!==evidence.asset_id) throw Error('Provenance identity mismatch');
  if(dryRun) return {dryRun:true,verifiedIdentity:true};
  const row={cloudinary_asset_id:asset.asset_id,post_id:post.id,owner_id:post.user_id,public_id:asset.public_id,
    resource_type:asset.resource_type,source_version:asset.version,evidence_sha256:evidence.evidence_sha256,reviewed_by:evidence.reviewed_by};
  const {data:existing,error:lookupError}=await db.from('legacy_media_provenance').select('*').eq('cloudinary_asset_id',asset.asset_id).maybeSingle();
  if(lookupError) throw Error('Provenance lookup unavailable');
  if(existing) {
    if(Object.entries(row).some(([k,v])=>existing[k]!==v)) throw Error('Existing provenance differs; independent review required');
  } else {
    const {error}=await db.from('legacy_media_provenance').insert(row);
    if(error) throw Error('Provenance registration unavailable');
  }
  return {dryRun:false,verifiedIdentity:true};
}
export class LegacyMediaMigration {
  constructor({db,cloudinary,ownerId,postId,env,fetchImpl=fetch,now=()=>Date.now()}) {
    requireLegacyEnvironment(env);
    if(!UUID.test(ownerId || '') || !UUID.test(postId || '')) throw Error('Authenticated owner and post required');
    Object.assign(this,{db,cloudinary,ownerId,postId,fetchImpl,now}); this.lease=randomUUID();
  }
  async rpc(action,data={}) {
    const {data:result,error}=await this.db.rpc('legacy_media_transition',{
      p_owner:this.ownerId,p_post:this.postId,p_action:action,p_lease:this.lease,p_data:data
    });
    if(error || !result) throw Error('Migration transition unavailable: '+action);
    return result;
  }
  async inspect() { return this.rpc('inspect'); }
  async plan() { const {post}=await this.inspect(); return buildLegacyPlan({post,cloudinary:this.cloudinary,db:this.db}); }
  async prepare(visibility) {
    if(!['followers','friends','only_me'].includes(visibility)) throw Error('Explicit restricted audience required');
    const {post,job}=await this.inspect();
    if(job) { if(job.target_visibility!==visibility) throw Error('Existing migration has a different requested audience'); return job; }
    const plan=await buildLegacyPlan({post,cloudinary:this.cloudinary,db:this.db});
    return this.rpc('begin',{source_row:post,plan,visibility});
  }
  async locked(operation) {
    const job=await this.rpc('lease');
    try { return await operation(job); }
    catch (_) { try { await this.rpc('failure'); } catch {} throw Error('Migration incomplete; inspect and retry the same operation'); }
    finally { try { await this.rpc('release'); } catch {} }
  }
  async heartbeat() { return this.rpc('lease'); }
  verifyCopy(asset,entry,job) {
    const c=asset?.context?.custom || {};
    if(!verifyStagingAsset({asset,expectedPublicId:entry.target_public_id,expectedAssetId:asset?.asset_id,expectedResourceType:entry.type}) ||
      c.freeupper_owner_id!==this.ownerId || c.freeupper_post_id!==this.postId ||
      c.freeupper_legacy_job!==job.id || c.freeupper_source_asset!==entry.source_asset_id) throw Error('Protected copy provenance mismatch');
    return asset;
  }
  async readyCopies(job) {
    for(const entry of job.plan.entries) {
      await this.heartbeat();
      const expected=job.copies[String(entry.slot)];
      if(!expected) throw Error('Incomplete copies');
      const copy=this.verifyCopy(await this.cloudinary.api.resource_by_asset_id(expected.asset_id,{context:true}),entry,job);
      if(copy.asset_id!==expected.asset_id || copy.format!==expected.format) throw Error('Copy changed');
    }
  }
  async copy() { return this.locked(async job=>{
    if(job.state!=='copying') throw Error('Copy phase finished');
    for(const entry of job.plan.entries) {
      await this.heartbeat();
      const source=job.plan.sources.find(s=>s.asset_id===entry.source_asset_id);
      const remote=await this.cloudinary.api.resource_by_asset_id(source.asset_id,{context:true,max_results:500});
      verifySource(remote,entry,job.original_row,await verifyProvenance(this.db,job.original_row,remote)); sourceMatches(remote,source);
      // A lost response is recovered by the deterministic ID + exact context.
      let copy=await optionalResource(()=>this.cloudinary.api.resource(entry.target_public_id,{type:'authenticated',resource_type:entry.type,context:true}));
      if(!copy) copy=await this.cloudinary.uploader.upload(entry.url,{type:'authenticated',resource_type:entry.type,
        public_id:entry.target_public_id,overwrite:false,unique_filename:false,
        context:{freeupper_owner_id:this.ownerId,freeupper_post_id:this.postId,freeupper_legacy_job:job.id,freeupper_source_asset:source.asset_id}});
      this.verifyCopy(copy,entry,job);
      // Admin re-read, not just upload response, establishes final protected identity.
      copy=this.verifyCopy(await this.cloudinary.api.resource_by_asset_id(copy.asset_id,{context:true}),entry,job);
      job=await this.rpc('copy',{slot:entry.slot,copy:{asset_id:copy.asset_id,public_id:copy.public_id,resource_type:copy.resource_type,format:copy.format}});
    }
    await this.readyCopies(job);
    return job;
  }); }
  async quarantine() { return this.locked(async job=>{
    await this.readyCopies(job);
    return this.rpc('quarantine');
  }); }
  async refreshProbes() { return this.locked(async job=>{
    if(!['copying','quarantined'].includes(job.state) || job.revocation_started_at) throw Error('Probe refresh unavailable after revocation');
    const sources=[];
    for(const source of job.plan.sources) {
      await this.heartbeat();
      const remote=await this.cloudinary.api.resource_by_asset_id(source.asset_id,{context:true,max_results:500});
      sourceMatches(remote,source);
      verifySource(remote,job.plan.entries.find(e=>e.source_asset_id===source.asset_id),job.original_row,await verifyProvenance(this.db,job.original_row,remote));
      sources.push({...source,probe_urls:[...new Set([...source.probe_urls,...probeUrls(remote,job.plan.entries.filter(e=>e.source_asset_id===source.asset_id))])]});
    }
    return this.rpc('refresh_probes',{sources});
  }); }
  async revoke() { return this.locked(async job=>{
    if(!['quarantined','revoking'].includes(job.state)) throw Error('Quarantine required');
    await this.readyCopies(job);
    // Re-inventory before deleting anything; new shared references block the DB transition.
    for(const source of job.plan.sources) {
      const remote=await optionalResource(()=>this.cloudinary.api.resource_by_asset_id(source.asset_id,{context:true,max_results:500}));
      if(remote) {
        sourceMatches(remote,source);
        verifySource(remote,job.plan.entries.find(e=>e.source_asset_id===source.asset_id),job.original_row,await verifyProvenance(this.db,job.original_row,remote));
        const current=probeUrls(remote,job.plan.entries.filter(e=>e.source_asset_id===source.asset_id));
        if(current.some(url=>!source.probe_urls.includes(url))) throw Error('Derivative inventory changed; operator recovery required');
      }
    }
    job=await this.rpc('revoking');
    for(const source of job.plan.sources) {
      await this.heartbeat();
      const asset=await optionalResource(()=>this.cloudinary.api.resource_by_asset_id(source.asset_id,{context:true}));
      if(asset) {
        sourceMatches(asset,source);
        const result=await this.cloudinary.api.delete_resources_by_asset_ids([source.asset_id],{invalidate:true,keep_original:false});
        if(!['deleted','not_found'].includes(result?.deleted?.[source.asset_id]) &&
           !['deleted','not_found'].includes(result?.deleted?.[source.public_id])) throw Error('Deletion not acknowledged');
      }
      await this.absent(source);
      job=await this.rpc('deleted',{asset_id:source.asset_id,reset_wait:!!asset});
    }
    return job;
  }); }
  async absent(source) {
    if(await optionalResource(()=>this.cloudinary.api.resource_by_asset_id(source.asset_id))) throw Error('Source still exists');
    if(await optionalResource(()=>this.cloudinary.api.resource(source.public_id,{type:'upload',resource_type:source.resource_type}))) throw Error('Public ID was recreated');
  }
  async observe(vantage) { return this.locked(async job=>{
    if(!/^[A-Za-z0-9_-]{2,50}$/.test(vantage || '') || !['revoking','verified'].includes(job.state) ||
      this.now()-Date.parse(job.revocation_started_at)<REVOCATION_WAIT_MS) throw Error('Revocation waiting period not satisfied');
    let count=0;
    for(const source of job.plan.sources) {
      await this.heartbeat(); await this.absent(source);
      for(const url of source.probe_urls) {
        // No cache-busting, Range, authorization or redirects: probe the old URL.
        const response=await this.fetchImpl(validateProbeUrl(url),{redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(15000)});
        await response.body?.cancel();
        if(![404,410].includes(response.status)) throw Error('Old URL remains reachable or unverifiable');
        count++;
      }
    }
    return this.rpc('observe',{vantage,probe_count:count,outcome:'absent'});
  }); }
  async abandon() { return this.locked(async job=>{
    if(job.state!=='copying') throw Error('A quarantined or revoked post must remain hidden; resume migration');
    for(const source of job.plan.sources) sourceMatches(await this.cloudinary.api.resource_by_asset_id(source.asset_id),source);
    for(const entry of job.plan.entries) {
      await this.heartbeat();
      const copy=await optionalResource(()=>this.cloudinary.api.resource(entry.target_public_id,{type:'authenticated',resource_type:entry.type,context:true}));
      if(copy) {
        this.verifyCopy(copy,entry,job);
        const registered=job.copies[String(entry.slot)];
        if(registered && registered.asset_id!==copy.asset_id) throw Error('Copy identity changed');
        await this.cloudinary.api.delete_resources_by_asset_ids([copy.asset_id],{invalidate:true,keep_original:false});
        if(await optionalResource(()=>this.cloudinary.api.resource_by_asset_id(copy.asset_id))) throw Error('Copy cleanup pending');
      }
      job=await this.rpc('remove_copy',{slot:entry.slot});
    }
    return this.rpc('abandon');
  }); }
  async finalize() { return this.locked(async job=>{
    if(job.state!=='verified') throw Error('Verified revocation required');
    await this.readyCopies(job);
    // Repeat exact URL checks immediately before the atomic visibility switch.
    for(const source of job.plan.sources) {
      await this.heartbeat(); await this.absent(source);
      for(const url of source.probe_urls) {
        const r=await this.fetchImpl(validateProbeUrl(url),{redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(15000)});
        await r.body?.cancel(); if(![404,410].includes(r.status)) throw Error('Revocation regressed');
      }
    }
    return this.rpc('finalize');
  }); }
}
