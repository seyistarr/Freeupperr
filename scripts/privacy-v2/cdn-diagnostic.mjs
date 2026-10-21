#!/usr/bin/env node
// Diagnostic exact GETs only. Never submits observations or calls Cloudinary Admin.
import {readFile,writeFile} from 'node:fs/promises';
import {validateManifest,digest} from './revocation-runner.mjs';
const manifest=validateManifest(JSON.parse(await readFile(new URL('./revocation-fixtures.json',import.meta.url),'utf8'))),checks=[];
for(const job of manifest.jobs)for(const [index,url] of job.urls.entries()){
 const response=await fetch(url,{redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(20000)}),bytes=Buffer.from(await response.arrayBuffer());
 checks.push({job:job.id,index,url,checked_at:new Date().toISOString(),status:response.status,bytes:bytes.length,sha256:digest(bytes),
  headers:Object.fromEntries([...response.headers].filter(([key])=>/^(age|cache-control|date|etag|last-modified|server|via|x-cache|x-cld-error|server-timing|content-type)$/.test(key))),qualifying:false});
}
await writeFile(process.argv[2],JSON.stringify({diagnostic_only:true,qualifying:false,checks},null,2)+'\n');
console.log(JSON.stringify(checks.map(({index,status,job})=>({job,index,status}))));
