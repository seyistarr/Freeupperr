// Resolve extracted production assets for legacy tests that intentionally inspect a
// complete page or strip scripts before injecting an isolated backend fixture.
import {readFile as nativeReadFile} from 'node:fs/promises';
import {readFileSync as nativeReadFileSync} from 'node:fs';
function expand(value){
 if(typeof value!=='string'||!value.includes('src="video-shell.js?v=gallery-v1"'))return value;
 const base=new URL('../../',import.meta.url);
 const shell=nativeReadFileSync(new URL('video-shell.js',base),'utf8');
 const markup=JSON.parse(shell.slice(shell.indexOf('"'),shell.indexOf(');\n')));
 return value.replace('<script src="video-shell.js?v=gallery-v1"></script>',markup)
 .replace('<link rel="stylesheet" href="video-player.css?v=gallery-v1">','<style>'+nativeReadFileSync(new URL('video-player.css',base),'utf8')+'</style>')
 .replace('<script src="video-player.js?v=gallery-v1"></script>','<script>'+nativeReadFileSync(new URL('video-player.js',base),'utf8')+'</script>');
}
export async function readFile(...args){return expand(await nativeReadFile(...args));}
export function readFileSync(...args){return expand(nativeReadFileSync(...args));}
