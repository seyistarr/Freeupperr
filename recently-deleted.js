(function(){'use strict';let generation=0;const list=document.getElementById('posts'),status=document.getElementById('status');
async function refresh(){const stamp=++generation;list.replaceChildren();status.textContent='';try{
 const {data,error}=await window.sb.auth.getSession();if(stamp!==generation)return;
 document.getElementById('signin').hidden=!!data?.session;if(error||!data?.session){status.textContent=window.fuT('Sign in with your normal FreeUpper account.');return;}
 const result=await window.sb.rpc('list_deleted_posts');if(stamp!==generation)return;if(result.error||!Array.isArray(result.data))throw Error();
 if(!result.data.length)status.textContent=window.fuT('No recently deleted posts.');
 for(const post of result.data){const item=document.createElement('li'),label=document.createElement('p');label.textContent=(post.title||'Post')+' · '+(post.permanent?'Permanently deleted':'Recoverable until '+new Date(post.purge_after).toLocaleString());item.append(label);
 if(!post.permanent)for(const [rpc,text]of [['restore_post','Restore'],['permanently_delete_post','Delete permanently']]){const button=document.createElement('button');button.textContent=text;button.onclick=async()=>{if(rpc==='permanently_delete_post'&&!confirm(window.fuT('Permanently delete this post? It cannot be restored.')))return;button.disabled=true;const r=await window.sb.rpc(rpc,{p_post_id:post.id});if(stamp!==generation)return;if(r.error){status.textContent=window.fuT('Action could not be completed. Refresh and retry.');button.disabled=false;}else await refresh();};item.append(button);}list.append(item);}
 }catch{if(stamp===generation)status.textContent=window.fuT('Unable to load deleted posts. Check your session and retry.');}}
document.getElementById('signin').onclick=()=>window.AuthUser?.openModal('signin');document.getElementById('refresh').onclick=refresh;window.sb?.auth?.onAuthStateChange?.(()=>{generation++;list.replaceChildren();setTimeout(refresh,0);});refresh();})();
