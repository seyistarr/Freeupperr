// Optional native PostgreSQL 17 test. Never accepts a remote database URL.
// Install test binaries under /tmp (see docs/quote-reposts/README.md), then set
// FREEUPPER_QUOTE_PG_MODULE_ROOT to that directory. No repository dependencies change.
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {setup,uid,migration} from '../tests/helpers/quote-database-fixture.js';
const moduleRoot=process.env.FREEUPPER_QUOTE_PG_MODULE_ROOT;
if(!moduleRoot)throw Error('Set FREEUPPER_QUOTE_PG_MODULE_ROOT to the isolated PostgreSQL test package directory');
const require=createRequire(join(resolve(moduleRoot),'package.json'));
const EmbeddedPostgres=(await import(require.resolve('embedded-postgres'))).default;
const {Client}=require('pg');
const dir=await mkdtemp(join(tmpdir(),'freeupper-quote-concurrency-'));
const port=56349;
const server=new EmbeddedPostgres({databaseDir:join(dir,'data'),user:'postgres',password:'local-fixture-only',port,persistent:false,onLog(){},onError(){}});
let admin;
try {
 await server.initialise();await server.start();
 admin=new Client({host:'127.0.0.1',port,user:'postgres',password:'local-fixture-only',database:'postgres'});await admin.connect();
 const db={exec:s=>admin.query(s),query:(s,p)=>admin.query(s,p)};
 await setup(db);await db.exec(migration);await db.exec('UPDATE privacy_v2_private.quote_repost_rollout SET publishing_enabled=true');
 for(let i=10;i<30;i++)await admin.query('INSERT INTO profiles(id,username) VALUES($1,$2)',[uid(i),'concurrent'+i]);
 async function tx(actor,sql,params=[]) {
  for(let attempt=0;attempt<8;attempt++) {
   const c=new Client({host:'127.0.0.1',port,user:'postgres',password:'local-fixture-only',database:'postgres'});await c.connect();
   try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor]);const r=await c.query(sql,params);await c.query('COMMIT');return r;}
   catch(e){await c.query('ROLLBACK');if(!['40P01','40001'].includes(e.code)||attempt===7)throw e;}
   finally{await c.end();}
  }
 }
 const target=uid(100);
 const count=async()=>(await admin.query('SELECT repost_count FROM posts WHERE id=$1',[target])).rows[0]?.repost_count;
 await Promise.all(Array.from({length:12},(_,i)=>tx(uid(6),'SELECT * FROM create_quote_post($1,$2,$3)',[uid(300+i),target,{}])));
 assert.equal(await count(),12);
 await Promise.all(Array.from({length:12},()=>tx(uid(6),'SELECT * FROM create_quote_post($1,$2,$3)',[uid(350),target,{}])));
 assert.equal(await count(),13);assert.equal((await admin.query('SELECT count(*)::int AS n FROM posts WHERE id=$1',[uid(350)])).rows[0].n,1);
 await Promise.all(Array.from({length:12},(_,i)=>tx(uid(10+i),'SELECT * FROM toggle_repost($1,$2,$3)',[target,uid(10+i),'note'])));
 assert.equal(await count(),25);
 await Promise.all(Array.from({length:12},(_,i)=>tx(uid(10+i),'SELECT * FROM toggle_repost($1,$2::text)',[target,''])));
 assert.equal(await count(),13);
 await Promise.all(Array.from({length:12},(_,i)=>tx(uid(6),'SELECT delete_post($1)',[uid(300+i)])));
 assert.equal(await count(),1);
 await Promise.all(Array.from({length:12},(_,i)=>tx(uid(6),'SELECT restore_post($1)',[uid(300+i)])));
 assert.equal(await count(),13);
 await Promise.all(Array.from({length:20},()=>tx(uid(10),'SELECT * FROM toggle_repost($1,$2::text)',[target,''])));
 assert.equal(await count(),13);
 const race=await Promise.allSettled([tx(uid(6),'SELECT * FROM create_quote_post($1,$2,$3)',[uid(360),target,{}]),tx(uid(1),'SELECT permanently_delete_post($1)',[target])]);
 assert.equal(race[1].status,'fulfilled');
 const tombstones=await admin.query('SELECT id,is_quote,quoted_post_id FROM posts WHERE is_quote');
 assert(tombstones.rows.every(r=>r.is_quote&&r.quoted_post_id===null));
 const leaked=await admin.query('SELECT original FROM load_quote_references($1)',[tombstones.rows.map(r=>r.id)]);
 assert(leaked.rows.every(r=>r.original===null));
 console.log('PostgreSQL 17 concurrency PASS: parallel quotes, duplicate retries, both plain RPCs, delete/restore, repeated toggles and original-deletion race');
} finally {
 await admin?.end();await server.stop().catch(()=>{});await rm(dir,{recursive:true,force:true});
}
