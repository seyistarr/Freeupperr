import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
export async function prepareCacheRelease(directory) {
  const worker = new URL('service-worker.js', directory);
  let source = await readFile(worker, 'utf8');
  const seeds = [...source.match(/const URLS_TO_CACHE = \[([\s\S]*?)\];/)[1]
    .matchAll(/'\.\/([^']*)'/g)].map(match => '/' + match[1].split('?')[0]);
  const paths = new Set(seeds.filter(path => path !== '/'));
  for (const name of await readdir(directory)) {
    if (/\.(html|js|css)$/.test(name) && !/^(?:service-worker|firebase-messaging-sw)\.js$/.test(name)) paths.add('/' + name);
  }
  for (const name of await readdir(new URL('js/', directory), {recursive: true})) {
    if (/\.(js|css)$/.test(name)) paths.add('/js/' + name);
  }
  const precache = [...paths].sort();
  for (const name of await readdir(new URL('locales/', directory))) {
    if (/^[A-Za-z0-9_-]+\.json$/.test(name)) paths.add('/locales/' + name);
  }
  const integrity = {};
  for (const path of [...paths].sort()) integrity[path] = createHash('sha256').update(await readFile(new URL('.' + path, directory))).digest('hex');
  const firebase = await readFile(new URL('firebase-messaging-sw.js', directory), 'utf8');
  const release = createHash('sha256').update(JSON.stringify(integrity)).update(source).update(firebase).digest('hex').slice(0, 20);
  source = source.replace(/const CACHE_NAME = '[^']+'/, `const CACHE_NAME = 'freeupper-pwa-${release}'`)
    .replace(/const RELEASE_INTEGRITY = null;/, `const RELEASE_INTEGRITY = ${JSON.stringify(integrity)};`)
    .replace(/const URLS_TO_CACHE = \[[\s\S]*?\];/, `const URLS_TO_CACHE = ${JSON.stringify(precache)};`);
  const routes = await readFile(new URL('js/freeupper-routes.js', directory), 'utf8');
  source = source.replace("importScripts('/js/freeupper-routes.js?v=clean-urls-v1');", routes);
  await writeFile(worker, source);
  await writeFile(new URL('cache-release.json', directory), JSON.stringify({release, precache, integrity}, null, 2) + '\n');
  return {release, count: paths.size, precacheCount: precache.length};
}
