// New migrations only, isolated ephemeral database; never connects to Supabase.
const {PGlite}=await import(process.env.FREEUPPER_TEST_PGLITE_MODULE || '@electric-sql/pglite');
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
CREATE SCHEMA privacy_test;CREATE TABLE privacy_test.profiles(id uuid PRIMARY KEY,is_private boolean DEFAULT false,suspended boolean DEFAULT false);
CREATE TABLE privacy_test.follows(follower_id uuid,following_id uuid,status text,PRIMARY KEY(follower_id,following_id));
CREATE TABLE privacy_test.posts(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES privacy_test.profiles,visibility text NOT NULL,is_hidden boolean DEFAULT false,is_deleted boolean DEFAULT false);
CREATE TABLE privacy_test.post_media_assets(id uuid PRIMARY KEY,post_id uuid NOT NULL REFERENCES privacy_test.posts,owner_id uuid NOT NULL REFERENCES privacy_test.profiles,status text NOT NULL,delivery_type text NOT NULL,cloudinary_public_id text NOT NULL,cloudinary_asset_id text,resource_type text NOT NULL,format text NOT NULL);
GRANT USAGE ON SCHEMA privacy_test TO service_role,anon,authenticated;GRANT ALL ON ALL TABLES IN SCHEMA privacy_test TO service_role;
ALTER TABLE privacy_test.posts ENABLE ROW LEVEL SECURITY;CREATE POLICY legacy_broad ON privacy_test.posts FOR SELECT TO anon,authenticated USING(true);
GRANT SELECT ON ALL TABLES IN SCHEMA privacy_test TO anon,authenticated;SET freeupper.privacy_v2_project_ref='tagkrhvgcbnybiuyvjxt';`);
for(const f of ['protected-publishing','readers-cleanup','legacy-media','owner-consent','independent-revocation','recovery-exercise'])await db.exec(readFileSync(new URL('../staging-migrations/privacy-v2-'+f+'.sql',import.meta.url),'utf8'));
const owner='ea903e28-c74f-4202-9d4a-3dd9bd2a2178',other='10000000-0000-4000-8000-000000000002',post='f352427f-29e3-4088-8dd3-c825ee29c04d',video='5dddda69-b3a7-4d78-8baa-e88571b6274b';
await db.query('INSERT INTO privacy_test.profiles(id) VALUES($1),($2)',[owner,other]);
await db.query("INSERT INTO privacy_test.posts(id,user_id,visibility) VALUES($1,$2,'public'),($3,$2,'public')",[post,owner,video]);
await db.exec('SET ROLE service_role');
const consent=(who,action,visibility='only_me',ack=true)=>db.query('SELECT privacy_test.legacy_owner_consent($1,$2,$3,$4,$5) AS result',[who,post,action,visibility,ack]);
await assert.rejects(consent(other,'legacy-consent'),/Owned post/);
await assert.rejects(consent(owner,'legacy-consent','only_me',false),/Explicit consent/);
await consent(owner,'legacy-consent');await consent(owner,'legacy-consent'); // exact retry
await assert.rejects(consent(owner,'legacy-consent','followers'),/differs/);
const original=(await db.query('SELECT to_jsonb(p) AS row FROM privacy_test.posts p WHERE id=$1',[post])).rows[0].row;
const insert=()=>db.query("INSERT INTO privacy_test.legacy_media_jobs(post_id,owner_id,target_visibility,original_row,current_row,plan) VALUES($1,$2,'only_me',$3,$3,$4) RETURNING id",[post,owner,JSON.stringify(original),JSON.stringify({entries:[{slot:0}],sources:[]})]);
const id=(await insert()).rows[0].id;
await assert.rejects(consent(owner,'legacy-quarantine-consent'),/All copies/);
await db.query("UPDATE privacy_test.legacy_media_jobs SET copies='{"+'"0":{"asset_id":"copy"}}'+"' WHERE id=$1",[id]);
await assert.rejects(db.query("UPDATE privacy_test.legacy_media_jobs SET state='quarantined' WHERE id=$1",[id]),/consent/);
await consent(owner,'legacy-quarantine-consent');
await db.query("UPDATE privacy_test.legacy_media_jobs SET state='quarantined' WHERE id=$1",[id]);
await db.query("UPDATE privacy_test.legacy_media_jobs SET state='revoking',revocation_started_at=now() WHERE id=$1",[id]);
await assert.rejects(db.query("UPDATE privacy_test.legacy_media_jobs SET observations='[{\"vantage\":\"forged\"}]' WHERE id=$1",[id]),/deadline/);
// Even a simulated elapsed clock cannot accept an unattested location label.
await db.query("UPDATE privacy_test.legacy_media_jobs SET revocation_started_at='2020-01-01' WHERE id=$1",[id]);
await assert.rejects(db.query("UPDATE privacy_test.legacy_media_jobs SET state='verified' WHERE id=$1",[id]),/deadline|immutable runner/);
await db.query("INSERT INTO privacy_test.legacy_media_events(job_id,action,details) VALUES($1,'exercise','{}')",[id]);
await assert.rejects(db.query("UPDATE privacy_test.legacy_media_events SET action='rewrite'"),/permission denied|append-only/);
await assert.rejects(db.exec('TRUNCATE privacy_test.legacy_media_events'),/permission denied|append-only/);
const backup=(await db.query("SELECT privacy_test.synthetic_recovery_exercise('backup') AS result")).rows[0].result;
const restored=(await db.query("SELECT privacy_test.synthetic_recovery_exercise('restore-exercise',$1) AS result",[backup.exercise_id])).rows[0].result;
assert.equal(restored.matches,true);assert.equal(restored.rows,2);
assert.equal((await db.query('SELECT to_jsonb(p) AS row FROM privacy_test.posts p WHERE id=$1',[post])).rows[0].row.visibility,'public');
assert.equal((await db.query('SELECT privacy_test.legacy_reference_conflicts($1,$2) AS n',[post,JSON.stringify([])])).rows[0].n,0);
// Exercise receipt ingestion with a simulated past deadline in this local database ONLY.
// This is a logic test, never qualifying live evidence.
await db.exec('RESET ROLE');
const sql=readFileSync(new URL('../staging-migrations/privacy-v2-independent-revocation.sql',import.meta.url),'utf8');
for(const name of ['guard_independent_revocation','ingest_independent_revocation']) {
 const start=sql.indexOf('CREATE FUNCTION privacy_test.'+name);
 const end=sql.indexOf('END $$;',start)+7;
 await db.exec(sql.slice(start,end).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replaceAll('2026-11-20 21:04:08+00','2020-01-01 00:00:00+00'));
}
await db.exec('SET ROLE service_role');
await db.query("UPDATE privacy_test.posts SET is_hidden=true,publishing_state='draft',legacy_migration_state='pending' WHERE id=$1",[post]);
const current=(await db.query('SELECT to_jsonb(p) AS row FROM privacy_test.posts p WHERE id=$1',[post])).rows[0].row;
const urls=['https://res.cloudinary.com/sxdcqs5x/image/upload/freeupper-privacy-v2-staging/'+owner+'/legacy_acceptance_image.png'];
const source='a'.repeat(32),plan={entries:[{slot:0}],sources:[{asset_id:source,probe_urls:urls}]};
await db.query("UPDATE privacy_test.legacy_media_jobs SET current_row=$2,plan=$3,deletions=$4 WHERE id=$1",[id,JSON.stringify(current),JSON.stringify(plan),JSON.stringify({[source]:'2020-01-01T00:00:00Z'})]);
const now=Date.now(), receipt=(runner,offset,account)=>({runner,account,bucket:'freeupper-staging-revocation-'+runner,key:'privacy-v2/'+runner+'.json',version:'immutable-version',sha256:'b'.repeat(64),manifest_sha256:'c'.repeat(64),checked_at:new Date(now-offset).toISOString(),stored_at:new Date(now-offset+1000).toISOString(),retention_until:new Date(now+90*86400000).toISOString()});
const receipts=[receipt('first',70*60000,'111111111111'),receipt('second',10*60000,'222222222222')];
const manifest={project:'tagkrhvgcbnybiuyvjxt',cloud:'sxdcqs5x',synthetic:true,jobs:[{id,revoked_at:'2020-01-01T00:00:00Z',urls}]};
const ingest=value=>db.query('SELECT privacy_test.ingest_independent_revocation($1,$2,$3)',[id,JSON.stringify(manifest),JSON.stringify(value)]);
await assert.rejects(ingest(receipts.map(r=>({...r,retention_until:null}))),/Immutable/);
await assert.rejects(ingest(receipts.map(r=>({...r,account:'111111111111'}))),/incomplete/);
await ingest(receipts);await ingest(receipts);
assert.equal((await db.query('SELECT state FROM privacy_test.legacy_media_jobs WHERE id=$1',[id])).rows[0].state,'verified');
await assert.rejects(db.exec("UPDATE privacy_test.independent_revocation_receipts SET receipts='[]'"),/permission denied|append-only/);
await db.exec('RESET ROLE;SET ROLE authenticated');
await assert.rejects(consent(owner,'legacy-status'),/permission denied/);
await assert.rejects(db.query('SELECT * FROM privacy_test.recovery_exercises'),/permission denied/);
await db.exec('RESET ROLE;SET ROLE service_role');
await db.query("UPDATE privacy_test.posts SET publishing_state='draft',is_hidden=true,draft_expires_at=now()-interval '1 hour' WHERE id=$1",[video]);
assert.equal((await db.query('SELECT privacy_test.privacy_v2_monitor() AS m')).rows[0].m.expired_drafts,1);
console.log('PASS: owner consent, copy/quarantine gates, unattested checks denied, append-only events, private synthetic restore');
await db.close();
