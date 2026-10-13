import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { configuration, production, build } from '../scripts/build-config.mjs';
import { senderEnvironment, isolatePayload, stagingRequestAllowed } from '../supabase/functions/send-push-notification/environment.js';

export const staging = {
    VERCEL_ENV: 'preview', NODE_ENV: 'production', FREEUPPER_ENV: 'staging', APP_ORIGIN: 'https://freeupper-stage.example.test',
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_staging_test_only',
    FIREBASE_API_KEY: 'test-only-api-key', FIREBASE_AUTH_DOMAIN: 'freeupper-staging-test.firebaseapp.com',
    FIREBASE_PROJECT_ID: 'freeupper-staging-test', FIREBASE_STORAGE_BUCKET: 'freeupper-staging-test.firebasestorage.app',
    FIREBASE_MESSAGING_SENDER_ID: '123456789', FIREBASE_APP_ID: '1:123456789:web:test', FIREBASE_VAPID_KEY: 'B' + 'a'.repeat(86),
    VERCEL_URL: 'stage-deployment.vercel.app', VERCEL_BRANCH_URL: 'stage-branch.vercel.app'
};
const guard = await fs.readFile(new URL('../config/runtime-guard.js', import.meta.url), 'utf8');
test('Preview uses staging even with NODE_ENV=production', () => {
    const config = configuration(staging);
    assert.equal(config.environment, 'staging');
    assert.equal(config.uploadsEnabled, false);
    assert.equal(config.supabase.url, staging.SUPABASE_URL);
    assert.doesNotMatch(JSON.stringify(config), /jmjtqidirpmnegzvmiaq|freeupper-notifications|37328138260|www\.freeupper\.com/);
});
test('missing deployment metadata cannot select production', () => {
    for (const value of [undefined, '', 'unexpected']) assert.throws(() => configuration({ ...staging, VERCEL_ENV:value }));
});
test('every required staging value is mandatory', () => {
    for (const name of Object.keys(staging).filter(name => !['NODE_ENV','VERCEL_URL','VERCEL_BRANCH_URL'].includes(name))) {
        assert.throws(() => configuration({ ...staging, [name]: undefined }), name);
    }
});
test('Preview rejects production credentials, IDs and URLs', () => {
    const forbidden = { SUPABASE_URL: production.supabase.url, SUPABASE_PUBLISHABLE_KEY:production.supabase.publicKey,
        FIREBASE_API_KEY:production.firebase.apiKey, FIREBASE_PROJECT_ID:production.firebase.projectId,
        FIREBASE_AUTH_DOMAIN:production.firebase.authDomain, FIREBASE_STORAGE_BUCKET:production.firebase.storageBucket,
        FIREBASE_MESSAGING_SENDER_ID:production.firebase.messagingSenderId, FIREBASE_APP_ID:production.firebase.appId,
        FIREBASE_VAPID_KEY:production.vapidKey, APP_ORIGIN:production.appOrigin, VERCEL_URL:'freeupper.vercel.app' };
    for (const [name,value] of Object.entries(forbidden)) assert.throws(() => configuration({ ...staging,[name]:value }), name);
});
test('Preview rejects mismatched Firebase fields and private Supabase keys', () => {
    for (const [name,value] of Object.entries({ FIREBASE_AUTH_DOMAIN:'other.firebaseapp.com', FIREBASE_STORAGE_BUCKET:'other.appspot.com',
        FIREBASE_APP_ID:'1:999:web:test', SUPABASE_PUBLISHABLE_KEY:'sb_secret_not_public', APP_ORIGIN:'https://stage.test/path' }))
        assert.throws(() => configuration({...staging,[name]:value}));
    const key = claims => 'eyJtest.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.test';
    assert.throws(() => configuration({...staging,SUPABASE_PUBLISHABLE_KEY:key({role:'service_role',ref:'abcdefghijklmnopqrst'})}));
    assert.throws(() => configuration({...staging,SUPABASE_PUBLISHABLE_KEY:key({role:'anon',ref:'different'})}));
    assert.equal(configuration({...staging,SUPABASE_PUBLISHABLE_KEY:key({role:'anon',ref:'abcdefghijklmnopqrst'})}).environment,'staging');
});
test('production ignores staging inputs and preserves the captured public configuration', () => {
    assert.equal(createHash('sha256').update(JSON.stringify(production)).digest('hex'), '62c74572d6ce291b1d14c7d63b3c177dce2d54e56591b66a1d4ec8bd316b97bc');
    const config = configuration({ ...staging, VERCEL_ENV:'production', FREEUPPER_ENV:'production' });
    for (const key of Object.keys(production)) assert.deepEqual(config[key], production[key]);
    assert.throws(() => configuration({...staging,VERCEL_ENV:'production'}));
});
test('build emits only public values; staging HTML links use staging; production HTML is unchanged', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(),'freeupper-config-'));
    try {
        const html = '<a href="https://www.freeupper.com/chat.html?conversation=c%20x">Chat</a>';
        await fs.writeFile(path.join(directory,'chat.html'), html);
        await build({...staging,SUPABASE_SERVICE_ROLE_KEY:'must-never-appear',FIREBASE_SERVICE_ACCOUNT_JSON:'private-json'},directory);
        const script = await fs.readFile(path.join(directory,'runtime-config.js'),'utf8');
        assert.doesNotMatch(script,/must-never-appear|private-json/);
        assert.match(await fs.readFile(path.join(directory,'chat.html'),'utf8'),/https:\/\/freeupper-stage.example.test\/chat.html\?conversation=c%20x/);
        const context = vm.createContext({location:{origin:staging.APP_ORIGIN},URL,Object});
        vm.runInContext(script,context);
        assert.equal(context.FreeUpperConfig.firebase.projectId,staging.FIREBASE_PROJECT_ID);
        assert.equal(Object.isFrozen(context.FreeUpperConfig.firebase),true);
        await fs.writeFile(path.join(directory,'chat.html'),html);
        await build({VERCEL_ENV:'production'},directory);
        assert.equal(await fs.readFile(path.join(directory,'chat.html'),'utf8'),html);
    } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
test('runtime rejects production artifacts on preview origins', () => {
    const context = vm.createContext({FreeUpperConfig:configuration({VERCEL_ENV:'production'}),location:{origin:staging.APP_ORIGIN},URL,Object});
    assert.throws(() => vm.runInContext(guard,context));
    assert.equal(context.FreeUpperConfig,undefined);
});
test('staging navigation stays on staging and Cloudinary writes are blocked', async () => {
    const calls=[];
    const context = vm.createContext({FreeUpperConfig:configuration(staging),location:{origin:staging.APP_ORIGIN},URL,Object,
        fetch:async (...args)=>{calls.push(args);return {ok:true};}});
    vm.runInContext(guard,context);
    assert.equal(context.FreeUpperNotificationUrl('/chat.html?conversation=a%2Fb'),staging.APP_ORIGIN+'/chat.html?conversation=a%2Fb');
    for (const value of ['https://www.freeupper.com/chat.html?conversation=c','https://evil.test/','//www.freeupper.com/'])
        assert.equal(context.FreeUpperNotificationUrl(value),staging.APP_ORIGIN+'/index.html');
    await assert.rejects(context.fetch('https://api.cloudinary.com/v1_1/production/image/upload'),/disabled/);
    assert.equal(calls.length,0);
});
const edgeEnv = values => ({get:name=>values[name]});
const edgeValues={ APP_ENV:'staging',APP_ORIGIN:staging.APP_ORIGIN,FIREBASE_PROJECT_ID:staging.FIREBASE_PROJECT_ID,
    SUPABASE_URL:staging.SUPABASE_URL,STAGING_WEBHOOK_SECRET:'x'.repeat(32) };
test('sender requires explicit staging configuration, matching service account and secret', () => {
    assert.equal(senderEnvironment(edgeEnv(edgeValues),{project_id:staging.FIREBASE_PROJECT_ID}).appOrigin,staging.APP_ORIGIN);
    for (const name of Object.keys(edgeValues)) assert.throws(() => senderEnvironment(edgeEnv({...edgeValues,[name]:undefined}),{project_id:staging.FIREBASE_PROJECT_ID}),name);
    assert.throws(() => senderEnvironment(edgeEnv(edgeValues),{project_id:production.firebase.projectId}));
    assert.throws(() => senderEnvironment(edgeEnv({...edgeValues,APP_ORIGIN:production.appOrigin}),{project_id:staging.FIREBASE_PROJECT_ID}));
    assert.deepEqual(senderEnvironment(edgeEnv({SUPABASE_URL:production.supabase.url}),{}),
        {environment:'production',appOrigin:production.appOrigin,firebaseProjectId:production.firebase.projectId});
});
test('staging sender rejects foreign destinations and strips foreign media', () => {
    const config=senderEnvironment(edgeEnv(edgeValues),{project_id:staging.FIREBASE_PROJECT_ID});
    const payload=isolatePayload({destination_url:'/chat.html?conversation=c%20x',actor_avatar_url:'https://www.freeupper.com/freeupper.png',media_url:'https://res.cloudinary.com/production/file'},config);
    assert.equal(payload.destination_url,staging.APP_ORIGIN+'/chat.html?conversation=c%20x');
    assert.equal(payload.actor_avatar_url,'');assert.equal(payload.media_url,'');
    assert.throws(()=>isolatePayload({destination_url:production.appOrigin+'/index.html'},config));
});
test('staging webhook authentication rejects missing/wrong secret; production model unchanged',async()=>{
    const config={environment:'staging'};
    assert.equal(await stagingRequestAllowed(new Request('https://stage.test'),edgeEnv(edgeValues),config),false);
    assert.equal(await stagingRequestAllowed(new Request('https://stage.test',{headers:{'x-freeupper-staging-secret':'y'.repeat(32)}}),edgeEnv(edgeValues),config),false);
    assert.equal(await stagingRequestAllowed(new Request('https://stage.test',{headers:{'x-freeupper-staging-secret':'x'.repeat(32)}}),edgeEnv(edgeValues),config),true);
    assert.equal(await stagingRequestAllowed({},edgeEnv({}),{environment:'production'}),true);
});
test('worker consumes shared config and guards explicit navigation; branch auto-deploy is disabled',async()=>{
    const worker=await fs.readFile(new URL('../firebase-messaging-sw.js',import.meta.url),'utf8');
    assert.match(worker,/importScripts\('\/runtime-config.js'\)/);
    assert.match(worker,/firebase.initializeApp\(self.FreeUpperConfig.firebase\)/);
    assert.match(worker,/self.FreeUpperNotificationUrl\(path\)/);
    assert.doesNotMatch(worker,/freeupper-notifications|37328138260/);
    const config=JSON.parse(await fs.readFile(new URL('../vercel.json',import.meta.url),'utf8'));
    assert.equal(config.git.deploymentEnabled['feature/global-push-notification-settings'],false);
    assert.equal(config.git.deploymentEnabled.main,undefined);
    assert.equal(config.buildCommand,'npm run build');
});
test('actual staging worker initializes staging Firebase and refuses production navigation/media',async()=>{
    const source=await fs.readFile(new URL('../firebase-messaging-sw.js',import.meta.url),'utf8');
    const opened=[],shown=[];let firebaseConfig,background;
    const context=vm.createContext({FreeUpperConfig:configuration(staging),location:{origin:staging.APP_ORIGIN},navigator:{},URL,Object,Number,
        console:{log(){},error(){}},addEventListener(){},registration:{showNotification:async(title,options)=>shown.push({title,options})},
        clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)},
        firebase:{initializeApp:config=>{firebaseConfig=config;},messaging:()=>({onBackgroundMessage:fn=>{background=fn;}})}});
    context.self=context;
    context.importScripts=url=>{if(url==='/runtime-config.js')vm.runInContext(guard,context);};
    vm.runInContext(source,context);
    assert.equal(firebaseConfig.projectId,staging.FIREBASE_PROJECT_ID);
    await context.openFreeUpperUrl('https://www.freeupper.com/chat.html?conversation=real');
    await context.openFreeUpperUrl('/chat.html?conversation=test%20only');
    assert.deepEqual(opened,[staging.APP_ORIGIN+'/index.html',staging.APP_ORIGIN+'/chat.html?conversation=test%20only']);
    await background({data:{actor_avatar_url:'https://www.freeupper.com/freeupper.png',media_url:'https://res.cloudinary.com/production/image'}});
    assert.equal(shown[0].options.icon,'/freeupper.png');
    assert.equal(shown[0].options.image,undefined);
});
test('all static pages load config before application scripts',async()=>{
    const directory=new URL('../',import.meta.url);
    for(const name of (await fs.readdir(directory)).filter(n=>n.endsWith('.html'))){
        const html=await fs.readFile(new URL(name,directory),'utf8');
        assert.ok(html.indexOf('/runtime-config.js')>=0,name);
        const auth=html.indexOf('src="auth.js"');
        if(auth>=0)assert.ok(html.indexOf('/runtime-config.js')<auth,name);
        assert.doesNotMatch(html,/jmjtqidirpmnegzvmiaq/);
    }
});
