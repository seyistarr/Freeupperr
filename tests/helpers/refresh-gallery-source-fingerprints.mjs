// Refresh only the approved source-file fingerprints. Never decode Git blobs:
// text-mode subprocess output would normalize CRLF and invalidate byte equality.
// Component-renderer snapshots and cache pins require their own explicit review.
import {readFile, writeFile, rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const fixture=new URL('../fixtures/gallery-main-baseline.json',import.meta.url);
const approved=JSON.parse(await readFile(fixture,'utf8'));
if(!/^[a-f0-9]{40}$/.test(approved.base))throw Error('An exact approved base SHA is required');
for(const path of Object.keys(approved.files)){
 const bytes=execFileSync('git',['show',`${approved.base}:${path}`],{cwd:root});
 approved.files[path]=createHash('sha256').update(bytes).digest('hex');
}
const temporary=new URL('../fixtures/gallery-main-baseline.json.tmp',import.meta.url);
await writeFile(temporary,JSON.stringify(approved,null,2)+'\n');
await rename(temporary,fixture);
console.log('Updated approved source fingerprints from raw Git blob bytes.');
