/**
 * Cookie consent for Google Analytics (LGPD). The choice lives in this
 * browser only; gtag.js is loaded by index.html only after "granted".
 */
export type Consent = 'granted' | 'denied' | null;

const KEY = 'aerobuilder_consent';
const KEY_AT = 'aerobuilder_consent_at';

declare global {
  interface Window { __abLoadAnalytics?: () => void; __abGaLoaded?: boolean }
}

export function getConsent(): Consent {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch { return null; }
}

export function consentDate(): string | null {
  try { return localStorage.getItem(KEY_AT); } catch { return null; }
}

/** Deletes the Google Analytics cookies (_ga, _ga_<ID>) on this host and its parent domains. */
function clearGaCookies() {
  const names = document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(n => n === '_ga' || n.startsWith('_ga_') || n === '_gid');
  const parts = location.hostname.split('.');
  const domains = ['', ...parts.map((_, i) => '.' + parts.slice(i).join('.'))];
  names.forEach(n => domains.forEach(d => {
    document.cookie = `${n}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`;
  }));
}

export function setConsent(v: 'granted' | 'denied') {
  const wasLoaded = !!window.__abGaLoaded;
  try {
    localStorage.setItem(KEY, v);
    localStorage.setItem(KEY_AT, new Date().toISOString());
  } catch { /* storage blocked: the choice lasts for this page only */ }
  if (v === 'granted') {
    window.__abLoadAnalytics?.();
  } else {
    clearGaCookies();
    // gtag.js cannot be unloaded: reload so nothing more is sent on this visit
    if (wasLoaded) location.reload();
  }
}
