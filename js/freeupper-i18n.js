import { createTranslationService, detectLocale, locales } from './i18n-core.js';
import i18next from './vendor/i18next.js';
import {dynamicUI} from './i18n-ui.js';
const service = createTranslationService(i18next, async code => {
  const response = await fetch(`/locales/${code}.json`);
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw Error('Translation resource unavailable');
  return response.json();
});
let storage;
try { storage = localStorage.getItem('freeupper_lang'); } catch {}
const original = new WeakMap();
function markDynamicUI() {
  for (const [id, spec] of Object.entries(dynamicUI)) {
    const node = document.getElementById(id);
    if (!node) continue;
    const attribute = spec.attribute;
    const value = attribute ? node.getAttribute(attribute) : node.textContent;
    if ((Array.isArray(spec) ? spec : spec.keys).includes(value)) {
      node.dataset.i18n = value;
      if (attribute) node.dataset.i18nAttr = attribute;
      original.delete(node);
    }
  }
}
function translate(root = document) {
  const counted = [...(root.matches?.('[data-i18n-count]') ? [root] : []), ...root.querySelectorAll('[data-i18n-count]')];
  for (const node of counted) {
    const count = Math.max(0, Number(node.dataset.i18nCount) || 0);
    const text = service.t('commentsCount', {count, countText:service.number(count)});
    if (node.textContent !== text) node.textContent = text;
  }
  const nodes = [...(root.matches?.('[data-i18n]') ? [root] : []), ...root.querySelectorAll('[data-i18n]')];
  for (const node of nodes) {
    // Mark only product UI. Never add this attribute to user content containers.
    if (node.closest('[data-no-i18n], [contenteditable="true"]')) continue;
    let source = original.get(node);
    const attribute = node.dataset.i18nAttr;
    const current = attribute ? node.getAttribute(attribute) : node.textContent;
    // A renderer may replace an initial UI placeholder with a username, caption,
    // or other content. Stop managing that node when its value changes externally.
    if (source && current !== source.last) {
      node.removeAttribute('data-i18n');
      original.delete(node);
      continue;
    }
    if (!source) {
      if (current?.trim() !== node.dataset.i18n.trim()) { node.removeAttribute('data-i18n'); continue; }
      source = {key:node.dataset.i18n,last:current};
    }
    const text = service.t(source.key);
    if (attribute && ['placeholder','aria-label','title','alt'].includes(attribute)) {
      if (current !== text) node.setAttribute(attribute,text);
    } else if (!node.children.length && current !== text) node.textContent = text;
    source.last = attribute ? node.getAttribute(attribute) : node.textContent;
    original.set(node,source);
  }
}
async function changeLanguage(code, persist = true) {
  const selected = await service.changeLanguage(code);
  if (!selected) return;
  if (persist) { try { localStorage.setItem('freeupper_lang', selected); } catch {} }
  document.documentElement.lang = selected === 'en' ? 'en-GB' : selected;
  document.documentElement.dir = selected === 'ar' ? 'rtl' : 'ltr';
  markDynamicUI();
  translate();
  document.dispatchEvent(new CustomEvent('languageChanged', {detail:{language:selected}}));
  return selected;
}
const ready = changeLanguage(detectLocale(storage, navigator.languages || [navigator.language]), false);
window.FreeUpperI18n = Object.freeze({t:service.t, commentsCount(count) { return service.t('commentsCount', {count, countText:service.number(count)}); }, changeLanguage, ready, translate, locales, get language(){return service.language;}, number:service.number, date:service.date, plural:service.plural});
ready.catch(() => { document.documentElement.lang = 'en-GB'; document.documentElement.dir = 'ltr'; });
const observer = new MutationObserver(records => {
  markDynamicUI();
  for (const record of records) {
    if (record.type === 'characterData') { if (record.target.parentElement?.matches('[data-i18n]')) translate(record.target.parentElement); }
    else { if (record.target.matches?.('[data-i18n], [data-i18n-count]')) translate(record.target); for (const node of record.addedNodes) if (node.nodeType === 1) translate(node); }
  }
});
observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
window.addEventListener('storage', event => { if (event.key === 'freeupper_lang') changeLanguage(detectLocale(event.newValue,navigator.languages),false).catch(()=>{}); });
