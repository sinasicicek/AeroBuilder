/**
 * Local STL archive (IndexedDB).
 *
 * Why IndexedDB: a full STL set is 5–30 MB — far past the ~5 MB localStorage cap.
 * Two stores are used so the gallery can list metadata without loading blobs:
 *   - `sets`  : ArchiveSummary (no STL bytes) — cheap to read for the gallery
 *   - `blobs` : { id, files: Record<path, Uint8Array> } — loaded only on demand
 *
 * The ZIP is NOT stored: `files` holds exactly what goes inside it and the archive
 * re-packs with fflate on download. One copy on disk, byte-identical output to the
 * live exporter (both go through `buildStlFiles`).
 *
 * Everything is offline-first: works in the browser and inside the Capacitor APK.
 */
import type { AircraftDimensions, AircraftType, AirfoilSpec, FuselageType, PropellerType, ControlSurfaces, TailType } from './calculations';
import type { PrintSettings } from './printParts';
import type { ComponentSettings } from './components';
import { STORE_SETS, STORE_BLOBS, tx, newId } from './db';

/** Full project snapshot so an archived set can restore the whole design. */
export interface ArchivedProject {
  dimensions: AircraftDimensions;
  unit: 'cm' | 'mm';
  aircraftType: AircraftType;
  airfoil: AirfoilSpec;
  fuselageStyle: FuselageType;
  tailType: TailType;
  propeller: PropellerType;
  controls: ControlSurfaces;
  printSettings: PrintSettings;
  components: ComponentSettings;
  propCutout: boolean;
}

export interface ArchiveMeta {
  kind: 'full' | 'kit';
  aircraftType: AircraftType;
  tailType: TailType;
  airfoil: AirfoilSpec;
  /** printable parts (README and assembled preview excluded) */
  parts: number;
  /** total bytes of all files, STL + README */
  bytes: number;
  bed: { x: number; y: number; z: number };
  warnings: number;
  notFit: number;
  /** Design-library model this set was exported from (optional link). */
  modelId?: string;
  modelName?: string;
}

export interface ArchiveSummary {
  id: string;
  name: string;
  createdAt: number;
  meta: ArchiveMeta;
  project: ArchivedProject;
  /** small PNG dataURL rendered from the assembled STL (may be absent) */
  thumb?: string;
}

export interface ArchiveFiles {
  id: string;
  files: Record<string, Uint8Array>;
}

export interface SaveInput {
  name: string;
  files: Record<string, Uint8Array>;
  meta: ArchiveMeta;
  project: ArchivedProject;
  /** assembled STL path inside `files`, used for the thumbnail */
  previewPath?: string;
}

/* ----------------------------------------------------------------- thumbnail */

/**
 * Renders the assembled STL to a small transparent PNG (best effort).
 * A throwaway WebGL context is created and disposed immediately; any failure
 * (headless, no WebGL, huge model) just means "no thumbnail".
 */
export async function makeThumbnail(assembledStl: Uint8Array, width = 320, height = 200): Promise<string | undefined> {
  try {
    const THREE = await import('three');
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    const ab = assembledStl.buffer.slice(assembledStl.byteOffset, assembledStl.byteOffset + assembledStl.byteLength) as ArrayBuffer;
    const geo = new STLLoader().parse(ab);
    geo.computeVertexNormals();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.15, roughness: 0.65, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    const sphere = geo.boundingSphere ?? (geo.computeBoundingSphere(), geo.boundingSphere!);
    const r = Math.max(sphere.radius, 1);
    const cam = new THREE.PerspectiveCamera(35, width / height, r / 100, r * 100);
    // Three-quarter view, slightly above
    cam.position.set(r * 1.7, r * 1.2, r * 1.9);
    cam.lookAt(sphere.center);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(r, r * 2, r * 1.5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-r, -r * 0.5, -r);
    scene.add(fill);

    renderer.render(scene, cam);
    const url = canvas.toDataURL('image/png');

    geo.dispose();
    mat.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
    return url;
  } catch (e) {
    console.warn('STL thumbnail skipped', e);
    return undefined;
  }
}

/* ----------------------------------------------------------------- public API */

export async function saveSet(input: SaveInput): Promise<ArchiveSummary> {
  const id = newId();
  const bytes = Object.values(input.files).reduce((n, f) => n + f.byteLength, 0);
  const thumb = input.previewPath && input.files[input.previewPath]
    ? await makeThumbnail(input.files[input.previewPath])
    : undefined;

  const summary: ArchiveSummary = {
    id,
    name: input.name.trim() || defaultName(input.meta),
    createdAt: Date.now(),
    meta: { ...input.meta, bytes },
    project: input.project,
    thumb,
  };
  const payload: ArchiveFiles = { id, files: input.files };

  await tx(STORE_BLOBS, 'readwrite', s => s.put(payload));
  await tx(STORE_SETS, 'readwrite', s => s.put(summary));
  return summary;
}

export async function listSets(): Promise<ArchiveSummary[]> {
  const all = await tx<ArchiveSummary[]>(STORE_SETS, 'readonly', s => s.getAll() as IDBRequest<ArchiveSummary[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getFiles(id: string): Promise<Record<string, Uint8Array> | null> {
  const rec = await tx<ArchiveFiles | undefined>(STORE_BLOBS, 'readonly', s => s.get(id) as IDBRequest<ArchiveFiles | undefined>);
  return rec?.files ?? null;
}

export async function renameSet(id: string, name: string): Promise<void> {
  const rec = await tx<ArchiveSummary | undefined>(STORE_SETS, 'readonly', s => s.get(id) as IDBRequest<ArchiveSummary | undefined>);
  if (!rec) return;
  rec.name = name.trim() || rec.name;
  await tx(STORE_SETS, 'readwrite', s => s.put(rec));
}

export async function deleteSet(id: string): Promise<void> {
  await tx(STORE_BLOBS, 'readwrite', s => s.delete(id));
  await tx(STORE_SETS, 'readwrite', s => s.delete(id));
}

export async function clearArchive(): Promise<void> {
  await tx(STORE_BLOBS, 'readwrite', s => s.clear());
  await tx(STORE_SETS, 'readwrite', s => s.clear());
}

/** Usage in bytes, plus the browser's quota when available. */
export async function storageInfo(): Promise<{ used: number; quota: number | null }> {
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { used: e.usage ?? 0, quota: e.quota ?? null };
    }
  } catch { /* ignore */ }
  return { used: 0, quota: null };
}

/** Ask the browser not to evict the archive under storage pressure. */
export async function requestPersist(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}

/* ------------------------------------------------------------------- helpers */

export function defaultName(meta: Pick<ArchiveMeta, 'aircraftType' | 'kind'>): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const type = meta.aircraftType === 'flying_wing' ? 'Flying wing' : 'Conventional';
  return `${type} ${meta.kind === 'kit' ? 'kit' : 'STL'} — ${stamp}`;
}


/** Printable parts only (assembled preview and README excluded). */
export function stlEntries(files: Record<string, Uint8Array>): { path: string; name: string; bytes: Uint8Array }[] {
  return Object.entries(files)
    .filter(([p]) => p.toLowerCase().endsWith('.stl'))
    .filter(([p]) => !/(^|\/)(00_|00_assembled_preview|00_montado_preview)/.test(p))
    .map(([path, bytes]) => ({ path, name: path.split('/').pop()!.replace(/\.stl$/i, ''), bytes }));
}

/** The assembled preview STL, if the set has one. */
export function previewEntry(files: Record<string, Uint8Array>): { path: string; bytes: Uint8Array } | null {
  const hit = Object.entries(files).find(([p]) => /(^|\/)00_/.test(p) || /assembled|montado/i.test(p));
  return hit ? { path: hit[0], bytes: hit[1] } : null;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
