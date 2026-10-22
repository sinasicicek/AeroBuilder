import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import pt from './locales/pt';
import es from './locales/es';
import fr from './locales/fr';
import zh from './locales/zh';
import it from './locales/it';
import hi from './locales/hi';
import tr from './locales/tr';
import seo from '../seo/seo.json';

export const LANGUAGES = [
  { code: 'pt', label: 'Português', html: 'pt-BR' },
  { code: 'tr', label: 'Türkçe', html: 'tr-TR' },
  { code: 'en', label: 'English', html: 'en-US' },
  { code: 'es', label: 'Español', html: 'es' },
  { code: 'fr', label: 'Français', html: 'fr' },
  { code: 'it', label: 'Italiano', html: 'it' },
  { code: 'zh', label: '中文', html: 'zh-CN' },
  { code: 'hi', label: 'हिन्दी', html: 'hi' },
] as const;
export type LangCode = (typeof LANGUAGES)[number]['code'];

const resources = {
  en: { translation: en },
  pt: { translation: pt },
  es: { translation: es },
  fr: { translation: fr },
  zh: { translation: zh },
  it: { translation: it },
  hi: { translation: hi },
  tr: { translation: tr },
};

const isLang = (v: string | null | undefined): v is LangCode => !!v && LANGUAGES.some(l => l.code === v);

/** Language in the URL path (/pt/, /en/, /es/, /fr/, /it/, /zh/, /hi/), if any. */
function langFromPath(): LangCode | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/^\/([a-z]{2})(\/|$)/);
  return m && isLang(m[1]) ? m[1] : null;
}

/** URL path first, then the saved choice, then the browser language (pt-BR → pt, zh-TW → zh…), else English. */
function detectLanguage(): LangCode {
  const fromPath = langFromPath();
  if (fromPath) return fromPath;
  try {
    const saved = localStorage.getItem('aerobuilder_lang');
    if (isLang(saved)) return saved;
  } catch { /* storage unavailable */ }
  const nav = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const n of nav) {
    const code = n?.toLowerCase().slice(0, 2);
    if (isLang(code)) return code;
  }
  return 'en';
}

/** <html lang>, page title and description for a language (same texts as the per-language pages). */
function applyDocumentLanguage(code: LangCode) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = LANGUAGES.find(l => l.code === code)!.html;
  const page = (seo.langs as Record<string, { title: string; description: string }>)[code];
  if (page) {
    document.title = page.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', page.description);
  }
}

/**
 * Applies a language: i18next, document texts, the saved preference and the
 * URL (/xx/), so a copied or shared link opens in the same language.
 */
export function setLanguage(code: LangCode) {
  i18n.changeLanguage(code);
  applyDocumentLanguage(code);
  try { localStorage.setItem('aerobuilder_lang', code); } catch { /* ignore */ }
  if (typeof window !== 'undefined') {
    const rest = window.location.pathname.replace(/^\/[a-z]{2}(\/|$)/, '/').replace(/^\/+/, '');
    const path = `/${code}/${rest}`;
    if (path !== window.location.pathname) history.replaceState(history.state, '', path + window.location.search + window.location.hash);
  }
}

/** Current language as one of the supported codes. */
export function currentLang(): LangCode {
  const c = (i18n.resolvedLanguage ?? i18n.language ?? 'en').slice(0, 2);
  return isLang(c) ? c : 'en';
}

const initialLang = detectLanguage();
// On a language page (/xx/) the static HTML already matches; on the root page
// (x-default) the visitor's language replaces the default English texts.
if (!langFromPath()) applyDocumentLanguage(initialLang);

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLang,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
