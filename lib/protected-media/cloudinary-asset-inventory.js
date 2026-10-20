// Read every derived-resource page before considering a public source migratable.
// Cloudinary resource details use next_cursor with derived_next_cursor requests.
export async function readCompleteCloudinaryAsset({cloudinary,publicId,assetId,resourceType,type='upload'}) {
  const first=assetId ? await cloudinary.api.resource_by_asset_id(assetId,{context:true,max_results:100}) :
    await cloudinary.api.resource(publicId,{type,resource_type:resourceType,context:true,max_results:100});
  if(!first?.asset_id || (assetId && first.asset_id!==assetId) || (publicId && first.public_id!==publicId) ||
    first.type!==type || (resourceType && first.resource_type!==resourceType)) throw Error('Source identity mismatch');
  const derived=[...(first.derived || [])],seen=new Set();
  let cursor=first.derived_next_cursor || first.next_cursor;
  while(cursor) {
    if(seen.has(cursor) || seen.size>=20) throw Error('Incomplete Cloudinary derivative inventory');
    seen.add(cursor);
    const page=await cloudinary.api.resource(first.public_id,{type,resource_type:first.resource_type,context:true,
      max_results:100,derived_next_cursor:cursor});
    if((page.asset_id && page.asset_id!==first.asset_id) || (page.version!=null && page.version!==first.version)) throw Error('Source changed during inventory');
    derived.push(...(page.derived || []));
    cursor=page.derived_next_cursor || page.next_cursor;
  }
  if(seen.size) {
    const current=await cloudinary.api.resource_by_asset_id(first.asset_id,{context:true});
    if(current.asset_id!==first.asset_id || current.version!==first.version || current.public_id!==first.public_id || current.type!==type) throw Error('Source changed during inventory');
  }
  const result={...first,derived:[...new Map(derived.map(d=>[d.id || d.secure_url || d.url,d])).values()]};
  delete result.next_cursor;delete result.derived_next_cursor;
  return result;
}
