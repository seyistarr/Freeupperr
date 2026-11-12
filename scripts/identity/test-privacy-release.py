#!/usr/bin/env python3
"""Revised privacy batches against local restored app DDL. No remote connection."""
import json,pathlib,subprocess,collections,sys
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=pathlib.Path('/workspace/freeupper-validation/identity-privacy');OUT.mkdir(exist_ok=True,parents=True)
def sql(command):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i','freeupper-privacy-postgres','psql','-X','-U','postgres','-d','freeupper_privacy','-At','-v','ON_ERROR_STOP=1'],input=command,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def query(command):
 raw=sql(command)
 if raw=='t':return True
 if raw=='f':return False
 try:return json.loads(raw)
 except json.JSONDecodeError:pass
 for line in reversed(raw.splitlines()):
  try:return json.loads(line)
  except json.JSONDecodeError:continue
 return None
def rows(path):return query("select coalesce(json_agg(t),'[]') from ("+path.read_text().rstrip().rstrip(';')+") t")
checks=[]
def check(name,value):
 if not value:raise AssertionError(name)
 checks.append(name);print('PASS '+name,flush=True)
resuming='--resume' in sys.argv
if resuming:
 check('verified unmodified local fixture resume',query('select not exists(select * from public.profiles except select * from gate_test.before_profiles)') is True)
else:check('local restored application schema starts empty',query('select count(*) from public.profiles')==0)
if not resuming:sql("""SET search_path=public,extensions;
CREATE SCHEMA gate_test;REVOKE ALL ON SCHEMA gate_test FROM PUBLIC,anon,authenticated;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
 SELECT gen_random_uuid(),'privacy-'||i||'@example.test',now(),'{}' FROM generate_series(1,71) i;
CREATE TABLE gate_test.users AS SELECT id,email,substring(email FROM 'privacy-([0-9]+)')::integer n FROM auth.users;
ALTER TABLE public.profiles DISABLE TRIGGER validate_profile_identity;
UPDATE public.profiles p SET username=CASE WHEN t.n<=44 THEN t.email WHEN t.n=45 THEN 'custom_aux' ELSE p.username END,
 display_name=CASE WHEN t.n<=43 THEN t.email WHEN t.n=46 THEN 'uncertain@example.test' ELSE 'Custom Name' END,
 display_username=CASE WHEN t.n<=6 OR t.n=45 THEN t.email WHEN t.n=46 THEN 'uncertain@example.test' ELSE NULL END
FROM gate_test.users t WHERE p.id=t.id;
ALTER TABLE public.profiles ENABLE TRIGGER validate_profile_identity;
CREATE TABLE gate_test.before_profiles AS SELECT * FROM public.profiles;
INSERT INTO public.follows(follower_id,following_id) SELECT a.id,b.id FROM gate_test.users a,gate_test.users b WHERE a.n=1 AND b.n=2;
INSERT INTO public.posts(user_id,content,title,description,media_type,visibility,mentions)
 SELECT t.id,'safe','','','text','public',jsonb_build_array(jsonb_build_object('userId',t.id,'username',t.email,'displayName',t.email,'start',10,'end',35,'type','user')) FROM gate_test.users t WHERE t.n=1;
CREATE TABLE gate_test.before_posts AS SELECT * FROM public.posts;
""")
fields=rows(ROOT/'docs/identity/stage2-preview.sql');posts=rows(ROOT/'docs/identity/stage2-reference-preview.sql')
check('production-shaped fixture yields 94 independently confirmed fields',collections.Counter(f['field'] for f in fields if f['decision']=='confirmed_exact_verified_email')=={'username':44,'display_name':43,'display_username':7})
check('two ambiguous fields excluded',sum(f['decision']=='ambiguous_at_value' for f in fields)==2)
check('one structured post reference identified',len(posts)==1 and posts[0]['expected_references']==1)
(OUT/'synthetic-fields.json').write_text(json.dumps(fields));(OUT/'synthetic-posts.json').write_text(json.dumps(posts))
subprocess.run(['python3',str(ROOT/'scripts/identity/prepare-stage2.py'),str(OUT/'synthetic-fields.json'),str(OUT/'synthetic-posts.json'),'--output',str(OUT/'synthetic-stage2.sql'),'--report',str(OUT/'synthetic-dry-run.csv')],check=True,capture_output=True,text=True)
plan=(OUT/'synthetic-stage2.sql').read_text();sql(plan)
check('dry run rolls back all profile changes',query('select not exists(select * from public.profiles except select * from gate_test.before_profiles)') is True)
check('dry run leaves no private backup tables',query("select to_regclass('identity_private.stage2_profile_backup') is null") is True)
sql(plan.rstrip()[:-len('ROLLBACK;')]+'COMMIT;')
check('exactly 45 synthetic profiles corrected',query('select count(*) from identity_private.stage2_profile_backup')==45)
check('permanent UUIDs, FreeUpper IDs, creation timestamps and completion states preserved',query("select bool_and(p.id=b.id and p.freeupper_id=b.freeupper_id and p.created_at=b.created_at and p.onboarding_completed=b.onboarding_completed and p.profile_setup_completed_at is not distinct from b.profile_setup_completed_at) from public.profiles p join gate_test.before_profiles b on p.id=b.id") is True)
check('all selected identity exposures removed',query("select count(*) from public.profiles p join auth.users u on u.id=p.id where p.username=u.email or p.display_name=u.email or p.display_username=u.email")==0)
check('custom and ambiguous names preserved',query("select bool_and(p.display_name='Custom Name') filter(where t.n=44) and bool_and(p.username='custom_aux' and p.display_username='custom_aux') filter(where t.n=45) and bool_and(p.display_name='uncertain@example.test' and p.display_username='uncertain@example.test') filter(where t.n=46) from public.profiles p join gate_test.users t on t.id=p.id") is True)
check('post content, author, UUID and creation timestamp preserved',query('select bool_and(p.id=b.id and p.user_id=b.user_id and p.content=b.content and p.title=b.title and p.description=b.description and p.created_at=b.created_at) from public.posts p join gate_test.before_posts b on p.id=b.id') is True)
check('structured mention retains UUID and no email identity',query("select bool_and(m->>'userId'=p.user_id::text and position('@' in m->>'username')=0 and m->>'displayName'='FreeUpper User') from public.posts p cross join lateral jsonb_array_elements(p.mentions) m") is True)
check('follower relationship remains intact',query('select count(*) from public.follows')==1)
for role in ['anon','authenticated']:
 try:sql('set role '+role+';select * from identity_private.stage2_profile_backup;');denied=False
 except RuntimeError:denied=True
 check(role+' cannot read rollback PII',denied)
 check(role+' cannot use email as an account oracle',query("set role "+role+";select count(*) from public.get_public_profile_by_username('privacy-1@example.test');reset role;")==0)
 check(role+' cannot find old email through username search',query("set role "+role+";select count(*) from public.profiles where username='privacy-1@example.test';reset role;")==0)
try:sql((ROOT/'docs/identity/stage2-rollback.sql').read_text());denied=False
except RuntimeError:denied=True
check('privacy-reversing rollback is blocked without separate approval',denied)
result={'passed':len(checks),'failed':0,'checks':checks,'production_writes':0,'schema_source':'accepted production application DDL; no production rows','confirmed_fields':94,'profiles_changed':45,'posts_changed':1}
(OUT/'postgres-privacy-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='checks'}))
