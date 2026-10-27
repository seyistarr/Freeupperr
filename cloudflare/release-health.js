export async function releaseHealth(env, upstreamFetch=fetch) {
  let release=null;
  if(env.SUPABASE_ANON_KEY)try{
    const response=await upstreamFetch('https://api.freeupper.com/rest/v1/rpc/privacy_release_status',{
      method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
    if(response.ok){const data=await response.json();if(typeof data.delivery==='boolean'&&typeof data.publishing==='boolean'&&data.legacy_conversion===false)release=data;}
  }catch{}
  return Response.json({ok:true,worker:'freeupper-web',publicRoutesReady:true,
    releaseVerified:!!release,restrictedAudiencesEnabled:!!(release?.delivery&&release?.publishing),release},
    {headers:{'Cache-Control':'private, no-store'}});
}
