import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../lib/protected-media/staging-session.js',import.meta.url),'utf8').replace('export const','const')+'\nglobalThis.session = stagingSession;';
function fixture(){
 let callback,held,sessionValue;const events=[],queue=[];
 const auth={onAuthStateChange(cb){callback=cb;},async signOut(){callback?.('SIGNED_OUT',null);sessionValue=null;},
  signInWithPassword(){return new Promise(resolve=>{held=resolve;queue.push(resolve);});},async getSession(){return {data:{session:sessionValue}};}};
 const window={supabase:{createClient:()=>({auth})},addEventListener(){},dispatchEvent(event){events.push(event.type);}};
 const context=vm.createContext({window,CustomEvent:class{constructor(type){this.type=type;}},fetch:async()=>({ok:true,json:async()=>({enabled:true,supabaseUrl:'https://tagkrhvgcbnybiuyvjxt.supabase.co',anonKey:'synthetic'})})});
 vm.runInContext(code,context);
 return {session:context.session,events,async wait(){while(!held)await new Promise(resolve=>setImmediate(resolve));},complete(id,error=null){sessionValue={user:{id},access_token:'synthetic-'+id};callback?.('SIGNED_IN',sessionValue);held({data:{session:sessionValue},error});held=null;}};
}
test('logout during pending sign-in cannot reactivate the old account',async()=>{
 const f=fixture(),login=f.session.signIn('synthetic','password');await f.wait();
 await f.session.signOut();f.complete('owner');
 await assert.rejects(login,/unavailable/);assert.equal(f.session.enabled,false);assert.equal(await f.session.getSession(),null);
});
test('failed replacement login clears old identity and successful replacement commits a new identity',async()=>{
 const f=fixture();let login=f.session.signIn('owner','password');await f.wait();f.complete('owner');await login;
 assert.equal(f.session.userId,'owner');assert.equal((await f.session.getSession()).user.id,'owner');
 login=f.session.signIn('other','bad');await f.wait();assert.equal(f.session.enabled,false);f.complete('other',Error());await assert.rejects(login);
 assert.equal(f.session.enabled,false);assert.equal(f.session.userId,null);
 login=f.session.signIn('other','good');await f.wait();f.complete('other');await login;assert.equal(f.session.userId,'other');
});
test('overlapping login requests cannot commit the superseded identity',async()=>{
 const f=fixture(),first=f.session.signIn('first','password');const rejected=assert.rejects(first,/superseded/);
 const second=f.session.signIn('second','password');await f.wait();f.complete('second');await second;await rejected;
 assert.equal(f.session.userId,'second');
});
