// Portable content API. Gallery is existing eligible video content, never a collection.
(function(){
 "use strict";
 const actor=()=>window.AuthUser?.getCurrentUser()?.isLoggedIn?window.AuthUser.getCurrentUser().id:'guest';
 const call=async(name,args={})=>{const {data,error}=await window.sb.rpc(name,args);if(error)throw error;return data;};
 // Existing profile APIs and RLS remain authoritative; no Gallery schema or RPC.
 async function content(owner,tab,gallery,offset=0){
  const expected=actor();
  const check=()=>{if(actor()!==expected)throw Error('Account changed');};
  const empty=()=>Object.assign([],{nextOffset:offset,hasMore:false});
  if(!owner||!['posts','love','share','star'].includes(tab))throw Error('Invalid profile scope');
  if(tab==='star'&&owner!==expected)return empty();
  const identity=await call('get_profile_identity_by_id',{p_user_id:owner});check();
  const id=Array.isArray(identity)?identity[0]:identity;
  if(!id?.freeupper_id)throw Error('Profile unavailable');
  const profiles=await call('get_profile_by_freeupper_id',{p_freeupper_id:id.freeupper_id});check();
  const profile=Array.isArray(profiles)?profiles[0]:profiles;
  if(!profile||profile.suspended)throw Error('Profile unavailable');
  if(owner!==expected){
   if(profile.is_private && (expected==='guest'||!await call('privacy_v2_approved_edge',{p_follower:expected,p_following:owner})))return empty();
   if(tab!=='posts'&&!await call('can_view_profile_tab',{p_owner:owner,p_tab:tab}))return empty();
   if(tab==='posts'&&profile.hide_all_posts)return empty();
  }
  check();
  const result=[];let more=true;
  while(result.length<24&&more){
   let posts;
   if(tab==='posts'){
    const page=await window.PostsAPI.loadProfilePage(owner,{offset,limit:24});
    posts=page.posts;more=offset+24<page.total;
   }else{
    const table={love:'post_likes',share:'reposts',star:'bookmarks'}[tab];
    const {data,error}=await window.sb.from(table).select('post_id').eq('user_id',owner)
     .order('created_at',{ascending:false}).order('post_id',{ascending:false}).range(offset,offset+23);
    if(error)throw error;
    const ids=(data||[]).map(row=>row.post_id);more=ids.length===24;
    const mapped=new Map((await window.PostsAPI.loadPostIds(ids)).map(p=>[p.id,p]));
    posts=ids.map(id=>mapped.get(id)).filter(Boolean);
   }
   check();offset+=24;
   result.push(...posts.filter(p=>gallery?p.mediaType==='video':p.source!=='studio'));
  }
  return Object.assign(result,{nextOffset:offset,hasMore:more});
 }
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('freeupper-content-v1'):null;
 channel?.addEventListener('message',e=>{if(e.data?.viewer===actor())window.dispatchEvent(new CustomEvent('fu-content-change',{detail:e.data}));});
 addEventListener('pagehide',e=>{if(!e.persisted)channel?.close();},{once:true});
 window.sb?.auth?.onAuthStateChange(()=>window.VideoRender?.clearSoundCache?.());
 window.GalleryAPI={
  notes:(owner,tab,offset=0)=>content(owner,tab,false,offset),
  async profile(owner,tab,offset=0){const page=await content(owner,tab,true,offset);return Object.assign(page.map(post=>({post,title:post.title,post_id:post.id})),{nextOffset:page.nextOffset,hasMore:page.hasMore});},
  async items(owner,tab){
   const expected=actor(),result=[];
   for(let offset=0;;){
    const page=await this.profile(owner,tab,offset);
    if(actor()!==expected)throw Error('Account changed');
    result.push(...page);
    if(!page.hasMore)return result;
    offset=page.nextOffset;
   }
  },
  async ensureSound(id){if(!id)return null;const sound=await window.SoundsAPI.loadSound(id);if(!sound)throw Error('Sound unavailable');return sound;},
  changed(change){const detail={...change,viewer:actor()};window.dispatchEvent(new CustomEvent('fu-content-change',{detail}));channel?.postMessage(detail);if(parent!==window&&!channel)parent.postMessage({type:'fu-content-change',detail},location.origin);}
 };
})();
