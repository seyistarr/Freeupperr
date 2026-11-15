import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

// Every SDK method is mocked; no credential or email request leaves this fixture.
export const bootstrap = `
window.fuT = s => s;
window.FreeUpperSounds = {bindClient(){}};
window.fixture = {
  calls: [], session: null, profileError: false, missingProfile: false,
  profile: {id:'fixture-uuid', username:'chosen_name', display_name:'Chosen Name',freeupper_id:'FU123456789ABC'},
  user: {id:'fixture-uuid',email:'fixture@example.test',user_metadata:{}},
  ...window.fixtureOptions
};
const f = window.fixture;
const record = (method,args) => f.calls.push({method,args});
window.emitAuth = (event,session) => {f.session=session; f.listeners.forEach(fn=>fn(event,session));};
f.listeners = [];
window.supabase = {createClient(url,key,options){
  record('createClient',{url,options});
  return {auth:{
    onAuthStateChange(fn){f.listeners.push(fn); if(f.recovery) queueMicrotask(()=>{f.session={user:f.user};fn('PASSWORD_RECOVERY',f.session);}); else queueMicrotask(()=>fn('INITIAL_SESSION',f.session)); return {};},
    async getSession(){record('getSession'); if(f.sessionDelay)await new Promise(r=>setTimeout(r,f.sessionDelay));return {data:{session:f.session},error:f.sessionError};},
    async getUser(){return {data:{user:f.session?.user},error:null};},
    async signUp(args){record('signUp',args); if(f.signupError)return {error:f.signupError}; if(f.signupSession)f.session={user:f.user};return {data:{session:f.session},error:null};},
    async signInWithPassword(args){record('signInWithPassword',args);if(f.loginError)return {error:f.loginError};f.session={user:f.user};return {data:{session:f.session},error:null};},
    async resend(args){record('resend',args);return {error:f.emailError};},
    async resetPasswordForEmail(...args){record('resetPasswordForEmail',args);return {error:f.emailError};},
    async signInWithOAuth(args){record('signInWithOAuth',args);return {error:f.oauthError};},
    async updateUser(args){record('updateUser',args);return {error:f.updateError};},
    async signOut(args){record('signOut',args);f.session=null;return {};}
  },
  rpc:async()=>({data:[{}]}),functions:{invoke:async()=>({})},
  from(table){
    const q={select(){return q;},eq(){return q;},
      async maybeSingle(){record('profileRead',table);if(f.profileDelay)await new Promise(r=>setTimeout(r,f.profileDelay));return {data:f.missingProfile?null:f.profile,error:f.profileError?{message:'fixture read failed'}:null};},
      insert(){throw Error('Identity writes forbidden');},upsert(){throw Error('Identity writes forbidden');}
    };return q;
  }};
}};
localStorage.setItem('freeupper_seen_signup_prompt','1');
`;

export async function startFixture() {
  const root = new URL('../../', import.meta.url);
  const resetHtml = (await readFile(new URL('reset-password.html',root),'utf8'))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
    .replace(/<link\b[^>]*https:[^>]*>/gi,'');
  const server = createServer(async(req,res)=>{
    const pathname = new URL(req.url,'http://fixture').pathname;
    res.setHeader('Content-Type',pathname.endsWith('.js')?'application/javascript':'text/html');
    try {
      if (pathname === '/auth.js' || pathname === '/reset-password.js') return res.end(await readFile(new URL(pathname.slice(1),root)));
      const scripts = '<script>'+bootstrap+'</script><script data-fu-sounds></script>';
      if (pathname === '/reset-password.html') return res.end(resetHtml.replace('</body>',scripts+'<script src="/reset-password.js"></script></body>'));
      return res.end('<!doctype html><html><head></head><body>'+scripts+'<script src="/auth.js"></script></body></html>');
    } catch(error){res.statusCode=500;res.end(String(error));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
