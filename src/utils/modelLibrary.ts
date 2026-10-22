/**
 * Design library ("Modellerim").
 *
 * A model is just a named snapshot of the whole project — including manually
 * edited fuselage stations (`dimensions.fuseStations`). Loading a model simply
 * feeds that snapshot back into App state; geometry is never recomputed here,
 * so the golden rule (one geometry source: computeLayout) still holds.
 *
 * Store: IndexedDB `models`, same database as the STL archive (see db.ts).
 * Records are tiny (5–15 KB JSON), so hundreds of models are fine.
 */
import type { AirfoilSpec } from './calculations';
import type { Layout } from './geometry';
import type { ArchivedProject } from './stlArchive';
import { STORE_MODELS, tx, newId, formatBytes } from './db';
import type { BufferGeometry } from 'three';

export type ModelSnapshot = ArchivedProject;

export interface ModelVersion {
  at: number;
  snapshot: ModelSnapshot;
}

export interface ModelRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  snapshot: ModelSnapshot;
  /** small PNG dataURL (best effort) */
  thumb?: string;
  /** previous snapshots, newest first, capped at HISTORY_LIMIT */
  history: ModelVersion[];
}

export const HISTORY_LIMIT = 5;
const ACTIVE_KEY = 'aerobuilder_model_id';

/* ------------------------------------------------------------------ storage */

export async function listModels(): Promise<ModelRecord[]> {
  const all = await tx<ModelRecord[]>(STORE_MODELS, 'readonly', s => s.getAll() as IDBRequest<ModelRecord[]>);
  return all
    .map(m => ({ ...m, history: Array.isArray(m.history) ? m.history : [] }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getModel(id: string): Promise<ModelRecord | null> {
  const rec = await tx<ModelRecord | undefined>(STORE_MODELS, 'readonly', s => s.get(id) as IDBRequest<ModelRecord | undefined>);
  if (!rec) return null;
  return { ...rec, history: Array.isArray(rec.history) ? rec.history : [] };
}

/**
 * Creates a model, or overwrites an existing one. Overwriting pushes the previous
 * snapshot into `history` (max 5) so a bad edit can always be rolled back.
 */
export async function saveModel(input: {
  id?: string | null;
  name: string;
  snapshot: ModelSnapshot;
  thumb?: string;
}): Promise<ModelRecord> {
  const now = Date.now();
  const name = input.name.trim() || 'Model';

  if (input.id) {
    const prev = await getModel(input.id);
    if (prev) {
      const history = [{ at: prev.updatedAt, snapshot: prev.snapshot }, ...prev.history].slice(0, HISTORY_LIMIT);
      const rec: ModelRecord = {
        ...prev,
        name,
        updatedAt: now,
        snapshot: input.snapshot,
        thumb: input.thumb ?? prev.thumb,
        history,
      };
      await tx(STORE_MODELS, 'readwrite', s => s.put(rec));
      return rec;
    }
  }

  const rec: ModelRecord = {
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    snapshot: input.snapshot,
    thumb: input.thumb,
    history: [],
  };
  await tx(STORE_MODELS, 'readwrite', s => s.put(rec));
  return rec;
}

export async function renameModel(id: string, name: string): Promise<void> {
  const rec = await getModel(id);
  if (!rec) return;
  rec.name = name.trim() || rec.name;
  await tx(STORE_MODELS, 'readwrite', s => s.put(rec));
}

export async function deleteModel(id: string): Promise<void> {
  await tx(STORE_MODELS, 'readwrite', s => s.delete(id));
  if (getActiveModelId() === id) setActiveModelId(null);
}

export async function duplicateModel(id: string, name: string): Promise<ModelRecord | null> {
  const src = await getModel(id);
  if (!src) return null;
  const now = Date.now();
  const rec: ModelRecord = {
    id: newId(),
    name: name.trim() || `${src.name} (2)`,
    createdAt: now,
    updatedAt: now,
    snapshot: src.snapshot,
    thumb: src.thumb,
    history: [],
  };
  await tx(STORE_MODELS, 'readwrite', s => s.put(rec));
  return rec;
}

/** Rolls a model back to one of its stored versions (current state becomes history). */
export async function restoreVersion(id: string, at: number): Promise<ModelRecord | null> {
  const rec = await getModel(id);
  if (!rec) return null;
  const v = rec.history.find(h => h.at === at);
  if (!v) return rec;
  const history = [{ at: rec.updatedAt, snapshot: rec.snapshot }, ...rec.history.filter(h => h.at !== at)].slice(0, HISTORY_LIMIT);
  const next: ModelRecord = { ...rec, updatedAt: Date.now(), snapshot: v.snapshot, history };
  await tx(STORE_MODELS, 'readwrite', s => s.put(next));
  return next;
}

/** Suggests "Name (2)", "Name (3)"… based on the names already taken. */
export function uniqueName(base: string, taken: string[]): string {
  const clean = base.replace(/\s*\(\d+\)$/, '').trim() || 'Model';
  if (!taken.includes(clean)) return clean;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${clean} (${i})`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${clean} (${Date.now() % 1000})`;
}

/* ------------------------------------------------------- active model (local) */

export function getActiveModelId(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

export function setActiveModelId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* ignore */ }
}

/* -------------------------------------------------------------- JSON in/out */

interface ModelFile {
  app: 'aerobuilder';
  kind: 'model';
  version: 1;
  name: string;
  savedAt: number;
  snapshot: ModelSnapshot;
}

export function modelToJson(rec: ModelRecord): string {
  const payload: ModelFile = {
    app: 'aerobuilder',
    kind: 'model',
    version: 1,
    name: rec.name,
    savedAt: Date.now(),
    snapshot: rec.snapshot,
  };
  return JSON.stringify(payload, null, 2);
}

/** Accepts our own export format and a bare snapshot (defensive). */
export function parseModelJson(text: string): { name: string; snapshot: ModelSnapshot } | null {
  try {
    const o = JSON.parse(text);
    const snapshot: ModelSnapshot | undefined = o?.snapshot ?? (o?.dimensions ? o : undefined);
    if (!snapshot?.dimensions || !snapshot.aircraftType) return null;
    return { name: typeof o?.name === 'string' ? o.name : 'Imported model', snapshot };
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- thumbnail */

/**
 * Renders the aircraft (same parts as Scene3D) to a small transparent PNG.
 * Best effort: any WebGL failure just means the gallery shows a box icon.
 */
export async function makeModelThumbnail(L: Layout, airfoil: AirfoilSpec, width = 320, height = 200): Promise<string | undefined> {
  let disposeParts: (() => void) | null = null;
  try {
    const THREE = await import('three');
    const { buildAircraftParts } = await import('./mesh');
    const parts = buildAircraftParts(L, airfoil);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.15, roughness: 0.65, flatShading: true, side: THREE.DoubleSide });
    const group = new THREE.Group();
    const box = new THREE.Box3();

    const add = (geo: BufferGeometry, mirrored: boolean) => {
      const g = mirrored ? geo.clone() : geo;
      if (mirrored) g.scale(-1, 1, 1);
      g.computeBoundingBox();
      if (g.boundingBox) box.union(g.boundingBox);
      group.add(new THREE.Mesh(g, mat));
    };
    parts.center.forEach(p => add(p.geometry, false));
    parts.right.forEach(p => { add(p.geometry, false); add(p.geometry, true); });

    scene.add(group);
    disposeParts = () => {
      group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      mat.dispose();
    };

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1);
    const cam = new THREE.PerspectiveCamera(35, width / height, r / 100, r * 100);
    cam.up.set(0, 1, 0);
    cam.position.set(sphere.center.x + r * 1.6, sphere.center.y + r * 1.1, sphere.center.z + r * 1.7);
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
    disposeParts();
    renderer.dispose();
    renderer.forceContextLoss?.();
    return url;
  } catch (e) {
    console.warn('Model thumbnail skipped', e);
    disposeParts?.();
    return undefined;
  }
}

/* ----------------------------------------------------------------- helpers */

export const modelSizeText = (rec: ModelRecord): string => formatBytes(modelToJson(rec).length);
