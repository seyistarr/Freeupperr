// Local ephemeral PostgreSQL only. No Supabase or Cloudinary network access.
// Time is simulated for gate tests; this is NOT live revocation evidence.
const { PGlite } = await import(process.env.FREEUPPER_TEST_PGLITE_MODULE || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
CREATE SCHEMA privacy_test;
CREATE TABLE privacy_test.profiles(id uuid PRIMARY KEY,is_private boolean DEFAULT false,suspended boolean DEFAULT false);
CREATE TABLE privacy_test.follows(follower_id uuid,following_id uuid,status text,PRIMARY KEY(follower_id,following_id));
CREATE TABLE privacy_test.posts(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES privacy_test.profiles,visibility text NOT NULL,is_hidden boolean DEFAULT false,is_deleted boolean DEFAULT false);
CREATE TABLE privacy_test.post_media_assets(id uuid PRIMARY KEY,post_id uuid NOT NULL REFERENCES privacy_test.posts,owner_id uuid NOT NULL REFERENCES privacy_test.profiles,status text NOT NULL,delivery_type text NOT NULL,cloudinary_public_id text NOT NULL,cloudinary_asset_id text,resource_type text NOT NULL,format text NOT NULL);
GRANT USAGE ON SCHEMA privacy_test TO service_role,anon,authenticated; GRANT ALL ON ALL TABLES IN SCHEMA privacy_test TO service_role;
ALTER TABLE privacy_test.posts ENABLE ROW LEVEL SECURITY; CREATE POLICY legacy_broad ON privacy_test.posts FOR SELECT TO anon,authenticated USING(true);
GRANT SELECT ON ALL TABLES IN SCHEMA privacy_test TO anon,authenticated;
SET freeupper.privacy_v2_project_ref='tagkrhvgcbnybiuyvjxt';`);
for (const f of ['privacy-v2-protected-publishing.sql','privacy-v2-readers-cleanup.sql']) await db.exec(readFileSync(new URL('../staging-migrations/'+f,import.meta.url),'utf8'));

await db.exec(readFileSync(new URL('../staging-migrations/privacy-v2-legacy-media.sql',import.meta.url),'utf8'));

const { LegacyMediaMigration }=await import('../lib/protected-media/legacy-media-migration.js');
await db.exec('ALTER TABLE privacy_test.posts ADD COLUMN media_url text, ADD COLUMN thumbnail_url text;');
const owner='10000000-0000-4000-8000-000000000001', other='10000000-0000-4000-8000-000000000002', post='20000000-0000-4000-8000-000000000001';
const url='https://res.cloudinary.com/sxdcqs5x/image/upload/v123/legacy/photo.jpg';
await db.query('INSERT INTO privacy_test.profiles(id) VALUES($1),($2)',[owner,other]);
await db.query(`INSERT INTO privacy_test.posts(id,user_id,visibility,media,media_url,thumbnail_url,publish_payload) VALUES($1,$2,'public',$3,$4,$4,$5)`,[post,owner,JSON.stringify([{type:'image',url}]),url,JSON.stringify({source:'composer',title:'legacy'})]);
await db.exec('SET ROLE service_role');
await assert.rejects(db.query(`UPDATE privacy_test.posts SET visibility='only_me' WHERE id=$1`,[post]),/Legacy/);
await assert.rejects(db.query(`SELECT privacy_test.legacy_media_transition($1,$2,'inspect')`,[other,post]),/Owned/);
await db.exec('RESET ROLE; SET ROLE authenticated');
await assert.rejects(db.query(`SELECT privacy_test.legacy_media_transition($1,$2,'inspect')`,[owner,post]),/permission denied/);
await db.exec('RESET ROLE; SET ROLE service_role');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/post-privacy-v2-integration',FREEUPPER_MEDIA_TEST_ENV:'isolated-freeupper-staging',SUPABASE_URL:'https://tagkrhvgcbnybiuyvjxt.supabase.co',CLOUDINARY_CLOUD_NAME:'sxdcqs5x',FREEUPPER_PROTECTED_MEDIA_DELIVERY:'enabled-in-isolated-staging',FREEUPPER_PROTECTED_PUBLISHING:'enabled-in-isolated-staging',SUPABASE_ANON_KEY:'sb_publishable_test',SUPABASE_SERVICE_ROLE_KEY:'secret',CLOUDINARY_API_KEY:'key',CLOUDINARY_API_SECRET:'secret',FREEUPPER_LEGACY_MIGRATION:'enabled-in-isolated-staging'};
let present=true,copy=null;
const original={asset_id:'a'.repeat(32),public_id:'legacy/photo',version:123,resource_type:'image',type:'upload',bytes:100,format:'jpg',secure_url:url,context:{custom:{freeupper_owner_id:owner,freeupper_post_id:post}},derived:[]};
const cloudinary={api:{
 async resource(id){if(id===original.public_id && present)return original;if(id===copy?.public_id)return copy;throw {http_code:404};},
 async resource_by_asset_id(id){if(id===original.asset_id&&present)return original;if(id===copy?.asset_id)return copy;throw {http_code:404};},
 async delete_resources_by_asset_ids(ids){assert.deepEqual(ids,[original.asset_id]);present=false;return {deleted:{[ids[0]]:'deleted'}};}
},uploader:{async upload(url,options){return copy={asset_id:'b'.repeat(32),public_id:options.public_id,resource_type:options.resource_type,type:'authenticated',bytes:100,format:'jpg',context:{custom:options.context}};}}};
const adapter={async rpc(name,args){try {const names=Object.keys(args);const r=await db.query('SELECT privacy_test.'+name+'('+names.map((k,i)=>k+'=> $'+(i+1)).join(',')+') AS result',names.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));return {data:r.rows[0].result};}catch(error){console.error('RPC failed',name,args.p_action,error.message);return {error};}}};
const migration=new LegacyMediaMigration({db:adapter,cloudinary,ownerId:owner,postId:post,env,fetchImpl:async()=>({status:404})});
await assert.rejects(migration.plan(),/provenance/);
await db.query(`INSERT INTO privacy_test.legacy_media_provenance(cloudinary_asset_id,post_id,owner_id,public_id,resource_type,source_version,evidence_sha256,reviewed_by) VALUES($1,$2,$3,'legacy/photo','image',123,$4,'local-test')`,['a'.repeat(32),post,owner,'c'.repeat(64)]);
await db.exec('RESET ROLE; CREATE SCHEMA other_app; CREATE TABLE other_app.references_to_media(value text); GRANT USAGE ON SCHEMA other_app TO service_role; GRANT ALL ON other_app.references_to_media TO service_role; SET ROLE service_role;');
for(const reference of ['a'.repeat(32),'legacy:photo','legacy%2Fphoto','l_fetch:encoded-reference']) {
 await db.query('INSERT INTO other_app.references_to_media VALUES($1)',[reference]);
 await assert.rejects(migration.plan(),/Shared/);
 await db.query('DELETE FROM other_app.references_to_media');
}
await migration.plan();assert.equal(present,true);
let job=await migration.prepare('only_me');
await assert.rejects(migration.quarantine());
await migration.copy();await migration.copy();
assert.equal((await db.query('SELECT visibility,is_hidden FROM privacy_test.posts WHERE id=$1',[post])).rows[0].visibility,'public');
await migration.quarantine();
await assert.rejects(db.query(`SELECT privacy_test.claim_protected_cleanup($1,$2,$3,false)`,[owner,post,'40000000-0000-4000-8000-000000000001']),/forward recovery/);
await db.exec('RESET ROLE; SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
assert.equal((await db.query('SELECT id FROM privacy_test.posts')).rows.length,0,'even owner cannot expose quarantined draft');
await db.exec('RESET ROLE; SET ROLE service_role');
await assert.rejects(migration.finalize());
await db.query("UPDATE privacy_test.legacy_media_jobs SET revocation_started_at=now()-interval '32 days' WHERE id=$1",[job.id]);
await migration.revoke();
assert.ok(Date.now()-Date.parse((await migration.inspect()).job.revocation_started_at)<60000,'last deletion restarts CDN wait');await assert.rejects(migration.observe('region_a'));
assert.equal(present,false);
await db.query("UPDATE privacy_test.legacy_media_jobs SET revocation_started_at=now()-interval '32 days' WHERE id=$1",[job.id]);
const started=(await migration.inspect()).job.revocation_started_at;
await migration.revoke();assert.equal((await migration.inspect()).job.revocation_started_at,started,'absent-source retries preserve clock');
await migration.observe('region_a');
await assert.rejects(migration.finalize());
await db.query(`UPDATE privacy_test.legacy_media_jobs SET observations=jsonb_build_array(jsonb_build_object('vantage','region_a','at',now()-interval '2 hours','outcome','absent')) WHERE id=$1`,[job.id]);
await migration.observe('region_b');await migration.finalize();
const final=(await db.query('SELECT * FROM privacy_test.posts WHERE id=$1',[post])).rows[0];
assert.equal(final.visibility,'only_me');assert.equal(final.publishing_state,'published');assert.equal(final.media_url,null);assert.equal(final.thumbnail_url,null);assert.equal(final.is_hidden,false);assert.ok(final.media[0].asset_id);assert.equal(final.media[0].url,undefined);
await assert.rejects(db.query('SELECT privacy_test.set_protected_visibility($1,$2,$3)',[other,post,'followers']),/Owned/);
await db.exec('RESET ROLE; SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[other]);assert.equal((await db.query('SELECT id FROM privacy_test.posts')).rows.length,0);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);assert.equal((await db.query('SELECT id FROM privacy_test.posts')).rows.length,1);
await db.exec('RESET ROLE');await db.close();console.log('Legacy workflow, raw-reference guard, ownership, leases, quarantine RLS, time/probe gates and atomic finalization passed locally.');
