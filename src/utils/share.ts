/**
 * Shareable project links: the whole design is compressed into the URL hash
 * (#p=...), so a link reopens exactly the same aircraft on any device.
 */
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

const toB64Url = (u8: Uint8Array) => {
  let s = '';
  u8.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const u8 = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
  return u8;
};

export function encodeProject(state: unknown): string {
  return toB64Url(deflateSync(strToU8(JSON.stringify({ v: 1, s: state })), { level: 9 }));
}

export function decodeProject<T>(code: string): T | null {
  try {
    const obj = JSON.parse(strFromU8(inflateSync(fromB64Url(code))));
    return obj && obj.v === 1 ? (obj.s as T) : null;
  } catch {
    return null;
  }
}

/** Reads a project from the current URL (#p=...), if any. */
export function projectFromUrl<T>(): T | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.hash.match(/[#&]p=([A-Za-z0-9_-]+)/);
  return m ? decodeProject<T>(m[1]) : null;
}

export function shareUrl(state: unknown): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#p=${encodeProject(state)}`;
}
