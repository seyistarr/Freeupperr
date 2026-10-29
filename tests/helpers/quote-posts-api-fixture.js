import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
export const source=await readFile(new URL('../../posts.js',import.meta.url),'utf8');
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function postsFixture({enabled=true,approved=false,rows=[],originals=new Map(),missing=false,referenceFailure=false}={}) {
 const calls=[];let writes=0;let transientFailures=0;
 const apiRows=rows;const sb={
  auth:{getUser:async()=>({data:{user:{id:id(6)}}})},
  from(table){
   let action='select',payload,one=false;const filters=[];
   const q={select(fields){calls.push({table,select:fields});return q;},eq(k,v){filters.push([k,v]);return q;},in(k,v){return q;},order(){return q;},range(){return q;},is(){return q;},limit(){return q;},
    insert(v){action='insert';payload=v;return q;},single(){one=true;return q;},maybeSingle(){one=true;return q;},
    async then(resolve,reject){try{
     if(table!=='posts')return resolve({data:[]});
     if(action==='insert'){writes++;const row={...payload,id:id(700),created_at:'2026-10-29T00:00:00Z',profiles:{id:id(6),username:'quoter'}};apiRows.push(row);return resolve({data:row});}
     let data=apiRows.filter(r=>filters.every(([k,v])=>r[k]===v));return resolve({data:one?data[0]||null:data});
    }catch(e){reject(e);}}
   };return q;
  },
  async rpc(name,args){
   calls.push({rpc:name,args});
   if(missing)return {error:{code:'PGRST202',message:'Function not found'}};
   if(name==='quote_repost_status')return {data:{schemaVersion:1,readEnabled:true,publishingEnabled:true}};
   if(name==='get_quotable_post')return {data:originals.get(args.p_post_id)||null};
   if(name==='load_quote_references'){
    if(referenceFailure)throw Error('network unavailable');
    return {data:args.p_post_ids.map(post_id=>({post_id,original:originals.get(apiRows.find(r=>r.id===post_id)?.quoted_post_id)||null}))};
   }
   if(name==='create_quote_post'){
    if(transientFailures-->0)return {error:{code:'40001',message:'serialization failure'}};
    let row=apiRows.find(r=>r.id===args.p_post_id);
    if(!row){writes++;row={...args.p_fields,id:args.p_post_id,user_id:id(6),quoted_post_id:args.p_quoted_post_id,is_quote:true,visibility:'public',is_hidden:false,publishing_state:'published',created_at:'2026-10-29T00:00:00Z'};apiRows.push(row);}
    return {data:row};
   }
   if(name==='toggle_repost')return {data:[{reposted:true,count:3,out_comment:args.p_comment,out_time:'2026-10-29T00:00:00Z'}]};
   if(name==='update_repost_comment')return {data:[{reposted:true,count:3,out_comment:args.p_comment,out_time:'2026-10-29T00:00:00Z'}]};
   return {data:[]};
  }
 };
 const context={window:{sb,document:{querySelector:()=>enabled?{}:null}},console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,crypto:globalThis.crypto};
 vm.createContext(context);vm.runInContext(approved?source.replace('const QUOTE_PUBLISHING_REVIEWED = false','const QUOTE_PUBLISHING_REVIEWED = true'):source,context);
 return {api:context.window.PostsAPI,calls,rows:apiRows,get writes(){return writes;},retry(n){transientFailures=n;}};
}
