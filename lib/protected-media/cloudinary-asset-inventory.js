// Read every derived-resource page before considering a public source migratable.
// Use the documented derived_next_cursor contract; generic metadata cursors
// do not imply more derivatives when an explicit short derived page is present.
export async function readCompleteCloudinaryAsset({cloudinary,publicId,assetId,resourceType,type='upload',fetchImpl=fetch}) {
  const first=assetId ? await cloudinary.api.resource_by_asset_id(assetId,{context:true,max_results:100}) :
    await cloudinary.api.resource(publicId,{type,resource_type:resourceType,context:true,max_results:100});
  if(!first?.asset_id || (assetId && first.asset_id!==assetId) || (publicId && first.public_id!==publicId) ||
    first.type!==type || (resourceType && first.resource_type!==resourceType)) throw Error('Source identity mismatch');
  const next = page => {
    if(!Array.isArray(page.derived)) throw Error('Incomplete Cloudinary derivative inventory');
    // Cloudinary documents max_results <=100 and derived_next_cursor for this
    // list. Some responses include an unrelated generic cursor even with zero
    // derived assets. A short explicit page with no derived cursor is terminal.
    return page.derived_next_cursor || (page.derived.length>=100 ? page.next_cursor : null);
  };
  const derived=[...(first.derived || [])],seen=new Set();
  let derivedCursor=!!first.derived_next_cursor;
  let cursor=next(first);
  while(cursor) {
    if(seen.has(cursor) || seen.size>=20) throw Error('Incomplete Cloudinary derivative inventory');
    seen.add(cursor);
    let page;
    if(derivedCursor) {
      page=await cloudinary.api.resource(first.public_id,{type,resource_type:first.resource_type,context:true,
        max_results:100,derived_next_cursor:cursor});
    } else {
      // The SDK filters generic next_cursor out of resource() options. Use the
      // documented REST cursor directly; never silently repeat/skip that page.
      const config=cloudinary.config();
      if(config.cloud_name!=='sxdcqs5x' || !config.api_key || !config.api_secret) throw Error('Staging pagination configuration required');
      const url=new URL('https://api.cloudinary.com/v1_1/sxdcqs5x/resources/'+first.resource_type+'/'+type+'/'+encodeURIComponent(first.public_id));
      url.searchParams.set('max_results','100');url.searchParams.set('next_cursor',cursor);
      let response;
      try {response=await fetchImpl(url,{headers:{Authorization:'Basic '+Buffer.from(config.api_key+':'+config.api_secret).toString('base64')},
        redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('Cloudinary pagination unavailable');}
      if(!response.ok) {await response.body?.cancel();throw Error('Cloudinary pagination unavailable');}
      page=await response.json();
    }
    if((page.asset_id && page.asset_id!==first.asset_id) || (page.version!=null && page.version!==first.version)) throw Error('Source changed during inventory');
    derived.push(...(page.derived || []));
    derivedCursor=!!page.derived_next_cursor;
    cursor=next(page);
  }
  if(seen.size) {
    const current=await cloudinary.api.resource_by_asset_id(first.asset_id,{context:true});
    if(current.asset_id!==first.asset_id || current.version!==first.version || current.public_id!==first.public_id || current.type!==type) throw Error('Source changed during inventory');
  }
  const result={...first,derived_inventory_complete:true,derived:[...new Map(derived.map(d=>[d.id || d.secure_url || d.url,d])).values()]};
  delete result.next_cursor;delete result.derived_next_cursor;
  return result;
}
