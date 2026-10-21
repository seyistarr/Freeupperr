// Local synthetic-only fixture model; no Cloudinary or Supabase calls.
const {PGlite}=await import(process.env.FREEUPPER_TEST_PGLITE_MODULE||'@electric-sql/pglite');
import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite(),manifest=JSON.parse(readFileSync(new URL('../scripts/privacy-v2/revocation-fixtures.json',import.meta.url))),sql=readFileSync(new URL('../staging-migrations/privacy-v2-synthetic-probe-aliases.sql',import.meta.url),'utf8');
await db.exec(`CREATE SCHEMA privacy_test;CREATE TABLE privacy_test.legacy_media_jobs(id uuid PRIMARY KEY,owner_id uuid,state text,observations jsonb,verified_at timestamptz,plan jsonb,revocation_started_at timestamptz);CREATE TABLE privacy_test.legacy_media_events(job_id uuid,action text,details jsonb);`);
for(const job of manifest.jobs)await db.query("INSERT INTO privacy_test.legacy_media_jobs VALUES($1,'ea903e28-c74f-4202-9d4a-3dd9bd2a2178','revoking','[]',NULL,$2,$3)",[job.id,JSON.stringify({sources:[{probe_urls:job.urls.filter(url=>!url.includes('/v1/'))}]}),job.revoked_at]);
await assert.rejects(db.exec(sql),/acknowledgement/);await db.exec('ROLLBACK');
await db.exec("SET freeupper.privacy_v2_project_ref='tagkrhvgcbnybiuyvjxt'");
await db.exec(sql);await db.exec(sql);
for(const job of manifest.jobs){const row=(await db.query('SELECT * FROM privacy_test.legacy_media_jobs WHERE id=$1',[job.id])).rows[0];assert.deepEqual([...row.plan.sources[0].probe_urls].sort(),[...job.urls].sort());assert.equal(new Date(row.revocation_started_at).getTime(),Date.parse(job.revoked_at));assert.deepEqual(row.observations,[]);assert.equal(row.verified_at,null);}
console.log('PASS: aliases expand idempotently with exact clocks and zero observations preserved');await db.close();
