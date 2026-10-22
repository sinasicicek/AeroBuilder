/**
 * Shared IndexedDB handle for everything the app stores locally:
 *   - `sets`   STL archive metadata (stlArchive.ts)
 *   - `blobs`  STL files per archived set (stlArchive.ts)
 *   - `models` design library: named projects incl. manual fuselage stations (modelLibrary.ts)
 *
 * One database, one version — two modules opening the same DB with different
 * versions would throw VersionError, so the opener lives here only.
 */
const DB_NAME = 'aerobuilder_archive';
const DB_VERSION = 2;

export const STORE_SETS = 'sets';
export const STORE_BLOBS = 'blobs';
export const STORE_MODELS = 'models';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SETS)) db.createObjectStore(STORE_SETS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_MODELS)) db.createObjectStore(STORE_MODELS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  // A failed open must not poison every later attempt
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

export function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  }));
}

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Bytes → human readable (shared by both dialogs). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
