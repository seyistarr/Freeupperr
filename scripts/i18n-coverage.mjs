// Rebuild the honest coverage inventory; English fallbacks are not translations.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {locales} from '../js/i18n-core.js';
const english=JSON.parse(await readFile('locales/en.json','utf8'));
const dictionaries = {};
const report={status:'partial',nativeReview:'Required for every non-English dictionary, including counted-message grammar.',englishKeys:Object.keys(english).length,languages:{},pages:{}};
for(const code of locales){
 const dictionary=JSON.parse(await readFile(`locales/${code}.json`,'utf8'));
 dictionaries[code]=dictionary;
 const missing=Object.keys(english).filter(key=>!(key in dictionary));
 report.languages[code]={resourceKeys:Object.keys(dictionary).length,missingKeys:missing.length,missing};
}
for(const path of (await readdir('.')).filter(p=>p.endsWith('.html'))){
 const text=await readFile(path,'utf8');
 const decode=s=>s.replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&#39;',"'");
 const keys=[...new Set([...text.matchAll(/data-i18n=(?:"([^"]*)"|([^\s>]+))/g)].map(m=>decode(m[1]||m[2])).filter(k=>k in english))];
 report.pages[path]={staticAndTemplateMarkers:(text.match(/data-i18n=/g)||[]).length,uniqueCatalogKeys:keys.length,serviceIncluded:text.includes('/js/freeupper-i18n.js'),coverageByLanguage:Object.fromEntries(locales.map(code=>[code,{present:keys.filter(k=>k in dictionaries[code]).length,total:keys.length}]))};
}
await writeFile('locales/coverage.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({englishKeys:report.englishKeys,languages:Object.fromEntries(Object.entries(report.languages).map(([k,v])=>[k,{resourceKeys:v.resourceKeys,missingKeys:v.missingKeys}]))}));
