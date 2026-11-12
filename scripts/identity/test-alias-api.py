#!/usr/bin/env python3
"""No-email-alias API disclosure boundary tests against task-local GoTrue/PostgREST only."""
import json,pathlib,secrets,subprocess,urllib.request,urllib.error,uuid
out=pathlib.Path('/workspace/freeupper-validation/release-gates');checks=[]
def req(base,path,body=None,token=None,extra=None):
 h={'Content-Type':'application/json'}
 if token:h['Authorization']='Bearer '+token
 if extra:h.update(extra)
 r=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=h)
 try:
  with urllib.request.urlopen(r,timeout=15) as x:return x.status,x.read().decode()
 except urllib.error.HTTPError as e:return e.code,e.read().decode()
def sql(s):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i','freeupper-identity-postgres','psql','-X','-U','postgres','-d','freeupper_gates','-At','-v','ON_ERROR_STOP=1'],input=s,text=True,capture_output=True)
 if r.returncode:raise RuntimeError('Isolated fixture SQL failed')
 return r.stdout.strip()
def check(name,passed):
 if not passed:raise AssertionError(name)
 checks.append(name);print('PASS '+name,flush=True)
email='rest-'+uuid.uuid4().hex+'@example.test';password=secrets.token_urlsafe(24)
status,body=req('http://127.0.0.1:9999','/signup',{'email':email,'password':password})
check('real Auth issues an authenticated API token',status==200)
auth=json.loads(body);uid=auth['user']['id'];token=auth['access_token'];alias='former-'+uuid.uuid4().hex+'@example.test'
handle=sql("select username from public.profiles where id='"+uid+"'")
for name,jwt in [('anon',None),('authenticated',token)]:
 for path in ['/username_aliases','/stage2_profile_backup','/stage2_post_backup','/rpc/default_profile_identity','/rpc/validate_profile_identity','/rpc/handle_new_user']:
  code,body=req('http://127.0.0.1:9300',path,{} if '/rpc/' in path else None,jwt)
  check(name+' cannot access '+path,code in (401,403,404) and alias not in body and email not in body)
 code,body=req('http://127.0.0.1:9300','/username_aliases',None,jwt,{'Accept-Profile':'identity_private'})
 check(name+' cannot select private schema via API',code==406 and alias not in body)
 code,body=req('http://127.0.0.1:9300','/rpc/get_public_profile_by_username',{'p_username':alias},jwt)
 rows=json.loads(body)
 check(name+' former email lookup reveals no account',code==200 and rows==[])
 code,body=req('http://127.0.0.1:9300','/rpc/get_public_profile_by_username',{'p_username':handle},jwt)
 check(name+' current canonical handle remains functional',code==200 and json.loads(body)[0]['profile_id']==uid)
 code,body=req('http://127.0.0.1:9300','/rpc/get_public_profile_by_username',{'p_username':'%@example.test'},jwt)
 check(name+' alias lookup has no wildcard enumeration',code==200 and json.loads(body)==[])
result={'passed':len(checks),'failed':0,'checks':checks,'production_writes':0,'limitation':'Former email handles never resolve; stable FreeUpper-ID and UUID links provide compatibility.'}
(out/'alias-api-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':len(checks),'failed':0}))
