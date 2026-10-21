// Server/operator only. No remote URLs supplied by a browser are ever fetched.
import { createHash } from 'node:crypto';
import { protectedDraftFields } from './staging-publishing-server.js';
export const LEGACY_CLOUD = 'sxdcqs5x';
export const REVOCATION_WAIT_MS = 31 * 24 * 60 * 60 * 1000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const hash = value => createHash('sha256').update(value).digest('hex');

export function publicAsset(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw Error('Unrecognized legacy URL'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com' || parsed.port ||
      parsed.username || parsed.password || parsed.search || parsed.hash) throw Error('Unsupported legacy host or URL');
  const match = new RegExp('^/' + LEGACY_CLOUD + '/(image|video)/upload/(.*?)(?:v([0-9]+)/)([A-Za-z0-9_/-]+)\\.([a-z0-9]{2,8})$').exec(parsed.pathname);
  if (!match) throw Error('Versioned, unsigned staging upload URL required');
  // Reject layers, audio dependencies, named transformations and signed paths.
  // Only simple, self-contained display transformations are migratable.
  const transforms = match[2].replace(/\/$/, '').split(/[\/,]/).filter(Boolean);
  if (transforms.some(t => !/^(?:(?:w|h|so|du|ar)_[0-9.:]+|c_(?:fill|limit|fit|scale|crop)|g_(?:auto|center)|so_auto|q_(?:auto|[0-9]+)|f_(?:auto|jpg|png|webp|mp4)|vc_h264)$/.test(t))) {
    throw Error('Composite, signed or unknown transformations require separate protection');
  }
  return { url: parsed.href, resource_type: match[1], version: Number(match[3]), public_id: match[4], format: match[5] };
}
export function urlsIn(value, path = []) {
  if (typeof value === 'string') return [...value.matchAll(/(?:https?:\/\/|\/\/)[^\s"'<>\\]+/g)].map(m => ({ path, url: m[0] }));
  if (Array.isArray(value)) return value.flatMap((v, i) => urlsIn(v, [...path, String(i)]));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k,v]) => urlsIn(v, [...path,k]));
  return [];
}
export function planLegacyPost(post) {
  if (!UUID.test(post?.id || '') || !UUID.test(post?.user_id || '') || post.visibility !== 'public' ||
      post.publishing_state !== 'published' || post.is_hidden || post.is_deleted) throw Error('Visible, owned Public post required');
  const payload = post.publish_payload || {};
  if (post.sound_id || payload.sound_id || post.text_template_id || payload.text_template_id ||
      post.source_post_id || post.quoted_post_id || post.original_post_id || post.repost_of) throw Error('Sound, text template or copied-post dependency requires separate protection');
  const entries = [], refs = [], permittedPaths = new Set();
  const add = (url, type, path) => {
    if (!url || typeof url !== 'string') throw Error('Missing legacy media');
    permittedPaths.add(path.join('.'));
    const source = publicAsset(url);
    if (type === 'video' && source.resource_type !== 'video') throw Error('Media type mismatch');
    if (type === 'image' && !['jpg','jpeg','png','webp','avif','gif'].includes(source.format)) throw Error('Unsupported poster or image');
    let slot = entries.findIndex(e => e.url === url && e.type === type);
    if (slot < 0) { slot = entries.length; entries.push({ ...source, type, slot }); }
    return slot;
  };
  let media = post.media;
  if (!Array.isArray(media) || !media.length) media = post.media_url ? [{url:post.media_url,type:post.media_type}] : [];
  if (media.length < 1 || media.length > 20) throw Error('Images or one video required');
  for (let i=0; i<media.length; i++) {
    const m = typeof media[i] === 'string' ? {url:media[i],type:'image'} : media[i];
    if (!m || !['image','video'].includes(m.type) || (m.type === 'video' && media.length !== 1)) throw Error('Unsupported media batch');
    if (Object.keys(m).some(k => !['url','type','thumbnailUrl','thumbnail_url','public_id'].includes(k))) throw Error('Unreviewed media metadata');
    if (m.public_id && m.public_id!==publicAsset(m.url).public_id) throw Error('Conflicting public asset identity');
    const slot = add(m.url,m.type,post.media?.length ? ['media',String(i),...(typeof media[i]==='string'?[]:['url'])] : ['media_url']);
    const ref={type:m.type,slot};
    const storedPoster=m.thumbnailUrl || m.thumbnail_url || (i===0 ? post.thumbnail_url : '');
    // Older Studio videos have no stored poster. Prepare its URL without fetching
    // during dry-run; the copy phase creates an authenticated image and records
    // both old derived aliases for revocation checks.
    const poster=storedPoster || (m.type==='video' ? m.url.replace('/video/upload/','/video/upload/so_0/').replace(/\.[a-z0-9]{2,8}$/,'.jpg') : '');
    if (poster) ref.thumbnail_slot=add(poster,'image',m.thumbnailUrl?['media',String(i),'thumbnailUrl']:m.thumbnail_url?['media',String(i),'thumbnail_url']:['thumbnail_url']);
    if (m.thumbnailUrl && m.thumbnail_url && m.thumbnailUrl!==m.thumbnail_url) throw Error('Conflicting poster aliases');
    refs.push(ref);
  }
  // Track aliases too; never discard a secondary URL just because a canonical one exists.
  for(const [key,type] of [['media_url',refs[0].type],['thumbnail_url','image']]) {
    if(post[key]) add(post[key],type,[key]);
  }
  const inspectReferences=(value,path=[])=>{
    if(!value || typeof value!=='object') return;
    for(const [key,item] of Object.entries(value)) {
      const next=[...path,key];
      if(/url|poster|audio|music|sound|overlay|original/i.test(key) &&
        item!=null && item!==false && item!=='' && JSON.stringify(item)!=='[]' && JSON.stringify(item)!=='{}' &&
        !permittedPaths.has(next.join('.'))) throw Error('Unsupported legacy reference at '+next.join('.'));
      inspectReferences(item,next);
    }
  };
  inspectReferences(post);
  for (const found of urlsIn(post)) if (!permittedPaths.has(found.path.join('.'))) throw Error('Unreviewed public URL at '+found.path.join('.'));
  const fields=protectedDraftFields({title:post.title ?? payload.title,content:post.content ?? payload.content,
    tags:post.tags ?? payload.tags,source:post.source ?? payload.source ?? 'composer',commentsHidden:post.comments_hidden ?? payload.comments_hidden});
  if (entries.length>21) throw Error('Too many distinct media renditions');
  return { entries, refs, payload:fields };
}
export function verifySource(asset, entry, post, provenance=false) {
  const context=asset?.context?.custom || {};
  if (provenance!==true || !/^[a-f0-9]{32}$/.test(asset?.asset_id || '') || asset.public_id!==entry.public_id ||
      asset.resource_type!==entry.resource_type || asset.type!=='upload' || asset.version!==entry.version ||
      (context.freeupper_owner_id && context.freeupper_owner_id!==post.user_id) ||
      (context.freeupper_post_id && context.freeupper_post_id!==post.id) ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes<1 || asset.bytes>50*1024*1024 || asset.placeholder || asset.deleted ||
      asset.derived_next_cursor || asset.next_cursor) throw Error('Source identity, provenance, size or derivative inventory not verified');
  publicAsset(asset.secure_url);
  return asset;
}
export function probeUrls(asset, entries) {
  const urls=new Set();
  for(const url of [asset.secure_url,...entries.map(e=>e.url),...(asset.derived || []).map(d=>d.secure_url || d.url)]) {
    if (!url) throw Error('Derivative URL unavailable');
    // Admin derivative metadata sometimes omits a version. Bind it to the
    // already verified immutable source instead of guessing a folder boundary.
    const suffix='/'+asset.public_id+'.';
    const at=url.lastIndexOf(suffix);
    const versioned=/\/v[0-9]+\//.test(url) ? url : at<0 ? url : url.slice(0,at)+'/v'+asset.version+url.slice(at);
    const u=publicAsset(versioned);
    if(u.public_id!==asset.public_id || u.resource_type!==asset.resource_type) throw Error('Derivative identity mismatch');
    urls.add(url); urls.add(versioned); urls.add(versioned.replace(/\/v[0-9]+\//,'/'));
    // Legacy folder-ID invalidation can target SDK /v1/ aliases separately.
    if(asset.public_id.includes('/'))urls.add(versioned.replace(/\/v[0-9]+\//,'/v1/'));
  }
  if(urls.size>500) throw Error('Derivative inventory requires manual review');
  return [...urls];
}
export function validateProbeUrl(url) {
  // Includes unversioned aliases, but never permits redirects, fetch URLs or other clouds.
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' || parsed.host!=='res.cloudinary.com' || parsed.search || parsed.hash ||
     parsed.username || parsed.password || !parsed.pathname.startsWith('/'+LEGACY_CLOUD+'/') ||
     !/^\/(?:sxdcqs5x)\/(?:image|video)\/upload\/[A-Za-z0-9_.,:/-]+$/.test(parsed.pathname)) throw Error('Unsafe probe URL');
  return url;
}
