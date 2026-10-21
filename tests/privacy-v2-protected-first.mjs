// Focused offline database model: core publishing works with NO legacy schema.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareProtectedFirst } from '../scripts/privacy-v2/prepare-protected-first.mjs';
const { PGlite } = await import(process.env.FREEUPPER_TEST_PGLITE_MODULE || '@electric-sql/pglite');
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const uuid = n => '10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=uuid(1),follower=uuid(2),mutual=uuid(3),denied=uuid(4),pending=uuid(5);
function routine(source,name,schema) {
 const start=source.search(new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+schema+'\\.'+name+'\\('));
 return source.slice(start,source.indexOf('$$;',source.indexOf('AS $$',start))+3);
}
async function model(schema) {
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 ${schema==='privacy_test'?'CREATE SCHEMA privacy_test;':''}
 CREATE TABLE ${schema}.profiles(id uuid PRIMARY KEY,suspended boolean DEFAULT false,is_private boolean DEFAULT false);
 CREATE TABLE ${schema}.follows(follower_id uuid,following_id uuid,status text,UNIQUE(follower_id,following_id));
 CREATE TABLE ${schema}.posts(id uuid PRIMARY KEY,user_id uuid NOT NULL,visibility text DEFAULT 'public',is_hidden boolean DEFAULT false,is_deleted boolean DEFAULT false,
 title text${schema==='public'?' NOT NULL':''},content text,source text${schema==='public'?" NOT NULL DEFAULT 'composer'":''},tags text[],comments_hidden boolean DEFAULT false,media jsonb DEFAULT '[]',media_type text,media_url text,thumbnail_url text,sound_id uuid,text_template_id uuid,created_at timestamptz DEFAULT now());
 ALTER TABLE ${schema}.posts ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA ${schema} TO anon,authenticated,service_role;
 GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO anon,authenticated;
 GRANT ALL ON ALL TABLES IN SCHEMA ${schema} TO service_role;`);
 for(let i=1;i<=5;i++){
  await db.query(`INSERT INTO ${schema}.profiles VALUES($1,false,$2)`,[uuid(i),i===1]);
  await db.query('INSERT INTO auth.users VALUES($1)',[uuid(i)]);
 }
 await db.query(`INSERT INTO ${schema}.follows VALUES($1,$2,'active'),($3,$2,'active'),($2,$3,'active'),($4,$2,'pending')`,[follower,owner,mutual,pending]);
 if(schema==='privacy_test'){
  await db.exec(`CREATE POLICY baseline ON privacy_test.posts FOR SELECT TO anon,authenticated USING(true);
  CREATE TABLE privacy_test.post_media_assets(id uuid PRIMARY KEY,post_id uuid,owner_id uuid,status text,delivery_type text,cloudinary_public_id text,cloudinary_asset_id text,resource_type text,format text);
  GRANT ALL ON privacy_test.post_media_assets TO service_role;
  SET freeupper.privacy_v2_project_ref='tagkrhvgcbnybiuyvjxt';`);
  for(const p of ['protected-publishing','readers-cleanup','protected-first'])await db.exec(read('staging-migrations/privacy-v2-'+p+'.sql'));
 }else{
  await db.exec(`CREATE POLICY "Anyone can view posts" ON public.posts FOR SELECT USING(true);
  CREATE POLICY "Enable read access for all users" ON public.posts FOR SELECT USING(true);
  CREATE POLICY "Posts are viewable by everyone" ON public.posts FOR SELECT USING(true);
  CREATE POLICY "Public read posts" ON public.posts FOR SELECT USING(true);
  CREATE POLICY "Users can manage own posts" ON public.posts FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
  ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
  CREATE POLICY follows_owner_write ON public.follows FOR ALL TO authenticated USING(auth.uid()=follower_id) WITH CHECK(auth.uid()=follower_id);
  CREATE POLICY follows_read ON public.follows FOR SELECT TO anon,authenticated USING(true);
  GRANT INSERT,UPDATE,DELETE ON public.posts TO authenticated;
  SET freeupper.privacy_v2_project_ref='jmjtqidirpmnegzvmiaq';SET freeupper.privacy_v2_reviewed_release='approved-production-migration';`);
  await db.exec(read('docs/privacy-v2/post-media-registry-migration-REVIEW.sql'));
  await db.exec(read('docs/privacy-v2/production-boundaries-REVIEW.sql'));
  await db.exec(read('docs/privacy-v2/production-follow-approval-REVIEW.sql'));
  await db.exec(read('docs/privacy-v2/post-rls-audience-migration-REVIEW.sql'));
  await db.exec(routine(read('docs/privacy-v2/production-rpc-exposure-fixes-REVIEW.sql'),'can_view_post_for','privacy_v2_private'));
  const generated=prepareProtectedFirst();
  assert.equal(generated,read('docs/privacy-v2/protected-first-production-REVIEW.sql'));
  assert.doesNotMatch(generated,/legacy_media_jobs|legacy_media_transition|legacy_owner_consent/);
  await db.exec(generated);
  await assert.rejects(db.query(`SELECT public.create_protected_draft($1,$2,'only_me',$3,$4)`,[owner,uuid(90),JSON.stringify([{slot:0,type:'image',role:'media'}]),JSON.stringify({source:'composer',tags:[]})]),/disabled/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM privacy_v2_private.protected_post_origins')).rows[0].n,0);
  // ONLY this disposable model activates flags. No network or production writes.
  await db.exec(`ALTER TABLE privacy_v2_private.release_control DROP CONSTRAINT release_control_new_protected_enabled_check,
   DROP CONSTRAINT release_control_protected_delivery_enabled_check;
   UPDATE privacy_v2_private.release_control SET new_protected_enabled=true,protected_delivery_enabled=true;
   INSERT INTO privacy_v2_private.follow_approvals(follower_id,following_id,approval_kind,approved_by)
   VALUES('${follower}','${owner}','owner','${owner}'),('${mutual}','${owner}','owner','${owner}');`);
 }
 const call=async(name,args)=> (await db.query(`SELECT ${schema}.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result;
 const fields={title:'Synthetic protected caption',content:'Synthetic content',tags:[],source:'composer',comments_hidden:false};
 const plan=[{slot:0,type:'image',role:'media'}],post=uuid(10);
 await db.exec('SET ROLE service_role');
 await call('create_protected_draft',[owner,post,'followers',JSON.stringify(plan),JSON.stringify(fields)]);
 await assert.rejects(call('protected_publish_transition',[owner,post,'publish','{}']),/Incomplete/);
 await assert.rejects(call('protected_publish_transition',[denied,post,'reserve',JSON.stringify({slot:0,public_id:'invalid'})]),/unavailable/);
 const namespace=schema==='public'?'freeupper-protected-v2':'freeupper-privacy-v2-staging';
 const pid=namespace+'/'+owner+'/asset_'+'a'.repeat(32);
 await call('protected_publish_transition',[owner,post,'reserve',JSON.stringify({slot:0,public_id:pid})]);
 const registration={slot:0,public_id:pid,cloudinary_asset_id:'b'.repeat(32),resource_type:'image',format:'png'};
 const registered=await call('protected_publish_transition',[owner,post,'register',JSON.stringify(registration)]);
 assert.deepEqual(await call('protected_publish_transition',[owner,post,'register',JSON.stringify(registration)]),registered);
 for(const viewer of [owner,follower,mutual,denied,pending,null]){
  await db.exec('RESET ROLE;SET ROLE '+(viewer?'authenticated':'anon'));
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer||'']);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${schema}.posts WHERE id=$1`,[post])).rows[0].n,0);
 }
 await db.exec('RESET ROLE;SET ROLE service_role');
 const published=await call('protected_publish_transition',[owner,post,'publish','{}']);assert.equal(published.status,'published');
 for(const visibility of ['followers','friends','only_me']){
  await call('set_new_protected_visibility',[owner,post,visibility]);
  for(const viewer of [owner,follower,mutual,denied,pending,null]){
   const allowed=viewer===owner||(visibility==='followers'&&[follower,mutual].includes(viewer))||(visibility==='friends'&&viewer===mutual);
   if(schema==='public')assert.equal(await call('authorize_protected_asset',[registered.asset_id,viewer]),allowed);
   await db.exec('RESET ROLE;SET ROLE '+(viewer?'authenticated':'anon'));
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer||'']);
   assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${schema}.posts WHERE id=$1`,[post])).rows[0].n,allowed?1:0);
   await assert.rejects(call('create_protected_draft',[owner,uuid(99),'only_me',JSON.stringify(plan),JSON.stringify(fields)]),/permission denied/);
   await db.exec('RESET ROLE;SET ROLE service_role');
  }
 }
 await assert.rejects(db.query(`UPDATE ${schema}.posts SET media_url='https://public.invalid/leak' WHERE id=$1`,[post]),/Public references/);
 await db.query(`UPDATE ${schema}.post_media_assets SET format='svg' WHERE id=$1`,[registered.asset_id]);
 await assert.rejects(db.query(`UPDATE ${schema}.posts SET is_hidden=false WHERE id=$1`,[post]),/Registered owned/);
 await db.query(`UPDATE ${schema}.post_media_assets SET format='png' WHERE id=$1`,[registered.asset_id]);
 await assert.rejects(call('create_protected_draft',[owner,uuid(97),'only_me',JSON.stringify(plan),JSON.stringify({...fields,sound_id:uuid(80)})]),/Unsupported/);
 const video=uuid(11),videoPlan=[{slot:0,type:'video',role:'media'},{slot:20,type:'image',role:'thumbnail'}];
 await call('create_protected_draft',[owner,video,'only_me',JSON.stringify(videoPlan),JSON.stringify({...fields,source:'studio'})]);
 const videoPid=namespace+'/'+owner+'/asset_'+'c'.repeat(32),posterPid=namespace+'/'+owner+'/asset_'+'d'.repeat(32);
 await call('protected_publish_transition',[owner,video,'reserve',JSON.stringify({slot:0,public_id:videoPid})]);
 await call('protected_publish_transition',[owner,video,'reserve',JSON.stringify({slot:20,public_id:posterPid})]);
 const videoAsset=await call('protected_publish_transition',[owner,video,'register',JSON.stringify({slot:0,public_id:videoPid,cloudinary_asset_id:'e'.repeat(32),resource_type:'video',format:'mp4'})]);
 await assert.rejects(call('protected_publish_transition',[owner,video,'publish','{}']),/Incomplete/);
 await assert.rejects(call('protected_publish_transition',[owner,video,'register',JSON.stringify({slot:20,public_id:posterPid,cloudinary_asset_id:'f'.repeat(32),resource_type:'video',format:'mp4'})]),/mismatch/);
 const posterAsset=await call('protected_publish_transition',[owner,video,'register',JSON.stringify({slot:20,public_id:posterPid,cloudinary_asset_id:'f'.repeat(32),resource_type:'image',format:'jpg'})]);
 const videoPublished=await call('protected_publish_transition',[owner,video,'publish','{}']);
 assert.equal(videoPublished.media[0].asset_id,videoAsset.asset_id);assert.equal(videoPublished.media[0].thumbnail_asset_id,posterAsset.asset_id);
 await assert.rejects(db.query(`UPDATE ${schema}.posts SET media=$1 WHERE id=$2`,[JSON.stringify([{type:'image',asset_id:posterAsset.asset_id}]),post]),/Registered owned/);
 if(schema==='public'){
  assert.equal(await call('authorize_protected_asset',[videoAsset.asset_id,owner]),true);
  assert.equal(await call('authorize_protected_asset',[posterAsset.asset_id,owner]),true);
  assert.equal(await call('authorize_protected_asset',[posterAsset.asset_id,denied]),false);
 }
 if(schema==='public'){
  await db.exec('RESET ROLE;SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.query("INSERT INTO public.posts(id,user_id,visibility,title,media_url) VALUES($1,$2,'public','Existing Public behavior','https://public.invalid/image.png')",[uuid(50),owner]);
  await assert.rejects(db.query("UPDATE public.posts SET visibility='only_me' WHERE id=$1",[uuid(50)]),/legacy conversion remains disabled/);
  await db.exec('RESET ROLE;SET ROLE service_role');
  const payload=(await db.query('SELECT title,content,source,tags FROM public.posts WHERE id=$1',[post])).rows[0];
  assert.equal(payload.title,fields.title);assert.equal(payload.source,'composer');assert.deepEqual(payload.tags,[]);
  await db.exec('RESET ROLE');
  await db.exec('UPDATE privacy_v2_private.release_control SET new_protected_enabled=false');
  await db.exec('SET ROLE service_role');
  assert.equal(await call('authorize_protected_asset',[registered.asset_id,owner]),true);
  assert.equal((await call('protected_first_release_status',[])).delivery,true);
 }
 assert.equal((await db.query("SELECT to_regclass($1) IS NULL AS absent",[schema+'.legacy_media_jobs'])).rows[0].absent,true);
 await db.close();
 console.log('PASS: '+schema+' protected-first drafts, registry, audiences, media and safety guards without legacy tables');
}
await model('privacy_test');await model('public');
