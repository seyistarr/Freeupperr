// Local preparation SQL checks only. Not a PITR restore or external delivery.
const {PGlite}=await import(process.env.FREEUPPER_TEST_PGLITE_MODULE||'@electric-sql/pglite');
import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite(),sql=readFileSync(new URL('../scripts/privacy-v2/prepare-pitr.sql',import.meta.url),'utf8');
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA privacy_test;CREATE SCHEMA cron;
CREATE TABLE privacy_test.legacy_media_jobs(id uuid PRIMARY KEY);INSERT INTO privacy_test.legacy_media_jobs VALUES('99270662-125a-48fe-828e-469da012b29a'),('f3181572-90ce-4226-9e07-370d0417ee5c');CREATE TABLE cron.job(jobid bigint,active boolean);INSERT INTO cron.job VALUES(1,true),(2,false);`);
await assert.rejects(db.exec(sql),/recovery preparation/);await db.exec('ROLLBACK');
await db.exec("SET freeupper.privacy_v2_project_ref='tagkrhvgcbnybiuyvjxt';SET freeupper.privacy_v2_recovery_exercise='quiesce-isolated-staging-only';");
await db.exec(sql);
assert.equal((await db.query('SELECT count(*) AS n FROM cron.job WHERE active')).rows[0].n,0);
assert.deepEqual((await db.query('SELECT active_cron_ids FROM privacy_test.pitr_exercise_markers')).rows[0].active_cron_ids,[1]);
assert.equal((await db.query("SELECT has_table_privilege('authenticated','privacy_test.pitr_exercise_markers','SELECT') AS allowed")).rows[0].allowed,false);
console.log('PASS: staging-only recovery preparation requires acknowledgement, pauses cron and records only active job IDs');await db.close();
