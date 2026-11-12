#!/usr/bin/env python3
"""Deterministic unique-index contention across real PostgreSQL backends, local only."""
import concurrent.futures,json,pathlib,subprocess,threading,time,uuid
out=pathlib.Path('/workspace/freeupper-validation/release-gates')
def sql(command):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i','freeupper-identity-postgres','psql','-X','-U','postgres','-d','freeupper_gates','-At','-v','ON_ERROR_STOP=1'],input=command,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
original=sql("select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.profiles'::regclass and a.attname='freeupper_id'")
collision='FU'+uuid.uuid4().hex[:12].upper();barrier=threading.Barrier(6)
sql("create sequence public.identity_gate_race_attempts;create function public.identity_gate_race_default() returns text language plpgsql as $$begin if nextval('public.identity_gate_race_attempts')<=6 then return '"+collision+"';end if;return ("+original+");end$$;alter table public.profiles alter freeupper_id set default public.identity_gate_race_default();")
def worker(_):
 uid=str(uuid.uuid4());barrier.wait()
 r=sql("set application_name='identity_collision_session';begin;select pg_backend_pid();insert into auth.users(id,email,raw_user_meta_data) values('"+uid+"','collision-"+uid+"@example.test','{}');select pg_sleep(0.7);commit;")
 return uid,int(next(line for line in r.splitlines() if line.isdigit()))
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
  futures=[pool.submit(worker,i) for i in range(6)];waiters=0;deadline=time.monotonic()+4
  while time.monotonic()<deadline and not all(f.done() for f in futures):
   n=int(sql("select count(*) from pg_stat_activity where application_name='identity_collision_session' and wait_event_type='Lock'"));waiters=max(waiters,n)
   if waiters:break
   time.sleep(.025)
  results=[f.result() for f in futures]
 ids=','.join("'"+uid+"'" for uid,_ in results)
 summary=json.loads(sql("select json_build_object('profiles',count(*),'unique_ids',count(distinct freeupper_id),'unique_usernames',count(distinct username),'defaults_correct',bool_and(username=lower(freeupper_id))) from public.profiles where id in ("+ids+")"))
 attempts=int(sql('select last_value from public.identity_gate_race_attempts'))
 assert len({pid for _,pid in results})==6 and waiters>=1
 assert summary=={'profiles':6,'unique_ids':6,'unique_usernames':6,'defaults_correct':True} and attempts==11
 result={'passed':True,'separate_backends':6,'observed_lock_waiters':waiters,'default_evaluations':attempts,'profiles_created':6,'unique_ids':6,'unique_usernames':6,'production_writes':0}
 (out/'collision-race-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
finally:
 sql('alter table public.profiles alter freeupper_id set default '+original+';drop function public.identity_gate_race_default();drop sequence public.identity_gate_race_attempts;')
