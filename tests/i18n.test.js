import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import i18next from 'i18next';
import {locales,resolveLocale,detectLocale,createTranslationService} from '../js/i18n-core.js';
const load = async code => JSON.parse(await readFile(`locales/${code}.json`,'utf8'));
test('26 supported resource identifiers, valid meaningful dictionaries and placeholders',async()=>{
 assert.equal(locales.length,26);assert.equal(new Set(locales).size,26);
 const english=await load('en');
 for (const code of locales) {
  const dict=await load(code);
  assert.ok(Object.keys(dict).length>=60,code);
  for (const [key,value] of Object.entries(dict)) {
   assert.equal(typeof value,'string');assert.ok(value.trim(),`${code}:${key}`);
   assert.ok(key in english || /^commentsCount_(zero|two|few|many)$/.test(key),`${code}: unknown key ${key}`);
   const variables = value.match(/{{\w+}}/g)||[];
   for (const v of variables) assert.ok((english[key]||english.commentsCount_other||'').includes(v),`${code}:${key}:${v}`);
  }
  if (!code.startsWith('en')) assert.ok(Object.entries(dict).filter(([k,v])=>k!==v).length>20,code);
 }
});
test('browser detection, legacy identifiers, saved preferences and safe path allowlist',()=>{
 assert.equal(detectLocale('fr',['de-DE']),'fr');assert.equal(detectLocale(null,['xx','ar-SA']),'ar');
 assert.equal(detectLocale('invalid',['en-US']),'en-US');assert.equal(resolveLocale('en-GB'),'en');
 assert.equal(resolveLocale('pt_BR'),'pt');assert.equal(resolveLocale('../../private'),null);
 assert.equal(detectLocale(null,['xx']),'en');
});
test('lazy resource loading, switching, English fallback, Intl and plurals',async()=>{
 const calls=[];const s=createTranslationService(i18next,async code=>{calls.push(code);return load(code);});
 await s.changeLanguage('fr');assert.deepEqual(calls,['en','fr']);assert.equal(s.t('Home'),'Accueil');
 await s.changeLanguage('ar');assert.equal(s.t('Home'),'الرئيسية');assert.equal(s.t('commentsCount',{count:2,countText:s.number(2)}),'تعليقان');
 await s.changeLanguage('fr');assert.deepEqual(calls,['en','fr','ar']);
 const fallback=createTranslationService(i18next,async code=>{const d=await load(code);if(code==='fr')delete d.Home;return d;});await fallback.changeLanguage('fr');assert.equal(fallback.t('Home'),'Home');
 assert.equal(s.t('unknown key'),'unknown key');assert.equal(typeof s.number(1234),'string');assert.equal(typeof s.date(new Date('2026-01-01Z')),'string');
});
test('failed dictionaries can retry without changing the current language',async()=>{
 let fail=true;const s=createTranslationService(i18next,code=>{if(code==='de'&&fail)throw Error('offline');return load(code);});
 await s.changeLanguage('fr');await assert.rejects(s.changeLanguage('de'));assert.equal(s.language,'fr');fail=false;await s.changeLanguage('de');assert.equal(s.language,'de');
});
test('PWA precaches English and lazily caches public dictionaries; Cloudflare publishes resources',async()=>{
 const sw=await readFile('service-worker.js','utf8');assert.ok(sw.includes('./locales/en.json'));assert.ok(!sw.includes('./locales/ak.json'));assert.ok(sw.includes('cache.put(event.request, responseClone)'));
 const build=await readFile('cloudflare/build.mjs','utf8');assert.ok(build.includes("'locales'"));
 const app=await readFile('js/freeupper-i18n.js','utf8');assert.ok(!app.includes('innerHTML'));assert.ok(app.includes("selected === 'ar' ? 'rtl' : 'ltr'"));
});
test('vendored engine matches the exactly pinned installed dependency',async()=>{
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 assert.equal(pkg.dependencies.i18next,'25.6.0');
 assert.equal(await readFile('js/vendor/i18next.js','utf8'),await readFile('node_modules/i18next/dist/esm/i18next.js','utf8'));
});
