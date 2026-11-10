'use strict';
// Offline contract guard. Requires no Cloudinary or Supabase credentials.
// Run: node --test tests/chat-private-contract.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const load=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const sql=load('docs/chat/sql/proposed-private-view-once.sql');
const upload=load('supabase/functions/chat-private-upload/index.ts');
const open=load('supabase/functions/view-once-open/index.ts');
const cleanup=load('supabase/functions/chat-private-cleanup/index.ts');

test('Edge Functions use a pinned Deno-native Supabase import',()=>{
  for(const src of [upload,open,cleanup]) {
    assert.match(src,/from 'jsr:@supabase\\/supabase-js@2\\.110\\.8'/);
    assert.doesNotMatch(src,/from 'npm:@supabase\\/supabase-js@2'/);
  }
});
test('private media functions are fail-closed until explicitly enabled',()=>{
  for(const src of [upload,open,cleanup])
    assert.match(src,/CHAT_PRIVATE_MEDIA_ENABLED/);
});
test('private upload authenticates user and never returns a Cloudinary URL',()=>{
  assert.match(upload,/auth\.getUser\(token\)/);
  assert.match(upload,/chat_publish_private_view_once/);
  assert.doesNotMatch(upload,/chat_register_private_asset/);
  assert.match(upload,/type:'authenticated'/);
  assert.match(upload,/removeUnregisteredAsset/);
  assert.doesNotMatch(upload,/return response\(req,\{[^\n]*secure_url/);
});
test('one-time delivery requires JWT plus server-side membership and atomic claim',()=>{
  assert.match(open,/auth\.getUser\(authorization\.slice\(7\)\)/);
  assert.match(open,/chat_check_private_asset/);
  assert.match(open,/userDb\.rpc\('claim_view_once'/);
  assert.match(open,/p_media_index:0/);
  assert.doesNotMatch(open,/chat_claim_private_asset/);
  assert.match(open,/asset\/download/);
  assert.match(open,/new Uint8Array\(count\)/);
  assert.match(open,/Cache-Control/);
  assert.doesNotMatch(open,/unclaim_view_once/);
});
test('claims must not be accessible directly by authenticated clients',()=>{
  for(const name of ['chat_check_private_asset','chat_publish_private_view_once'])
    assert.match(sql,new RegExp('grant execute on function public\\.'+name+'\\([^;]*to service_role;','s'));
  assert.match(sql,/revoke all on schema chat_private from public, anon, authenticated/);
  assert.doesNotMatch(sql,/create or replace function public\.chat_claim_private_asset/);
  assert.match(sql,/viewer_id = \(select auth\.uid\(\)\)/);
});
test('asset registry survives message deletion for scheduled cleanup',()=>{
  assert.match(sql,/references public\.messages\(id\) on delete set null/);
  assert.match(sql,/cleanup_locked_until/);
  assert.match(sql,/for update skip locked/);
  assert.match(sql,/chat_finish_private_cleanup/);
  assert.match(cleanup,/x-chat-cleanup-key/);
  assert.match(cleanup,/chat_claim_private_cleanup_batch/);
  assert.match(cleanup,/chat_finish_private_cleanup/);
});
test('historical message media metadata is not rewritten or mass deleted',()=>{
  assert.doesNotMatch(sql,/update public\.messages\s+set\s+metadata/i);
  assert.doesNotMatch(sql,/delete from public\.messages/i);
});

test('publication is atomic and occurs only after a private upload',()=>{
  assert.match(sql,/create or replace function public\.chat_publish_private_view_once/);
  assert.match(sql,/insert into public\.messages/);
  assert.match(sql,/insert into chat_private\.view_once_assets/);
  assert.match(upload,/chat_publish_private_view_once/);
  assert.match(upload,/status:'published'/);
  assert.doesNotMatch(upload,/from\('messages'\)\s*\.insert/);
  assert.match(sql,/coalesce\(c\.is_group,false\)/);
});

test('private_asset markers cannot bypass registry or be rewritten later',()=>{
  assert.match(sql,/create constraint trigger chat_private_asset_registered/);
  assert.match(sql,/deferrable initially deferred for each row/);
  assert.match(sql,/chat_private\.view_once_assets a/);
  assert.match(sql,/a\.uploader_id = new\.sender_id/);
  assert.match(sql,/create trigger chat_private_message_update_guard/);
  assert.match(sql,/new\.metadata is distinct from old\.metadata/);
  assert.match(sql,/new\.media_url is distinct from old\.media_url/);
});

test('review SQL functions use balanced PostgreSQL dollar-quoted bodies',()=>{
  const opening=(sql.match(/\bas \$\$/g)||[]).length;
  const closing=(sql.match(/\bend \$\$;/g)||[]).length;
  assert.ok(opening >= 4, 'Expected all private-media RPCs and guards');
  assert.equal(opening,closing,'PL/pgSQL body count must match');
  assert.doesNotMatch(sql,/\bas \$(?!\$)\s*\n/);
  assert.doesNotMatch(sql,/\bend \$(?!\$);/);
});
