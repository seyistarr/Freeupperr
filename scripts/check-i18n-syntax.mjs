import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
// Compile inline classic scripts as browsers do; this catches accidental changes
// to quoted templates without executing app/auth/backend operations.
let checked=0;
for(const name of (await readdir('.')).filter(n=>n.endsWith('.html'))){
 const source=await readFile(name,'utf8');
 for(const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if (/\btype=["'](?:module|application\/ld\+json)/i.test(match[1]) || !match[2].trim()) continue;
  new vm.Script(match[2],{filename:name});checked++;
 }
}
console.log(`Compiled ${checked} inline scripts`);
