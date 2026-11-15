import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {chromium} from '@playwright/test';
import {startFixture} from './helpers/email-auth-fixture.js';

let fixture,browser;
before(async()=>{fixture=await startFixture();browser=await chromium.launch({executablePath:process.env.FREEUPPER_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();await fixture?.close();});
async function pageFor(t,options={},path='/') {
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Block ALL non-fixture requests, including production and CDNs.
  await page.route(url=>url.origin!==fixture.origin,route=>route.abort());
  await page.addInitScript(options=>window.fixtureOptions=options,options);
  t.after(async()=>{assert.deepEqual(errors,[]);await page.close();});
  await page.goto(fixture.origin+path);
  return page;
}
async function form(page,mode='signup') {
  await page.evaluate(mode=>AuthUser.openModal(mode),mode);
  await page.locator('#fu-email').fill('fixture@example.test');
  await page.locator('#fu-password').fill('Test-Only-Password123!');
}
const visible=async(page,selector)=>assert.equal(await page.locator(selector).isVisible(),true);

test('signup requires confirmation, clears password, retains pending action, and sends only credentials plus redirect',async t=>{
  const page=await pageFor(t);await form(page);
  await page.evaluate(()=>{window.resumed=0;AuthUser.requireAuth(()=>resumed++);});
  await page.locator('#fu-submit-btn').click();
  await page.waitForFunction(()=>document.getElementById('fu-auth-title').textContent==='Check your email');
  await visible(page,'#fu-auth-status');
  assert.equal(await page.locator('#fu-password').inputValue(),'');
  assert.equal(await page.evaluate(()=>resumed),0);
  assert.equal(await page.evaluate(()=>AuthUser.getCurrentUser().isLoggedIn),false);
  assert.deepEqual(await page.evaluate(()=>fixture.calls.find(c=>c.method==='signUp').args),{
    email:'fixture@example.test',password:'Test-Only-Password123!',options:{emailRedirectTo:fixture.origin+'/'}
  });
  assert.equal(await page.locator('#fu-resend-btn').isDisabled(),true);
  await page.evaluate(()=>emitAuth('SIGNED_IN',{user:fixture.user}));
  await page.waitForFunction(()=>resumed===1);
  assert.equal(await page.locator('#fu-auth-overlay').evaluate(el=>el.classList.contains('open')),false);
});

test('login restores protected action once and retains existing UUID and public identity',async t=>{
  const page=await pageFor(t);await form(page,'signin');
  await page.evaluate(()=>{window.resumed=0;AuthUser.openModal('signin',()=>resumed++);});
  await page.locator('#fu-submit-btn').click();await page.waitForFunction(()=>resumed===1);
  await page.evaluate(()=>emitAuth('TOKEN_REFRESHED',fixture.session));
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>resumed),1);
  assert.deepEqual(await page.evaluate(()=>({id:AuthUser.getCurrentUser().id,username:AuthUser.getCurrentUser().username,name:AuthUser.getCurrentUser().displayName})),{id:'fixture-uuid',username:'chosen_name',name:'Chosen Name'});
  assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.method==='signUp').length),0);
});

test('auto-confirm signup can complete immediately without replacing an account',async t=>{
  const page=await pageFor(t,{signupSession:true});await form(page);
  await page.locator('#fu-submit-btn').click();await page.waitForFunction(()=>AuthUser.getCurrentUser().isLoggedIn);
  assert.equal(await page.evaluate(()=>AuthUser.getCurrentUser().username),'chosen_name');
});

for(const [code,message] of [['invalid_credentials',/Email or password is incorrect/],['email_not_confirmed',/Confirm your email/],['weak_password',/stronger password/],['signup_disabled',/Registration is currently unavailable/]]) {
 test('clear authentication error: '+code,async t=>{
   const page=await pageFor(t,{loginError:{code,message:'raw backend error'},signupError:{code,message:'raw backend error'}});await form(page,code==='weak_password'||code==='signup_disabled'?'signup':'signin');
   await page.locator('#fu-submit-btn').click();await page.waitForFunction(()=>document.getElementById('fu-auth-error').textContent.length>0);
   assert.match(await page.locator('#fu-auth-error').textContent(),message);
   assert.equal(await page.locator('#fu-submit-btn').isDisabled(),false);
 });
}

test('resend uses signup endpoint, explicit redirect, and local cooldown',async t=>{
 const page=await pageFor(t);await form(page,'signin');
 await page.locator('#fu-resend-btn').click();await page.waitForFunction(()=>fixture.calls.some(c=>c.method==='resend'));
 assert.deepEqual(await page.evaluate(()=>fixture.calls.find(c=>c.method==='resend').args),{type:'signup',email:'fixture@example.test',options:{emailRedirectTo:fixture.origin+'/'}});
 assert.equal(await page.locator('#fu-resend-btn').isDisabled(),true);
 await page.evaluate(()=>document.getElementById('fu-resend-btn').click());
 assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.method==='resend').length),1);
});

test('server email rate limit is displayed and cannot be bypassed by reopening the modal',async t=>{
 const page=await pageFor(t,{emailError:{status:429,code:'over_email_send_rate_limit',retryAfter:120}});await form(page,'signin');
 await page.locator('#fu-resend-btn').click();await page.waitForFunction(()=>document.getElementById('fu-auth-error').textContent.includes('Too many'));
 assert.match(await page.locator('#fu-resend-btn').textContent(),/1[12][0-9]s/);
 await page.evaluate(()=>{AuthUser.closeModal();AuthUser.openModal('signin');});
 assert.equal(await page.locator('#fu-resend-btn').isDisabled(),true);
});

for(const missingProfile of [false,true])test('profile failure preserves session and retries without another credential request: missing='+missingProfile,async t=>{
 const page=await pageFor(t,{profileError:!missingProfile,missingProfile});await form(page,'signin');
 await page.evaluate(()=>{window.resumed=0;AuthUser.openModal('signin',()=>resumed++);});
 await page.locator('#fu-submit-btn').click();await page.waitForFunction(()=>document.getElementById('fu-submit-btn').textContent==='Retry profile loading');
 assert.match(await page.locator('#fu-auth-error').textContent(),/You are signed in/);
 assert.equal(await page.evaluate(()=>resumed),0);
 assert.equal(await page.evaluate(()=>fixture.session.user.id),'fixture-uuid');
 await page.evaluate(()=>{fixture.profileError=false;fixture.missingProfile=false;});
 await page.locator('#fu-submit-btn').click();await page.waitForFunction(()=>resumed===1);
 assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.method==='signInWithPassword').length),1);
});

test('a late profile response cannot restore a signed-out user',async t=>{
 const page=await pageFor(t,{profileDelay:200});await form(page,'signin');
 await page.locator('#fu-submit-btn').click();await page.waitForFunction(()=>fixture.calls.some(c=>c.method==='profileRead'));
 await page.evaluate(()=>emitAuth('SIGNED_OUT',null));await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>AuthUser.getCurrentUser().isLoggedIn),false);
});

test('forgot-password works logged out, uses recovery redirect, and never calls signup',async t=>{
 const page=await pageFor(t);await form(page,'signin');await page.locator('#fu-forgot-btn').click();
 await page.locator('#fu-submit-btn').click();await page.waitForFunction(()=>fixture.calls.some(c=>c.method==='resetPasswordForEmail'));
 assert.deepEqual(await page.evaluate(()=>fixture.calls.find(c=>c.method==='resetPasswordForEmail').args),['fixture@example.test',{redirectTo:fixture.origin+'/reset-password.html'}]);
 assert.match(await page.locator('#fu-auth-status').textContent(),/If this address is eligible/);
 assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.method==='signUp').length),0);
 assert.equal(await page.locator('#fu-submit-btn').isDisabled(),true);
});

test('recovery request 429 remains retryable after cooldown with no signup fallback',async t=>{
 const page=await pageFor(t,{emailError:{status:429,retryAfter:1}},'/?auth=recover');
 await page.locator('#fu-email').fill('fixture@example.test');await page.locator('#fu-submit-btn').click();
 await page.waitForFunction(()=>document.getElementById('fu-auth-error').textContent.includes('Too many'));
 await page.waitForFunction(()=>!document.getElementById('fu-submit-btn').disabled);
 await page.evaluate(()=>fixture.emailError=null);await page.locator('#fu-submit-btn').click();
 await page.waitForFunction(()=>fixture.calls.filter(c=>c.method==='resetPasswordForEmail').length===2);
});

test('invalid confirmation callback is explained without exposing its raw URL error',async t=>{
 const page=await pageFor(t,{},'/#error=access_denied&error_description=secret&error_code=otp_expired');
 assert.match(await page.locator('#fu-auth-error').textContent(),/invalid or expired/);
 assert.equal(new URL(page.url()).hash,'');
 assert.doesNotMatch(await page.locator('#fu-auth-error').textContent(),/secret/);
});

test('Google OAuth keeps provider and current-page redirect, and surfaces provider errors',async t=>{
 const page=await pageFor(t,{oauthError:{message:'Google login is temporarily unavailable.'}},'/?from=profile');await form(page);
 await page.locator('#fu-google-btn').click();
 assert.deepEqual(await page.evaluate(()=>fixture.calls.find(c=>c.method==='signInWithOAuth').args),{provider:'google',options:{redirectTo:fixture.origin+'/?from=profile'}});
 assert.match(await page.locator('#fu-auth-error').textContent(),/Google login/);
 assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.method==='signUp').length),0);
});

test('recovery waits for initialization, updates password, and signs out only the local session',async t=>{
 const page=await pageFor(t,{recovery:true,sessionDelay:800},'/reset-password.html');
 assert.equal(await page.locator('#submitBtn').isDisabled(),true);
 await page.waitForFunction(()=>document.getElementById('recoveryStatus').textContent==='Choose your new password.');
 await page.locator('#pwNew').fill('New-Test-Password123!');await page.locator('#pwConf').fill('New-Test-Password123!');await page.locator('#submitBtn').click();
 await page.waitForFunction(()=>document.getElementById('successWrap').classList.contains('show'));
 await page.waitForFunction(()=>fixture.calls.some(c=>c.method==='signOut'));
 assert.deepEqual(await page.evaluate(()=>fixture.calls.find(c=>c.method==='signOut').args),{scope:'local'});
 assert.deepEqual(await page.evaluate(()=>fixture.calls.find(c=>c.method==='updateUser').args),{password:'New-Test-Password123!'});
});

test('invalid/expired recovery cannot submit even when values are injected',async t=>{
 const page=await pageFor(t,{},'/reset-password.html');
 await page.waitForFunction(()=>document.getElementById('recoveryStatus').textContent.includes('invalid or expired'));
 await page.evaluate(async()=>{document.getElementById('pwNew').value='Fake-Password123!';document.getElementById('pwConf').value='Fake-Password123!';await submitNewPassword();});
 assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.method==='updateUser').length),0);
});

test('recovery update error stays visible with retry enabled and password inputs retained',async t=>{
 const page=await pageFor(t,{recovery:true,updateError:{code:'weak_password'}},'/reset-password.html');
 await page.waitForFunction(()=>!document.getElementById('pwNew').disabled);
 await page.locator('#pwNew').fill('New-Test-Password123!');await page.locator('#pwConf').fill('New-Test-Password123!');await page.locator('#submitBtn').click();
 await page.waitForFunction(()=>document.getElementById('recoveryStatus').textContent.includes('stronger password'));
 assert.equal(await page.locator('#submitBtn').isDisabled(),false);
 assert.equal(await page.locator('#successWrap').evaluate(el=>el.classList.contains('show')),false);
});

test('onboarding update errors and zero affected rows never mark completion',async()=>{
 const source=await readFile('index-feed.js','utf8');
 const fn=source.slice(source.indexOf('  async function saveOnboardingInterests'),source.indexOf('\n  // ===',source.indexOf('  async function saveOnboardingInterests')));
 for(const response of [{error:{message:'RLS denied'}},{data:null},{data:{id:'other'}}]){
  const state={profile:{id:'fixture-uuid',onboarding_completed:false}};let emitted=false;
  const q={update:()=>q,eq:()=>q,select:()=>q,single:async()=>response};
  const ctx={state,window:{sb:{from:()=>q}},emit:()=>emitted=true};vm.createContext(ctx);vm.runInContext(fn,ctx);
  await assert.rejects(ctx.saveOnboardingInterests({music:{}}));
  assert.equal(state.profile.onboarding_completed,false);assert.equal(emitted,false);
 }
});

test('onboarding marks completion only after one matching persisted profile row',async()=>{
 const source=await readFile('index-feed.js','utf8');const fn=source.slice(source.indexOf('  async function saveOnboardingInterests'),source.indexOf('\n  // ===',source.indexOf('  async function saveOnboardingInterests')));
 const state={profile:{id:'fixture-uuid',onboarding_completed:false}};const events=[];
 const q={update:()=>q,eq:()=>q,select:()=>q,single:async()=>({data:{id:'fixture-uuid'},error:null})};const ctx={state,window:{sb:{from:()=>q}},emit:name=>events.push(name)};vm.createContext(ctx);vm.runInContext(fn,ctx);
 assert.equal(await ctx.saveOnboardingInterests({}),true);assert.equal(state.profile.onboarding_completed,true);assert.deepEqual(events,['onboarding-completed']);
});

test('a normal existing session without recovery context cannot change a password on the reset page',async t=>{
 const page=await pageFor(t,{session:{user:{id:'fixture-uuid'}}},'/reset-password.html');
 await page.waitForFunction(()=>document.getElementById('recoveryStatus').textContent.includes('invalid or expired'));
 assert.equal(await page.locator('#pwNew').isDisabled(),true);
});

test('recovery cannot update a different account after the browser session changes',async t=>{
 const page=await pageFor(t,{recovery:true},'/reset-password.html');
 await page.waitForFunction(()=>!document.getElementById('pwNew').disabled);
 await page.locator('#pwNew').fill('New-Test-Password123!');await page.locator('#pwConf').fill('New-Test-Password123!');
 await page.evaluate(()=>fixture.session={user:{id:'another-account'}});
 await page.locator('#submitBtn').click();await page.waitForFunction(()=>document.getElementById('recoveryStatus').textContent.includes('invalid or expired'));
 assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.method==='updateUser').length),0);
});

for(const failure of ['false','throw'])test('onboarding UI remains open and enables retry when save returns '+failure,async t=>{
 const page=await pageFor(t);
 await page.evaluate(failure=>{
   document.body.insertAdjacentHTML('beforeend','<div id="onboardingOverlay"><div id="interestGrid"></div><button id="onboardingContinueBtn"></button><button id="onboardingSkipBtn">Skip</button></div>');
   window.alerts=[];window.alert=message=>alerts.push(message);
   window.FreeUpperFeed={saveOnboardingInterests:async()=>{if(failure==='throw')throw Error('save failed');return false;}};
   const q={select:()=>q,eq:()=>q,order:async()=>({data:[{key:'music',label:'Music'},{key:'sports',label:'Sports'},{key:'movies',label:'Movies'}]})};
   window.sb={from:()=>q};
 },failure);
 await page.addScriptTag({content:await readFile('onboarding.js','utf8')});
 await page.evaluate(()=>FreeUpperOnboarding.showOnboarding());
 for(const key of ['music','sports','movies'])await page.locator('[data-key="'+key+'"]').click();
 await page.locator('#onboardingContinueBtn').click();await page.waitForFunction(()=>alerts.length===1);
 assert.equal(await page.locator('#onboardingOverlay').evaluate(el=>el.classList.contains('open')),true);
 assert.equal(await page.locator('#onboardingContinueBtn').isDisabled(),false);
 assert.equal(await page.locator('#onboardingSkipBtn').isDisabled(),false);
});


test('Google callback cancellation is described as sign-in failure rather than a confirmation requirement',async t=>{
 const page=await pageFor(t,{},'/#error=access_denied&error_description=private-provider-detail');
 assert.match(await page.locator('#fu-auth-error').textContent(),/Sign-in or email verification could not finish/);
 assert.doesNotMatch(await page.locator('#fu-auth-error').textContent(),/private-provider-detail/);
 assert.equal(new URL(page.url()).hash,'');
});


test('initial guest session does not dismiss the recovery entry point',async t=>{
 const page=await pageFor(t,{},'/?auth=recover');
 await page.waitForTimeout(50);
 assert.equal(await page.locator('#fu-auth-overlay').evaluate(el=>el.classList.contains('open')),true);
 assert.equal(await page.locator('#fu-auth-title').textContent(),'Reset your password');
});
