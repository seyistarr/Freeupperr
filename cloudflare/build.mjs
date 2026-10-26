import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const output = new URL('./generated/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(new URL('public/', output), { recursive: true });
// Publish only tracked browser assets; never the repository, API source or env files.
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
const files = tracked.filter(p => !p.includes('/') && /\.(html|js|css|png|ico|svg|webmanifest)$/.test(p));
files.push('robots.txt', 'sitemap.xml');
for (const path of files) await cp(path, new URL('public/' + path, output));
// Worker-only restrictions: retain main's lock and prevent the shared backend
// readiness flags from enabling restricted publishing on this preview origin.
const createFile = new URL('public/create.html', output);
let create = await readFile(createFile, 'utf8');
const gate = '            lock();\n            try {';
if (!create.includes(gate)) throw Error('Audience availability gate changed');
create = create.replace(gate, '            lock();\n            return; // Restricted audiences stay disabled on workers.dev.\n            try {');
await writeFile(createFile, create);
const composerFile = new URL('public/privacy-v2-composer.js', output);
let composer = await readFile(composerFile, 'utf8');
composer = composer.replace('    const video = Array.isArray(media)', "    throw new Error('Restricted publishing is unavailable on this preview');\n    const video = Array.isArray(media)");
await writeFile(composerFile, composer);
const swFile = new URL('public/service-worker.js', output);
let sw = await readFile(swFile, 'utf8');
sw = sw.replace("const CACHE_NAME = 'freeupper-pwa-v5'", "const CACHE_NAME = 'freeupper-pwa-v5-cloudflare-v1'");
sw = sw.replace("  if (event.request.headers.has('Authorization')) return;", "  if (/^\\/(?:u|p|v)(?:\\/|$)/.test(url.pathname) || url.pathname.startsWith('/@') || url.pathname === '/sitemap-profiles.xml') return;\n  if (event.request.headers.has('Authorization')) return;");
sw = sw.replace('          cache.put(event.request, responseClone);', "          if (!/no-store|private/.test(response.headers.get('Cache-Control') || '')) return cache.put(event.request, responseClone);");
await writeFile(swFile, sw);
for (const dir of ['assets', 'themes']) await cp(dir, new URL('public/' + dir, output), { recursive: true });
await writeFile(new URL('public/_headers', output), `/manifest.webmanifest\n  Content-Type: application/manifest+json\n  Cache-Control: public, max-age=0, must-revalidate\n/service-worker.js\n  Cache-Control: no-cache\n  Service-Worker-Allowed: /\n/firebase-messaging-sw.js\n  Cache-Control: no-cache\n  Service-Worker-Allowed: /\n/*\n  X-Content-Type-Options: nosniff\n`);
// This is the existing browser-public anon key, never a service-role credential.
const auth = await readFile('auth.js', 'utf8');
const anon = auth.match(/const SUPABASE_ANON_KEY = '([^']+)'/)?.[1];
if (!anon || JSON.parse(Buffer.from(anon.split('.')[1], 'base64url')).role !== 'anon') throw Error('Expected browser anon key');
await writeFile(new URL('public-key.js', output), `export default ${JSON.stringify(anon)};\n`);
await mkdir(new URL('api/', output));
const publicHandlers = ['post-preview', 'post-text-og', 'post-short-link', 'profile-preview', 'profile-og', 'profile-seo-privacy', 'sitemap-profiles'];
for (const name of publicHandlers) {
  let source = await readFile(`api/${name}.js`, 'utf8');
  source = source.replaceAll("requestHost.endsWith('.vercel.app')", "(requestHost.endsWith('.vercel.app') || requestHost === 'freeupper-web.oluwaseyistarr.workers.dev' || requestHost === 'localhost')");
  source = source.replaceAll("from '@vercel/og'", "from '../og.js'");
  source = source.replaceAll('process.env.SUPABASE_ANON_KEY', '(env.SUPABASE_ANON_KEY || publicKey)');
  await writeFile(new URL(`api/${name}.js`, output), `import { env } from 'cloudflare:workers';\nimport publicKey from '../public-key.js';\n${source}`);
}
// @vercel/og's edge build needs statically imported WASM and a bundled font on
// Workers. Validate each upstream substitution so dependency changes fail safely.
const vendor = new URL('../node_modules/@vercel/og/dist/', import.meta.url);
let og = await readFile(new URL('index.edge.js', vendor), 'utf8');
function replaceOnce(pattern, replacement) {
  if (!pattern.test(og)) throw Error('Unsupported @vercel/og edge bundle');
  og = og.replace(pattern, replacement);
}
const yoga = og.match(/H = "data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)"/);
if (!yoga) throw Error('Missing Yoga WASM');
await writeFile(new URL('yoga.wasm', output), Buffer.from(yoga[1], 'base64'));
replaceOnce(/H = "data:application\/octet-stream;base64,[A-Za-z0-9+/=]+"/, 'H = "bundled-yoga.wasm"');
replaceOnce(/return WebAssembly\.instantiate\(f, d2\);/, 'return WebAssembly.instantiate(yogaModule, d2).then(instance => ({instance}));');
// Skip fetching the embedded Yoga byte buffer: the precompiled module is used.
replaceOnce(/return ya\(\)\.then\(function\(f\) \{/, 'return Promise.resolve().then(function(f) {');
replaceOnce(/import resvg_wasm from "\.\/resvg.wasm\?module";/, 'import resvg_wasm from "./resvg.wasm";');
replaceOnce(/var fallbackFont = fetch\(\s*new URL\("\.\/noto-sans-v27-latin-regular.ttf", import.meta.url\)\s*\)\.then\(\(res\) => res.arrayBuffer\(\)\);/, 'var fallbackFont = Promise.resolve(fontData);');
await writeFile(new URL('og.js', output), `import yogaModule from './yoga.wasm';\nimport fontData from './font.ttf';\n${og}`);
await cp(new URL('resvg.wasm', vendor), new URL('resvg.wasm', output));
await cp(new URL('noto-sans-v27-latin-regular.ttf', vendor), new URL('font.ttf', output));
console.log(`Prepared ${files.length} root browser assets and public API handlers`);
