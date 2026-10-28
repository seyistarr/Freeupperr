// Framework-neutral service: no DOM, account data, or network translation APIs.
export const locales = Object.freeze(['en','en-US','fr','es','de','ar','hi','pt','zh','ja','ko','ru','yo','ha','ig','pcm','sw','zu','xh','af','am','so','sn','rw','lg','ak']);
export function resolveLocale(value) {
  if (typeof value !== 'string') return null;
  const tag = value.replaceAll('_','-').toLowerCase();
  if (tag === 'en-us') return 'en-US';
  const base = tag.split('-')[0];
  return locales.includes(base) ? base : null;
}
export function detectLocale(saved, languages = []) {
  return resolveLocale(saved) || languages.map(resolveLocale).find(Boolean) || 'en';
}
export function createTranslationService(engine, load) {
  const instance = engine.createInstance();
  const pending = new Map();
  let language = 'en';
  let sequence = 0;
  async function resource(code) {
    if (!pending.has(code)) pending.set(code, Promise.resolve().then(() => load(code)).then(data => {
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some(v => typeof v !== 'string')) throw Error('Invalid translation resource');
      instance.addResourceBundle(code, 'translation', data, true, true);
    }).catch(error => { pending.delete(code); throw error; }));
    return pending.get(code);
  }
  const ready = instance.init({ lng:'en', fallbackLng:'en', supportedLngs:locales, resources:{}, keySeparator:false, nsSeparator:false, interpolation:{escapeValue:false}, returnNull:false });
  return {
    get language() { return language; },
    async changeLanguage(value) {
      const ticket = ++sequence;
      const code = resolveLocale(value) || 'en';
      await ready;
      await resource('en');
      await resource(code);
      if (ticket !== sequence) return null;
      await instance.changeLanguage(code);
      language = code;
      return code;
    },
    t(key, values) { return instance.t(key, values); },
    number(value, options) { return new Intl.NumberFormat(language === 'en' ? 'en-GB' : language, options).format(value); },
    date(value, options) { return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, options).format(value); },
    plural(value) { return new Intl.PluralRules(language).select(value); }
  };
}
