import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
const owner='00000000-0000-4000-8000-000000000001', follower='00000000-0000-4000-8000-000000000002', stranger='00000000-0000-4000-8000-000000000003';
test('owner updates survive protected admin columns; hide overrides audiences and public RPCs without deleting posts',async()=>{
 const db=new PGlite();
 try {
 await db.exec(await readFile('tests/fixtures/hide-all-posts.sql','utf8'));
 const as=async(role,user,sql,args=[])=>{await db.exec('SET ROLE '+role);try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user||'']);return await db.query(sql,args);}finally{await db.exec('RESET ROLE');}};
 await db.query('INSERT INTO profiles(id) VALUES($1),($2),($3)',[owner,follower,stranger]);
 await db.query("INSERT INTO follows VALUES($1,$2)",[follower,owner]);
 await db.query("INSERT INTO posts(user_id,title,visibility) SELECT $1,'hello',v FROM unnest(ARRAY['public','followers','friends','only_me']) v",[owner]);
 await db.exec("INSERT INTO post_short_links SELECT 'code'||row_number() over(),id FROM posts");
 await db.exec("UPDATE profiles SET username='test',display_name='Test'; UPDATE posts SET media_url='https://res.cloudinary.com/test/video/upload/test.mp4'");
 const asset='00000000-0000-4000-8000-000000000004';
 await db.query("INSERT INTO post_media_assets SELECT $1,id,user_id,'ready','authenticated' FROM posts WHERE visibility='followers'",[asset]);
 await db.query("UPDATE posts SET media=jsonb_build_array(jsonb_build_object('asset_id',$1::text)) WHERE visibility='followers'",[asset]);
 await assert.rejects(as('authenticated',owner,'UPDATE profiles SET hide_all_posts=true WHERE id=$1',[owner]),/permission denied/);
 await db.exec(await readFile('docs/cloudflare/hide-all-posts.REVIEW.sql','utf8'));
 const count=async(role,user)=>(await as(role,user,'SELECT id FROM posts')).rows.length;
 assert.equal(await count('authenticated',owner),4);
 assert.equal(await count('authenticated',follower),2);
 assert.equal(await count('authenticated',stranger),1);
 assert.equal(await count('anon',null),1);
 const media=async(viewer)=>(await db.query('SELECT authorize_protected_asset($1,$2) ok',[asset,viewer])).rows[0].ok;
 assert.equal(await media(follower),true);assert.equal(await media(stranger),false);
 for(const user of [follower,stranger]) assert.equal((await as('authenticated',user,'UPDATE profiles SET hide_all_posts=true WHERE id=$1 RETURNING id',[owner])).rows.length,0);
 assert.equal((await as('anon',null,'UPDATE profiles SET hide_all_posts=true WHERE id=$1 RETURNING id',[owner])).rows.length,0);
 await as('authenticated',owner,'UPDATE profiles SET hide_all_posts=true WHERE id=$1 RETURNING id',[owner]);
 assert.equal(await count('authenticated',owner),4);
 assert.equal(await media(owner),true);assert.equal(await media(follower),false);assert.equal(await media(null),false);
 for(const [role,user] of [['authenticated',follower],['authenticated',stranger],['anon',null]]){
  assert.equal(await count(role,user),0);
  assert.equal((await as(role,user,"SELECT * FROM search_posts('hello')")).rows.length,0);
  for(const fn of ['get_public_post_by_short_code','get_public_post_seo_metadata','get_public_video_seo']) assert.equal((await as(role,user,`SELECT * FROM ${fn}('code1')`)).rows.length,0);
  assert.equal((await as(role,user,'SELECT * FROM list_public_post_sitemap()')).rows.length,0);
 }
 assert.equal((await db.query('SELECT count(*) n FROM posts')).rows[0].n,4);
 await as('authenticated',owner,'UPDATE profiles SET hide_all_posts=false WHERE id=$1',[owner]);
 assert.equal(await count('authenticated',follower),2);
 assert.equal(await media(follower),true);
 await db.query('INSERT INTO follows VALUES($1,$2)',[owner,follower]);
 assert.equal(await count('authenticated',follower),3);
 assert.equal(await count('authenticated',stranger),1);
 assert.equal(await count('anon',null),1);
 await assert.rejects(as('authenticated',owner,'SELECT is_admin FROM profiles'),/permission denied/);
 } finally {await db.close();}
});
test('settings cache only changes after a confirmed owner row; switch waits and reverts on failure',async()=>{
 const source=await readFile('settings.js','utf8');
 for(const result of [{data:null,error:null},{data:null,error:{message:'denied'}},{data:{id:owner},error:null}]){
  let release, cached=0;
  const pending=new Promise(resolve=>release=resolve);
  const user={id:owner,isLoggedIn:true};
  const window={sb:{from:()=>({update:()=>({eq:()=>({select:()=>({single:()=>pending})})})})},AuthUser:{getCurrentUser:()=>user,updateCurrentUser:()=>cached++}};
  vm.runInNewContext(source,{window,console,document:{dispatchEvent(){}},CustomEvent:class{}});
  const save=window.SettingsAPI.updateFlags({hideAllPosts:true});
  assert.equal(cached,0); release(result);
  if(result.data){await save;assert.equal(cached,1);}else{await assert.rejects(save);assert.equal(cached,0);}
 }
 const html=await readFile('settings.html','utf8');
 const handler=html.match(/window.toggleHideAllPosts = async function\(\) \{[\s\S]*?\n            \};/)[0];
 let reject; const pending=new Promise((_,r)=>reject=r),toggle={checked:true,disabled:false},toasts=[];
 const window={SettingsAPI:{updateFlags:()=>pending}};
 vm.runInNewContext(handler,{window,document:{getElementById:()=>toggle},showToast:(...args)=>toasts.push(args)});
 const change=window.toggleHideAllPosts();assert.equal(toggle.disabled,true);assert.equal(toasts.length,0);
 reject(new Error('denied'));await change;assert.equal(toggle.checked,false);assert.equal(toggle.disabled,false);assert.equal(toasts[0][1],'r');
});
