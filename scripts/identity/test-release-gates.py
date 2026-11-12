#!/usr/bin/env python3
"""Real GoTrue + separate PostgreSQL session release gates; local task containers only."""
import concurrent.futures,hashlib,json,os,pathlib,secrets,subprocess,time,urllib.request,urllib.error,uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=pathlib.Path(os.environ.get('FREEUPPER_GATE_OUTPUT','/workspace/freeupper-validation/release-gates'))
OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:9999';CONTAINER='freeupper-identity-postgres';DB='freeupper_gates'
checks=[]
def check(name,ok):
 if not ok:raise AssertionError(name)
 checks.append(name);print('PASS '+name,flush=True)
def sql(command):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',CONTAINER,'psql','-X','-U','postgres','-d',DB,'-v','ON_ERROR_STOP=1','-At'],input=command,text=True,capture_output=True)
 if r.returncode:raise RuntimeError('Isolated SQL failed: '+r.stderr.strip())
 return r.stdout.strip()
def query(command):
 v=sql(command)
 for line in reversed(v.splitlines()):
  try:return json.loads(line)
  except json.JSONDecodeError:continue
 return None
def api(path,payload=None,token=None):
 headers={'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request(BASE+path,data=None if payload is None else json.dumps(payload).encode(),headers=headers)
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
 except urllib.error.HTTPError as e:
  v=json.load(e);raise RuntimeError('Isolated Auth failed HTTP '+str(e.code)+' '+str(v.get('error_code',v.get('error','')))) from None
def profile(uid):return query("select row_to_json(p) from public.profiles p where id='"+uid+"'")
def signup():
 email='gate-'+uuid.uuid4().hex+'@example.test';password=secrets.token_urlsafe(24)
 r=api('/signup',{'email':email,'password':password});return email,password,r
# Baseline must be the restored production schema before the proposed change.
check('local GoTrue health',api('/health')['name']=='GoTrue')
check('restore initially contains no production profile data',query('select count(*) from public.profiles')==0)
email,password,old=signup();old_id=old['user']['id'];before=profile(old_id)
check('real baseline Auth signup invokes restored production profile trigger',before['username']==email and before['display_name']==email)
# Seed an actual deliberate custom identity under the current production rules.
sql("update public.profiles set username='existing_custom',display_name='Existing Custom',display_username='ExistingCustom' where id='"+old_id+"'")
before=profile(old_id)
policy_before=sql("select md5(string_agg(row_to_json(p)::text,'' order by policyname,tablename,schemaname)) from pg_policies p where schemaname in ('public','privacy_v2_private','otd')")
sql((ROOT/'supabase/migrations/20261109051236_default_profile_identity.sql').read_text())
check('schema migration preserves every field on the existing synthetic profile',profile(old_id)==before)
policy_after=sql("select md5(string_agg(row_to_json(p)::text,'' order by policyname,tablename,schemaname)) from pg_policies p where schemaname in ('public','privacy_v2_private','otd')")
check('all existing application RLS policies unchanged',policy_before==policy_after)
_,_,new=signup();uid=new['user']['id'];p=profile(uid)
check('real GoTrue email signup gets database ID defaults',p['id']==uid and p['username']==p['freeupper_id'].lower() and p['display_name']=='FreeUpper User' and p['display_username']==p['username'])
check('real signup remains incomplete',p['onboarding_completed'] is False and p['profile_setup_completed_at'] is None)
login=api('/token?grant_type=password',{'email':email,'password':password})
check('existing real email login preserves UUID and custom identity',login['user']['id']==old_id and profile(old_id)==before)
refresh=api('/token?grant_type=refresh_token',{'refresh_token':login['refresh_token']})
check('real refresh preserves UUID and custom identity',refresh['user']['id']==old_id and profile(old_id)==before)
# Concurrent real HTTP registrations exercise GoTrue's connection pool.
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 auth_results=list(pool.map(lambda _:signup()[2],range(8)))
auth_ids=[r['user']['id'] for r in auth_results]
check('eight concurrent real Auth registrations have unique UUIDs and handles',len(set(auth_ids))==8 and len({profile(i)['username'] for i in auth_ids})==8)
# Distinct docker-exec psql clients ensure distinct backend sessions, not a serialized PGlite queue.
def session_insert(_):
 i=str(uuid.uuid4())
 result=sql("begin;select pg_backend_pid();insert into auth.users(id,email,raw_user_meta_data) values('"+i+"','session-"+i+"@example.test','{}');select pg_sleep(0.2);commit;")
 pid=int([line for line in result.splitlines() if line.isdigit()][0]);return i,pid
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:session_results=list(pool.map(session_insert,range(24)))
check('24 profile creations use 24 distinct PostgreSQL backends',len({pid for _,pid in session_results})==24)
ps=[profile(i) for i,_ in session_results]
check('separate-session registrations preserve unique existing-ID handles',len({p['freeupper_id'] for p in ps})==24 and len({p['username'] for p in ps})==24 and all(p['username']==p['freeupper_id'].lower() for p in ps))
# Force a deterministic collision then allow the SAME column default to recover.
# This is an isolated fault injector, never an application ID generator.
original_default=sql("select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.profiles'::regclass and a.attname='freeupper_id'")
collision=p['freeupper_id']
sql("create sequence public.identity_gate_attempts;create function public.identity_gate_default() returns text language plpgsql as $$begin if nextval('public.identity_gate_attempts')=1 then return '"+collision+"';end if;return ('FU'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)));end$$;alter table public.profiles alter freeupper_id set default public.identity_gate_default();")
try:
 _,_,retry=signup();rp=profile(retry['user']['id'])
 check('real Auth retries a forced FreeUpper ID collision using the existing default',rp['freeupper_id']!=collision and rp['username']==rp['freeupper_id'].lower() and query('select last_value from public.identity_gate_attempts')==2)
 sql("alter table public.profiles alter freeupper_id set default '"+collision+"'")
 user_count=query('select count(*) from auth.users')
 failed=False
 try:signup()
 except RuntimeError:failed=True
 check('repeated collision aborts real Auth registration without a partial user',failed and query('select count(*) from auth.users')==user_count)
finally:
 sql('alter table public.profiles alter freeupper_id set default '+original_default+';drop function public.identity_gate_default();drop sequence public.identity_gate_attempts;')
# Email handles must never act as compatibility aliases or account oracles.
for role in ['anon','authenticated']:
 exposed=query("set role "+role+";select coalesce(json_agg(p),'[]') from public.get_public_profile_by_username('"+email+"') p;reset role;")
 check(role+' email handle lookup returns no account',exposed==[])
 try:sql('set role '+role+';select * from identity_private.stage2_profile_backup;');denied=False
 except RuntimeError:denied=True
 check(role+' cannot access private rollback state',denied)
check('existing synthetic profile is still unchanged after all signup and fault tests',profile(old_id)==before)
result={'passed':len(checks),'failed':0,'checks':checks,'auth_version':api('/health')['version'],'postgres_version':sql('show server_version'),'separate_backend_sessions':len({pid for _,pid in session_results}),'google_oauth':'BLOCKED: no OAuth client credentials or authorized Google test identity supplied','production_writes':0,'production_users_copied':0,'auth_email_autoconfirm':True,'email_delivery_tested':False}
(OUT/'integration-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='checks'}),flush=True)
