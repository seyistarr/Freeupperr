// Uses the real Edge handler with fake Supabase and fake Cloudinary I/O.
// Never connects to FreeUpper accounts, servers, production Cloudinary or Supabase.
import { assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import type { createClient } from "jsr:@supabase/supabase-js@2.110.8";

for(const [key,value] of Object.entries({
  SUPABASE_URL:"https://example.invalid",
  SUPABASE_ANON_KEY:"integration-anon-test",
  SUPABASE_SERVICE_ROLE_KEY:"integration-service-test",
  CLOUDINARY_CLOUD_NAME:"integration-cloud-test",
  CLOUDINARY_API_KEY:"integration-key-test",
  CLOUDINARY_API_SECRET:"integration-secret-test",
  CHAT_PRIVATE_MEDIA_ENABLED:"true"
})) Deno.env.set(key,value);

const {handleViewOnceOpen} = await import("../supabase/functions/view-once-open/index.ts");
const ID="11111111-1111-4111-8111-111111111111";
const USER="22222222-2222-4222-8222-222222222222";
const req=(token="test-jwt")=>new Request("https://example.invalid/functions/v1/view-once-open",{
  method:"POST",headers:{
    authorization:token ? "Bearer "+token : "",
    origin:"https://www.freeupper.com","content-type":"application/json"
  },
  body:JSON.stringify({message_id:ID,media_index:0})
});
function setup(options:{
  validUser?:boolean;
  assetStatus?:string;
  claimStatuses?:string[];
  cloudStatus?:number;
  cloudBytes?:number[];
}={}){
  const calls:{check:number;claims:number;download:number}={check:0,claims:0,download:0};
  const queue=[...(options.claimStatuses ?? ["opened"])];
  const makeClient=((_:string,key:string)=>{
    if(key==="integration-anon-test") return {
      auth:{getUser:async()=>({
        data:{user:options.validUser===false?null:{id:USER}},
        error:options.validUser===false?{message:"unauthorized"}:null
      })},
      rpc:async(name:string,args:Record<string,unknown>)=>{
        if(name!=="claim_view_once") throw Error("Unexpected user RPC "+name);
        assertEquals(args,{p_message_id:ID,p_media_index:0});
        calls.claims++;
        return {data:{status:queue.shift()??"already_viewed"},error:null};
      }
    };
    if(key==="integration-service-test") return {
      rpc:async(name:string,args:Record<string,unknown>)=>{
        assertEquals(name,"chat_check_private_asset");
        assertEquals(args,{p_viewer:USER,p_message_id:ID});
        calls.check++;
        return {data:{
          status:options.assetStatus??"ok",
          asset_id:"private-asset-test", resource_type:"image",mime_type:"image/png"
        },error:null};
      }
    };
    throw Error("Unexpected credential");
  }) as unknown as typeof createClient;
  const fakeFetch=(async (url: string|URL|Request)=>{
    const u=String(url);
    assertMatch(u,/api\.cloudinary\.com\/v1_1\/integration-cloud-test\/asset\/download\?/);
    calls.download++;
    const data=new Uint8Array(options.cloudBytes??[137,80,78,71]);
    return new Response(data.buffer as ArrayBuffer,{
      status:options.cloudStatus??200,headers:{"Content-Type":"application/octet-stream"}
    });
  }) as typeof fetch;
  return {calls,deps:{createClient:makeClient,fetch:fakeFetch}};
}

Deno.test("unauthenticated viewer rejected before database or media access",async()=>{
  const {deps,calls}=setup();
  const res=await handleViewOnceOpen(req(""),deps);
  assertEquals(res.status,401);
  assertEquals(calls,{check:0,claims:0,download:0});
});
Deno.test("invalid JWT rejected before media access",async()=>{
  const {deps,calls}=setup({validUser:false});
  const res=await handleViewOnceOpen(req(),deps);
  assertEquals(res.status,401);
  assertEquals(calls,{check:0,claims:0,download:0});
});
Deno.test("nonparticipant denied without claiming or downloading media",async()=>{
  const {deps,calls}=setup({assetStatus:"forbidden"});
  const res=await handleViewOnceOpen(req(),deps);
  assertEquals(res.status,403);
  assertEquals(calls,{check:1,claims:0,download:0});
});
Deno.test("successful one-time private binary response cannot be replayed",async()=>{
  const {deps,calls}=setup({claimStatuses:["opened","already_viewed"]});
  const first=await handleViewOnceOpen(req(),deps);
  assertEquals(first.status,200);
  assertEquals(first.headers.get("content-type"),"image/png");
  assertMatch(first.headers.get("cache-control")??"",/no-store/);
  assertEquals([...new Uint8Array(await first.arrayBuffer())],[137,80,78,71]);
  const second=await handleViewOnceOpen(req(),deps);
  assertEquals(second.status,409);
  assertEquals((await second.json()).status,"already_viewed");
  assertEquals(calls.claims,2);
});
Deno.test("Cloudinary failure never consumes view-once claim",async()=>{
  const {deps,calls}=setup({cloudStatus:503});
  const res=await handleViewOnceOpen(req(),deps);
  assertEquals(res.status,502);
  assertEquals(calls.claims,0);
});
Deno.test("disabled backend returns 503 with no external I/O",async()=>{
  const {deps,calls}=setup();
  Deno.env.set("CHAT_PRIVATE_MEDIA_ENABLED","false");
  try {
    const res=await handleViewOnceOpen(req(),deps);
    assertEquals(res.status,503);
    assertEquals(calls,{check:0,claims:0,download:0});
  }finally{Deno.env.set("CHAT_PRIVATE_MEDIA_ENABLED","true");}
});
