import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,register,profile,migration} from './helpers/default-identity-fixture.js';
const template=await readFile('docs/identity/stage2-apply.template.sql','utf8');
const references=await readFile('docs/identity/stage2-mentions.sql','utf8');
const preview=await readFile('docs/identity/stage2-preview.sql','utf8');
const postPreview=await readFile('docs/identity/stage2-reference-preview.sql','utf8');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
async function legacy(db,id,values){
 await db.exec('alter table profiles disable trigger validate_profile_identity');
 await db.query('update profiles set username=$1,display_name=$2,display_username=$3 where id=$4',[values.username,values.display_name,values.display_username??null,id]);
 await db.exec('alter table profiles enable trigger validate_profile_identity');
}
async function plan(db){
 const fields=(await db.query(preview)).rows;const posts=(await db.query(postPreview)).rows;
 let sql=template.replace('-- REF_REWRITE_HELPERS',()=>references).replace('-- REF_REWRITE_AND_GUARDS','');
 const confirmed=fields.filter(x=>x.decision==='confirmed_exact_verified_email');
 if(confirmed.length)sql=sql.replace('-- APPROVED_FIELD_MANIFEST','insert into approved_identity_fields values '+confirmed.map(x=>'('+[x.freeupper_id,x.field,x.guard_token].map(quote).join(',')+')').join(',')+';');
 if(posts.length)sql=sql.replace('-- APPROVED_POST_MANIFEST','insert into approved_mention_posts values '+posts.map(x=>'('+quote(x.post_id)+','+quote(x.guard_token)+','+x.expected_references+')').join(',')+';');
 return {sql:sql.replace(/ROLLBACK;\s*$/,'COMMIT;'),fields,posts};
}
test('Stage 1 creates no email aliases, rejects email lookups and preserves custom presentation on normal updates',async()=>{
 const db=await setup();try{
 const id=await register(db);await db.query("update profiles set username='custom',display_name='Custom Name',display_username='PersonalLabel' where id=$1",[id]);
 await db.query("update profiles set username='another' where id=$1",[id]);assert.equal((await profile(db,id)).display_username,'PersonalLabel');
 assert.equal((await db.query("select * from get_public_profile_by_username('private@example.test')")).rows.length,0);
 assert.equal((await db.query("select profile_id from get_public_profile_by_username('another')")).rows[0].profile_id,id);
 assert.doesNotMatch(migration,/username_aliases|migration_backup/);
 await assert.rejects(db.query("update profiles set display_username='private@example.test' where id=$1",[id]),/Invalid presentation/);
 }finally{await db.close();}
});
test('verified-email equality classifies each field independently; custom, different-email and unverified values are excluded',async()=>{
 const db=await setup();try{
 const a=await register(db),b=await register(db),c=await register(db),d=await register(db);
 await legacy(db,a,{username:'private@example.test',display_name:'Genuine Custom',display_username:'PersonalLabel'});
 await legacy(db,b,{username:'custom_b',display_name:'private@example.test',display_username:'private@example.test'});
 await legacy(db,c,{username:'custom_c',display_name:'other@example.test'});
 await legacy(db,d,{username:'custom_d',display_name:'private@example.test'});await db.query('update auth.users set email_confirmed_at=null where id=$1',[d]);
 const rows=(await db.query(preview)).rows;const confirmed=rows.filter(x=>x.decision==='confirmed_exact_verified_email');
 assert.equal(confirmed.filter(x=>x.field==='username').length,1);assert.equal(confirmed.filter(x=>x.field==='display_name').length,1);assert.equal(confirmed.filter(x=>x.field==='display_username').length,1);
 assert.equal(rows.filter(x=>x.decision==='ambiguous_at_value').length,2);
 assert.equal(confirmed.find(x=>x.field==='display_username').proposed_value,'custom_b');
 assert.doesNotMatch(JSON.stringify(rows),/private@example.test|other@example.test/);
 const before=await profile(db,a),pf=await plan(db);await db.exec(pf.sql);
 let after=await profile(db,a);assert.equal(after.username,before.freeupper_id.toLowerCase());assert.equal(after.display_name,'Genuine Custom');assert.equal(after.display_username,'PersonalLabel');
 assert.equal((await profile(db,b)).username,'custom_b');assert.equal((await profile(db,b)).display_name,'FreeUpper User');assert.equal((await profile(db,b)).display_username,'custom_b');
 assert.equal((await profile(db,c)).display_name,'other@example.test');assert.equal((await profile(db,d)).display_name,'private@example.test');
 assert.equal(after.id,a);assert.equal(after.freeupper_id,before.freeupper_id);assert.deepEqual(after.created_at,before.created_at);assert.equal(after.profile_setup_completed_at,null);
 }finally{await db.close();}
});
test('Stage 2 rewrites only UUID-proven mention spans including UTF-16 offsets and retains posts/relationships',async()=>{
 const db=await setup();try{
 const a=await register(db),b=await register(db);await legacy(db,a,{username:'private@example.test',display_name:'private@example.test',display_username:'private@example.test'});
 await db.exec('create table follows(follower_id uuid references profiles(id),following_id uuid references profiles(id));');await db.query('insert into follows values($1,$2)',[a,b]);
 const text='😀 @private@example.test and @friend';const start=3,end=start+'@private@example.test'.length;const second=text.indexOf('@friend');
 const mentions=[{userId:a,username:'private@example.test',displayName:'private@example.test',start,end,type:'user'},{userId:b,username:'friend',displayName:'Friend',start:second,end:second+7,type:'user'}];
 const p=(await db.query('insert into posts(user_id,content,mentions) values($1,$2,$3) returning *',[b,text,mentions])).rows[0];
 const pf=await plan(db);assert.equal(pf.posts.length,1);await db.exec(pf.sql);
 const changed=(await db.query('select * from posts where id=$1',[p.id])).rows[0];const handle=(await profile(db,a)).username;
 assert.equal(changed.content,'😀 @'+handle+' and @friend');assert.equal(changed.mentions[0].userId,a);assert.equal(changed.mentions[0].displayName,'FreeUpper User');assert.equal(changed.mentions[0].end,3+handle.length+1);
 assert.equal(changed.mentions[1].start,changed.content.indexOf('@friend'));assert.equal(changed.id,p.id);assert.equal(changed.user_id,b);assert.deepEqual(changed.created_at,p.created_at);
 assert.equal((await db.query('select count(*) n from follows')).rows[0].n,1);
 assert.doesNotMatch(JSON.stringify(changed),/private@example.test/);
 assert.equal((await db.query("select * from get_public_profile_by_username('private@example.test')")).rows.length,0);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from identity_private.stage2_profile_backup'),/permission/);await assert.rejects(db.query('select * from identity_private.stage2_post_backup'),/permission/);await db.exec('reset role');}
 }finally{await db.close();}
});
test('stale field/verification evidence and unsafe reference text abort without partial changes',async()=>{
 for(const mode of ['customized','unverified','unsafe_text']){
 const db=await setup();try{
 const id=await register(db);await legacy(db,id,{username:'private@example.test',display_name:'Custom'});
 if(mode==='unsafe_text')await db.query('insert into posts(content,mentions) values($1,$2)',['@private@example.test contact private@example.test',[{userId:id,username:'private@example.test',displayName:'Custom',start:0,end:21}]]);
 const pf=await plan(db);
 if(mode==='customized')await db.query("update profiles set display_name='Later Custom' where id=$1",[id]);
 if(mode==='unverified')await db.query('update auth.users set email_confirmed_at=null where id=$1',[id]);
 await assert.rejects(db.exec(pf.sql),mode==='unsafe_text'?/Unreviewed email occurrence/:/Field evidence changed/);await db.exec('rollback');
 assert.equal((await profile(db,id)).username,'private@example.test');
 assert.equal((await db.query("select to_regclass('identity_private.stage2_profile_backup') x")).rows[0].x,null);
 }finally{await db.close();}
 }
});
test('collision guards reject the batch; presentation custom values never get overwritten',async()=>{
 const db=await setup();try{
 const a=await register(db),b=await register(db);await legacy(db,a,{username:'private@example.test',display_name:'Personal',display_username:'PersonalHandle'});
 const id=(await profile(db,a)).freeupper_id;
 await db.exec('alter table profiles disable trigger validate_profile_identity');await db.query('update profiles set username=$1 where id=$2',[id.toLowerCase(),b]);await db.exec('alter table profiles enable trigger validate_profile_identity');
 const pf=await plan(db);await assert.rejects(db.exec(pf.sql),/conflict/);await db.exec('rollback');assert.equal((await profile(db,a)).display_username,'PersonalHandle');
 }finally{await db.close();}
});
test('rollback requires explicit email-reexposure approval and refuses later customization',async()=>{
 const db=await setup();try{
 const id=await register(db);await legacy(db,id,{username:'private@example.test',display_name:'Original Custom'});const old=await profile(db,id);
 const pf=await plan(db);await db.exec(pf.sql);const rollback=(await readFile('docs/identity/stage2-rollback.sql','utf8')).replace(/ROLLBACK;\s*$/,'COMMIT;');
 await assert.rejects(db.exec(rollback),/not authorized/);await db.exec('rollback');
 await db.query("update profiles set username='later_custom' where id=$1",[id]);
 const approved=rollback.replace('BEGIN;',"BEGIN;SET LOCAL identity.explicit_email_reexposure_approval='approved';");await assert.rejects(db.exec(approved),/Subsequent identity customization/);await db.exec('rollback');assert.equal((await profile(db,id)).username,'later_custom');
 // In this isolated fixture only, restore the migration output to test the exceptional restore.
 await db.query('update profiles set username=$1 where id=$2',[old.freeupper_id.toLowerCase(),id]);await db.exec(approved);assert.equal((await profile(db,id)).username,old.username);assert.equal((await profile(db,id)).display_name,'Original Custom');
 }finally{await db.close();}
});

test('stale-offset mention metadata is scrubbed without rewriting unrelated post text',async()=>{
 const db=await setup();try{
 const id=await register(db);await legacy(db,id,{username:'private@example.test',display_name:'private@example.test'});
 const p=(await db.query('insert into posts(content,mentions) values($1,$2) returning *',['safe',[{userId:id,username:'private@example.test',displayName:'private@example.test',start:10,end:35,type:'user'}]])).rows[0];
 await db.exec((await plan(db)).sql);const after=(await db.query('select * from posts where id=$1',[p.id])).rows[0];
 assert.equal(after.content,p.content);assert.equal(after.id,p.id);assert.equal(after.mentions[0].start,10);assert.equal(after.mentions[0].end,35);assert.doesNotMatch(JSON.stringify(after),/private@example.test/);
 }finally{await db.close();}
});

test('newly confirmed fields and nested identity snapshots cannot be silently left outside the approved plan',async()=>{
 for(const mode of ['new_field','nested']){
 const db=await setup();try{
 const a=await register(db),b=await register(db);await legacy(db,a,{username:'private@example.test',display_name:'Custom'});
 if(mode==='nested')await db.query('insert into posts(publish_payload) values($1)',[{mentions:[{userId:a,username:'private@example.test'}]}]);
 const pf=await plan(db);
 if(mode==='new_field')await legacy(db,b,{username:'other',display_name:'private@example.test'});
 await assert.rejects(db.exec(pf.sql),mode==='new_field'?/exposure set changed/:/Nested identity snapshot/);await db.exec('rollback');assert.equal((await profile(db,a)).username,'private@example.test');
 }finally{await db.close();}
 }
});
