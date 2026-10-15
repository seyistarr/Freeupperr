// Staging-only real-database authorization checks. Never run against production.
// Requires STAGING_SUPABASE_DB_URL for isolated Supabase project tagkrhvgcbnybiuyvjxt.
// No real auth tokens, no media URLs, no production credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { authorizeProtectedMedia } from '../../api/post-media-access.js';
const expectedHost = 'db.tagkrhvgcbnybiuyvjxt.supabase.co';
const url = process.env.STAGING_SUPABASE_DB_URL;
assert.ok(url, 'STAGING_SUPABASE_DB_URL is required for explicit staging integration test');
const parsed = new URL(url);
assert.equal(parsed.protocol, 'postgresql:', 'Postgres URL required');
assert.equal(parsed.hostname, expectedHost, 'Only isolated staging project is permitted');
const client = new pg.Client({ connectionString:url, ssl:{rejectUnauthorized:true}, connectionTimeoutMillis:10000 });
const ids = {author:'10000000-0000-4000-8000-000000000001',approved:'10000000-0000-4000-8000-000000000002',pending:'10000000-0000-4000-8000-000000000003',stranger:'10000000-0000-4000-8000-000000000004',asset:'30000000-0000-4000-8000-000000000001'};
const tables = new Set(['posts','profiles','follows']);
function dbAdapter() {
  return {from(table) {
    assert.ok(tables.has(table));
    const filters=[];
    const q={select(fields){q.fields=fields;return q;},eq(k,v){assert.match(k,/^[a-z_]+$/);filters.push([k,v]);return q;},
      async maybeSingle(){
        const where=filters.map(([k],i)=>'"'+k+'" = $'+(i+1)).join(' AND ');
        const cols=q.fields.split(',').map(s=>'"'+s.trim()+'"').join(',');
        try {
          const result=await client.query('SELECT '+cols+' FROM privacy_test.'+table+' WHERE '+where+' LIMIT 2',filters.map(x=>x[1]));
          if(result.rows.length>1)return {data:null,error:new Error('multiple rows')};
          return {data:result.rows[0]??null,error:null};
        } catch(error){return {data:null,error};}
      }};
    return q;
  }};
}
const asset={post_id:'20000000-0000-4000-8000-000000000001',owner_id:ids.author,status:'ready',delivery_type:'authenticated'};
test('isolated staging permissions and revocation within rolled-back transaction',async()=>{
  await client.connect();
  try {
    await client.query('BEGIN');
    const db=dbAdapter();
    assert.equal(await authorizeProtectedMedia({db,asset,viewerId:ids.author}),true,'owner');
    assert.equal(await authorizeProtectedMedia({db,asset,viewerId:ids.approved}),true,'approved');
    assert.equal(await authorizeProtectedMedia({db,asset,viewerId:ids.pending}),false,'pending');
    assert.equal(await authorizeProtectedMedia({db,asset,viewerId:ids.stranger}),false,'stranger');
    const updated=await client.query("UPDATE privacy_test.follows SET status='pending' WHERE follower_id=$1 AND following_id=$2 AND status='active' RETURNING status",[ids.approved,ids.author]);
    assert.equal(updated.rowCount,1,'approved relationship must exist');
    assert.equal(await authorizeProtectedMedia({db,asset,viewerId:ids.approved}),false,'revoked');
  } finally {
    await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
});
