(function(){'use strict';
const $=id=>document.getElementById(id),grid=$('posts'),status=$('status'),bar=$('rdBar'),all=$('rdSelectAll'),bulk=$('rdRestoreSel'),overlay=$('rdOverlay');
let generation=0,posts=[],busy=false;const selected=new Set();
function say(s){status.textContent=s||''}
function modal(title,message,destructive){return new Promise(resolve=>{ $('rdSheetTitle').textContent=title;$('rdSheetText').textContent=message;const actions=$('rdSheetActions');actions.replaceChildren();let settled=false;function done(v){if(settled)return;settled=true;overlay.classList.remove('open');overlay.setAttribute('aria-hidden','true');overlay.removeEventListener('click',outside);document.removeEventListener('keydown',escape);resolve(v)}function outside(e){if(e.target===overlay)done(false)}function escape(e){if(e.key==='Escape')done(false)}for(const [label,value] of [['Cancel',false],[destructive?'Delete permanently':'OK',true]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.className=value&&destructive?'rd-confirm':'rd-cancel';b.onclick=()=>done(value);actions.append(b)}overlay.classList.add('open');overlay.setAttribute('aria-hidden','false');overlay.addEventListener('click',outside);document.addEventListener('keydown',escape)})}
function media(post){const o=post.media&&typeof post.media==='object'?(Array.isArray(post.media)?post.media[0]:post.media):null;const first=Array.isArray(post.media_urls)?post.media_urls[0]:null;const url=post.thumbnail_url||post.poster_url||post.image_url||post.media_url||post.video_thumbnail_url||(o&&typeof o==='object'&&(o.thumbnail_url||o.poster_url||o.url))||(typeof first==='string'?first:first?.url)||'';const video=/video/i.test(String(post.media_type||post.type||''));return {url:typeof url==='string'&&url.startsWith('https://')?url:'',video}}
function render(){grid.replaceChildren();if(!posts.length){const li=document.createElement('li');li.className='rd-empty';li.textContent='No recently deleted posts.';grid.append(li);bar.hidden=true;return}bar.hidden=false;for(const p of posts){const li=document.createElement('li'),card=document.createElement('article'),thumb=document.createElement('div'),check=document.createElement('span'),kind=document.createElement('span'),text=document.createElement('span'),expiry=document.createElement('div'),actions=document.createElement('div');const m=media(p);card.className='rd-card'+(selected.has(String(p.id))?' selected':'');thumb.className='rd-thumb';thumb.setAttribute('role','checkbox');thumb.tabIndex=0;thumb.setAttribute('aria-label','Select deleted post');thumb.setAttribute('aria-checked',String(selected.has(String(p.id))));check.className='rd-check';check.textContent=selected.has(String(p.id))?'✓':'';kind.className='rd-badge';kind.textContent=m.video?'▶ Video':m.url?'▧ Image':'✎ Post';if(m.url){const img=document.createElement('img');img.src=m.url;img.loading='lazy';img.alt='Deleted post preview';img.onerror=()=>{img.remove();text.className='rd-text';text.textContent=p.title||p.content||p.description||'Preview unavailable';thumb.prepend(text)};thumb.append(img)}else{text.className='rd-text';text.textContent=p.title||p.content||p.description||'Preview unavailable';thumb.append(text)}thumb.append(kind,check);thumb.onclick=()=>{const id=String(p.id);selected.has(id)?selected.delete(id):selected.add(id);render()};thumb.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();thumb.click()}};expiry.className='rd-expiry';expiry.textContent=p.purge_after?'Until '+new Date(p.purge_after).toLocaleDateString():'Recoverable';actions.className='rd-actions';for(const [label,cls,action] of [['↶ Restore','rd-restore','restore'],['Delete','rd-delete','delete']]){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;b.disabled=busy;b.onclick=()=>action==='restore'?restore([String(p.id)]):purge(String(p.id));actions.append(b)}card.append(thumb,expiry,actions);li.append(card);grid.append(li)}const count=selected.size;all.textContent=count===posts.length?'✓ Deselect all':'◯ Select all ('+count+')';bulk.textContent='↶ Restore selected'+(count?' ('+count+')':'');bulk.disabled=!count||busy;all.disabled=busy}
async function refresh(){const stamp=++generation;selected.clear();posts=[];grid.replaceChildren();bar.hidden=true;say('Loading deleted posts…');try{const sb=window.sb;if(!sb?.auth)throw Error('Client unavailable');const {data,error}=await sb.auth.getSession();if(stamp!==generation)return;$('signin').hidden=!!data?.session;if(error||!data?.session){say('Sign in with your normal FreeUpper account.');return}const result=await sb.rpc('list_deleted_posts');if(stamp!==generation)return;if(result.error||!Array.isArray(result.data))throw Error('List failed');posts=result.data.filter(p=>!p.permanent);
const ids=posts.map(p=>p.id).filter(Boolean);
if(ids.length){
  // Only enrich entries authorized by list_deleted_posts. RLS still applies.
  const [details,attachments]=await Promise.all([
    sb.from('posts').select('id,title,description,content,media_url,media_type,thumbnail_url,media').in('id',ids),
    sb.from('post_media').select('post_id,url,type,thumbnail,order_index').in('post_id',ids).order('order_index',{ascending:true})
  ]);
  if(stamp!==generation)return;
  const detailMap=new Map((details.data||[]).map(p=>[String(p.id),p]));
  const attachmentMap=new Map();
  for(const item of attachments.data||[]){
    const key=String(item.post_id);
    if(!attachmentMap.has(key))attachmentMap.set(key,[]);
    attachmentMap.get(key).push(item);
  }
  posts=posts.map(p=>{
    const extra=detailMap.get(String(p.id))||{};
    const files=attachmentMap.get(String(p.id))||[];
    const first=files[0];
    return {...p,...extra,
      title:extra.title||p.title||extra.content||extra.description||p.content||p.description||'',
      media_url:extra.media_url||first?.url||p.media_url||'',
      thumbnail_url:extra.thumbnail_url||first?.thumbnail||p.thumbnail_url||'',
      media_type:extra.media_type||first?.type||p.media_type||'',
      media:extra.media||p.media||null
    };
  });
}
say('');render()}catch{if(stamp===generation)say('Unable to load deleted posts. Check your session and retry.')}}
async function restore(ids){if(busy||!ids.length)return;busy=true;render();say('Restoring…');let ok=0;try{for(const id of ids){const r=await window.sb.rpc('restore_post',{p_post_id:id});if(r.error)throw Error('Restore failed');ok++;selected.delete(id);posts=posts.filter(p=>String(p.id)!==id)}say('Restored '+ok+' post'+(ok===1?'':'s')+'.')}catch{say(ok+' restored; another restore failed. Refresh and retry.')}finally{busy=false;render()}}
async function purge(id){if(busy)return;const yes=await modal('Delete permanently?','This post cannot be restored after permanent deletion.',true);if(!yes)return;busy=true;render();say('Deleting…');try{const r=await window.sb.rpc('permanently_delete_post',{p_post_id:id});if(r.error)throw Error('Delete failed');posts=posts.filter(p=>String(p.id)!==id);selected.delete(id);say('Post permanently deleted.')}catch{say('Delete failed. Refresh and retry.')}finally{busy=false;render()}}
all.onclick=()=>{if(selected.size===posts.length)selected.clear();else posts.forEach(p=>selected.add(String(p.id)));render()};
bulk.onclick=()=>restore([...selected]);$('rdHelp').onclick=()=>modal('About Recently Deleted','Deleted posts can be restored for seven days. Permanent deletion cannot be undone. Protected media cleanup may finish after signed upload links expire.',false);
$('signin').onclick=()=>window.AuthUser?.openModal('signin');
window.sb?.auth?.onAuthStateChange?.(()=>{generation++;setTimeout(refresh,0)});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)refresh()});refresh();
})();