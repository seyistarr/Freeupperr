import {readFile} from 'node:fs/promises';
const read = path => readFile(new URL(path,new URL('../quote-reposts-database.test.js',import.meta.url)),'utf8');
export const migration=await read('../docs/quote-reposts/20261029090320_quote_reposts.REVIEW.sql');
export const catalog=JSON.parse(await read('./fixtures/quote-production-catalog.json'));
export const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=uid(1),follower=uid(2),mutual=uid(3),other=uid(4),privateOwner=uid(5),quoteOwner=uid(6);
export async function setup(db) {
 await db.exec(await read('./fixtures/quote-schema.sql'));
 for(const f of [...catalog.functions].sort((a,b)=>Number(!a.signature.startsWith('privacy_v2_private.'))-Number(!b.signature.startsWith('privacy_v2_private.')))) await db.exec(f.definition);
 for(const f of catalog.functions) {
  await db.exec(`REVOKE ALL ON FUNCTION ${f.signature} FROM PUBLIC,anon,authenticated`);
  for(const role of ['anon','authenticated','service_role']) if(f.proacl?.includes(role+'=X/')) await db.exec(`GRANT EXECUTE ON FUNCTION ${f.signature} TO ${role}`);
 }
 for(const p of catalog.policies.filter(p=>['posts','reposts','profiles'].includes(p.tablename))) {
  const roles=p.roles.slice(1,-1).split(',').join(',');
  await db.exec(`CREATE POLICY "${p.policyname}" ON public.${p.tablename} AS ${p.permissive} FOR ${p.cmd} TO ${roles}${p.qual?' USING('+p.qual+')':''}${p.with_check?' WITH CHECK('+p.with_check+')':''}`);
 }
 await db.exec('CREATE TRIGGER privacy_v2_00_retirement_guard BEFORE UPDATE OR DELETE ON posts FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.protected_post_retirement_guard()');
 await db.exec(`INSERT INTO profiles(id,username,is_private) VALUES
 ('${owner}','owner',false),('${follower}','follower',false),('${mutual}','mutual',false),('${other}','stranger',false),('${privateOwner}','private',true),('${quoteOwner}','quoter',false);
 INSERT INTO follows VALUES('${follower}','${owner}','active'),('${mutual}','${owner}','active'),('${owner}','${mutual}','active');
 INSERT INTO privacy_v2_private.follow_approvals VALUES('${follower}','${owner}','public'),('${mutual}','${owner}','public'),('${owner}','${mutual}','public');`);
 const fixtures=[['public',owner,'public',false,false],['followers',owner,'followers',false,false],['friends',owner,'friends',false,false],['only_me',owner,'only_me',false,false],['private',privateOwner,'public',false,false],['hidden',owner,'public',true,false],['deleted',owner,'public',false,true],['draft',owner,'public',false,false],['protected-origin',owner,'public',false,false],['verification',owner,'public',false,false]];
 for(let i=0;i<fixtures.length;i++) {
  const [title,user,vis,hidden,deleted]=fixtures[i];
  await db.query('INSERT INTO posts(id,user_id,title,visibility,is_hidden,is_deleted) VALUES($1,$2,$3,$4,$5,$6)',[uid(100+i),user,title,vis,hidden,deleted]);
 }
 await db.exec(`UPDATE posts SET publishing_state='draft' WHERE id='${uid(107)}';
 INSERT INTO privacy_v2_private.protected_post_origins VALUES('${uid(108)}','${owner}');
 INSERT INTO privacy_v2_private.verification_posts VALUES('${uid(109)}','${owner}',now()+interval '1 day',NULL)`);
}
export async function asRole(db,role,user,sql,args=[]) {
 await db.exec('SET ROLE '+role);
 try {await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user||'']);return await db.query(sql,args);}
 finally {await db.exec('RESET ROLE');}
}
