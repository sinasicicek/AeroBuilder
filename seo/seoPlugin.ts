/**
 * Build-time SEO for a single-page app in seven languages.
 *
 * The app is one SPA, but search engines and link previews need one URL per
 * language with its own <title>, description, Open Graph tags, hreflang links
 * and some crawlable text. This plugin:
 *  - fills the SEO block of index.html (the root page = x-default, English text)
 *  - writes dist/{pt,en,es,fr,it,zh,hi}/index.html, each fully localised
 *  - writes dist/sitemap.xml (with hreflang alternates) and dist/robots.txt
 * The visible text sits inside #root, so it doubles as the loading screen and
 * React replaces it as soon as the app starts.
 */
import type { Plugin } from 'vite';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

interface LangSeo {
  html: string; og: string; title: string; description: string; keywords: string;
  ogTitle: string; ogDescription: string; h1: string; intro: string; features: string[]; loading: string;
}
interface SeoConfig { site: string; default: string; langs: Record<string, LangSeo> }

const seo: SeoConfig = JSON.parse(readFileSync(new URL('./seo.json', import.meta.url), 'utf8'));
const LANGS = Object.keys(seo.langs);
/** hreflang codes: language only (all regions), Simplified Chinese by script. */
const HREFLANG: Record<string, string> = { pt: 'pt', tr: 'tr', en: 'en', es: 'es', fr: 'fr', zh: 'zh-Hans', it: 'it', hi: 'hi' };
const NAMES: Record<string, string> = { pt: 'Português', tr: 'Türkçe', en: 'English', es: 'Español', fr: 'Français', zh: '中文', it: 'Italiano', hi: 'हिन्दी' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const urlOf = (lang: string | null) => `${seo.site}/${lang ? `${lang}/` : ''}`;

function head(lang: string | null): string {
  const L = seo.langs[lang ?? seo.default];
  const self = urlOf(lang);
  const img = `${seo.site}/og/og-${lang ?? seo.default}.png`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'AeroBuilder',
    url: self,
    description: L.description,
    inLanguage: lang ? L.html : LANGS.map(l => seo.langs[l].html),
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Any (web browser)',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    image: img,
    author: { '@type': 'Person', name: 'Álvaro Severo Marcus', url: 'https://www.linkedin.com/in/alvaromarcus/' },
    sameAs: ['https://github.com/Alvaromarcus/Airplane_model'],
  };
  return [
    `<title>${esc(L.title)}</title>`,
    `<meta name="description" content="${esc(L.description)}" />`,
    `<meta name="keywords" content="${esc(L.keywords)}" />`,
    `<link rel="canonical" href="${self}" />`,
    ...LANGS.map(l => `<link rel="alternate" hreflang="${HREFLANG[l]}" href="${urlOf(l)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${urlOf(null)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="AeroBuilder" />`,
    `<meta property="og:title" content="${esc(L.ogTitle)}" />`,
    `<meta property="og:description" content="${esc(L.ogDescription)}" />`,
    `<meta property="og:url" content="${self}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(L.ogTitle)}" />`,
    `<meta property="og:locale" content="${L.og}" />`,
    ...LANGS.filter(l => l !== (lang ?? seo.default)).map(l => `<meta property="og:locale:alternate" content="${seo.langs[l].og}" />`),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(L.ogTitle)}" />`,
    `<meta name="twitter:description" content="${esc(L.ogDescription)}" />`,
    `<meta name="twitter:image" content="${img}" />`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
  ].map(s => `    ${s}`).join('\n');
}

/** Crawlable text that is also the loading screen (React replaces it). */
function body(lang: string | null): string {
  const L = seo.langs[lang ?? seo.default];
  const links = LANGS.map(l => `<a href="/${l}/" hreflang="${HREFLANG[l]}" lang="${seo.langs[l].html}" style="color:#0369a1;margin:0 .4rem">${NAMES[l]}</a>`).join('');
  return `<main style="max-width:44rem;margin:12vh auto 0;padding:0 1.25rem;font-family:Inter,system-ui,sans-serif;color:#334155;line-height:1.55">
        <h1 style="font-size:1.6rem;color:#0f172a;margin:0 0 .5rem">${esc(L.h1)}</h1>
        <p style="margin:0 0 1rem">${esc(L.intro)}</p>
        <ul style="margin:0 0 1.25rem;padding-left:1.2rem">${L.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <p style="color:#0284c7;font-weight:600">${esc(L.loading)}</p>
        <nav style="margin-top:2rem;font-size:.85rem">${links}</nav>
      </main>`;
}

function render(html: string, lang: string | null): string {
  const L = seo.langs[lang ?? seo.default];
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${lang ? L.html : 'en'}"`)
    .replace(/<!--seo:head-->[\s\S]*?<!--\/seo:head-->/, `<!--seo:head-->\n${head(lang)}\n    <!--/seo:head-->`)
    .replace(/<!--seo:body-->[\s\S]*?<!--\/seo:body-->/, `<!--seo:body-->${body(lang)}<!--/seo:body-->`);
}

export default function seoPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'aerobuilder-seo',
    configResolved(c) { outDir = c.build.outDir; },
    transformIndexHtml: { order: 'post', handler: (html: string) => render(html, null) },
    closeBundle() {
      const built = readFileSync(`${outDir}/index.html`, 'utf8');
      LANGS.forEach(l => {
        mkdirSync(`${outDir}/${l}`, { recursive: true });
        writeFileSync(`${outDir}/${l}/index.html`, render(built, l));
      });
      const today = new Date().toISOString().slice(0, 10);
      const alts = [...LANGS.map(l => `    <xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${urlOf(l)}"/>`), `    <xhtml:link rel="alternate" hreflang="x-default" href="${urlOf(null)}"/>`].join('\n');
      const urls = [null, ...LANGS].map(l => `  <url>\n    <loc>${urlOf(l)}</loc>\n    <lastmod>${today}</lastmod>\n${alts}\n  </url>`).join('\n');
      writeFileSync(`${outDir}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
      writeFileSync(`${outDir}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${seo.site}/sitemap.xml\n`);
    },
  };
}

