#!/usr/bin/env python3
"""Real GoTrue confirmation delivery into localhost Mailpit; no external recipient."""
import html,json,pathlib,re,secrets,subprocess,time,urllib.request,urllib.error,uuid
out=pathlib.Path('/workspace/freeupper-validation/release-gates');checks=[]
def request(url,data=None):
 r=urllib.request.Request(url,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(r,timeout=20) as v:return v.status,v.read().decode()
 except urllib.error.HTTPError as e:return e.code,e.read().decode()
def check(name,passed):
 if not passed:raise AssertionError(name)
 checks.append(name);print('PASS '+name,flush=True)
def profile(uid):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','freeupper-identity-postgres','psql','-X','-U','postgres','-d','freeupper_gates','-At','-v','ON_ERROR_STOP=1','-c',"select row_to_json(p) from public.profiles p where id='"+uid+"'"],text=True,capture_output=True)
 if r.returncode:raise RuntimeError('Isolated profile lookup failed')
 return json.loads(r.stdout)
email='confirm-'+uuid.uuid4().hex+'@example.test';password=secrets.token_urlsafe(24)
code,body=request('http://127.0.0.1:9999/signup',{'email':email,'password':password});auth=json.loads(body)
check('confirmation-required real registration succeeds without issuing a session',code==200 and 'access_token' not in auth)
uid=auth['id'];p=profile(uid)
check('unconfirmed registration already has private defaults and remains incomplete',p['username']==p['freeupper_id'].lower() and p['display_name']=='FreeUpper User' and p['onboarding_completed'] is False and p['profile_setup_completed_at'] is None)
code,body=request('http://127.0.0.1:9999/token?grant_type=password',{'email':email,'password':password})
check('unconfirmed account cannot log in',code==400 and json.loads(body).get('error_code')=='email_not_confirmed')
message=None
for _ in range(30):
 code,body=request('http://127.0.0.1:9802/api/v1/messages')
 for m in json.loads(body).get('messages',[]):
  if any(x.get('Address')==email for x in m.get('To',[])):message=m;break
 if message:break
 time.sleep(.1)
check('confirmation mail delivered through real SMTP into isolated Mailpit',message is not None)
code,body=request('http://127.0.0.1:9802/api/v1/message/'+message['ID']);message=json.loads(body)
text=html.unescape(message.get('HTML','')+' '+message.get('Text',''))
match=re.search(r'http://127\.0\.0\.1:9999/verify\?[^\s"<>]+',text)
check('mail contains localhost-only confirmation callback',match is not None)
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(NoRedirect)
try:
 r=opener.open(match.group(0),timeout=20);status=r.status;location=r.headers.get('Location','')
except urllib.error.HTTPError as e:status=e.code;location=e.headers.get('Location','')
check('real confirmation callback issues a session redirect',status in (302,303) and 'access_token=' in location)
code,body=request('http://127.0.0.1:9999/token?grant_type=password',{'email':email,'password':password});login=json.loads(body)
check('confirmed account can log in with original UUID',code==200 and login['user']['id']==uid)
check('confirmation and subsequent login preserve every profile field',profile(uid)==p)
r={'passed':len(checks),'failed':0,'checks':checks,'mail_delivery':'isolated SMTP/Mailpit','production_writes':0,'google_oauth':'not tested; credentials unavailable'}
(out/'email-confirmation-results.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'passed':len(checks),'failed':0}))
