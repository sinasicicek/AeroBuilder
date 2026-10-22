import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { X, FolderOpen, Eye, EyeOff, Box, Grid3x3, Move3d, RotateCcw, Maximize2, Layers, Boxes, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { arrangeOnPlates } from '../utils/plateLayout';

/** One STL document shown in the viewer (archive part, assembled preview or a local file). */
export interface ViewerFile {
  id: string;
  /** display name without extension */
  name: string;
  bytes: Uint8Array;
  /** folder path inside the archive set, e.g. "02_wing/wing_R_01.stl" */
  path?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  files: ViewerFile[];
  /** optional heading shown next to the title (e.g. the archive entry name) */
  subtitle?: string;
}

const PALETTE = [0x38bdf8, 0xf472b6, 0x34d399, 0xfbbf24, 0xa78bfa, 0xfb7185, 0x60a5fa, 0xfacc15];

type Kind = 'assembly' | 'plate' | 'part';
type Mode = 'assembly' | 'plate' | 'parts';

/** Files exported by AeroBuilder carry their role in the folder name. */
function kindOf(f: ViewerFile): Kind {
  const p = f.path ?? f.name;
  if (/00_assembled|assembled|montado/i.test(p)) return 'assembly';
  if (/00_plate_layout|plate_all/i.test(p)) return 'plate';
  return 'part';
}

// Loader is imported once, on first open (keeps STLLoader out of the main chunk)
let stlParse: (b: Uint8Array) => THREE.BufferGeometry = () => {
  throw new Error('STLLoader not loaded');
};

function useStlLoader() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    import('three/examples/jsm/loaders/STLLoader.js').then(({ STLLoader }) => {
      if (cancelled) return;
      stlParse = (b: Uint8Array) => {
        const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        return new STLLoader().parse(ab);
      };
      setReady(true);
    }).catch(() => { /* stays not-ready; the empty state explains */ });
    return () => { cancelled = true; };
  }, []);
  return ready;
}

/** Points the camera at the current bounds whenever the model changes. */
function Rig({ box, resetKey }: { box: THREE.Box3; resetKey: number }) {
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;

  useEffect(() => {
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1);
    const cam = camera as THREE.PerspectiveCamera;
    // The camera object is owned by three.js; mutating it here is the intended API.
    /* eslint-disable react-hooks/immutability */
    cam.up.set(0, 0, 1);
    cam.position.set(sphere.center.x + r * 1.5, sphere.center.y + r * 1.25, sphere.center.z + r * 1.7);
    cam.near = Math.max(r / 200, 0.05);
    cam.far = r * 200;
    cam.updateProjectionMatrix();
    cam.lookAt(sphere.center);
    /* eslint-enable react-hooks/immutability */
    if (controls) { controls.target.copy(sphere.center); controls.update(); }
  }, [box, resetKey, camera, controls]);

  return null;
}

function Part({
  geo, color, wireframe, edges, visible, position,
}: { geo: THREE.BufferGeometry; color: number; wireframe: boolean; edges: boolean; visible: boolean; position: [number, number, number] }) {
  const edgeGeo = useMemo(() => (edges ? new THREE.EdgesGeometry(geo, 25) : null), [geo, edges]);
  useEffect(() => () => edgeGeo?.dispose(), [edgeGeo]);

  if (!visible) return null;
  return (
    <group position={position}>
      <mesh geometry={geo}>
        <meshStandardMaterial
          color={color}
          metalness={0.15}
          roughness={0.62}
          flatShading
          wireframe={wireframe}
          side={THREE.DoubleSide}
        />
      </mesh>
      {edgeGeo && (
        <lineSegments geometry={edgeGeo}>
          <lineBasicMaterial color={0x0f172a} transparent opacity={0.45} />
        </lineSegments>
      )}
    </group>
  );
}

export default function StlViewer({ open, onClose, files, subtitle }: Props) {
  const { t } = useTranslation();
  const loaderReady = useStlLoader();
  // The parent remounts this component (unique key) for every new payload, so the
  // initial state below IS the reset — no setState-in-effect needed.
  const [items, setItems] = useState<ViewerFile[]>(files);
  const [mode, setMode] = useState<Mode>(() => {
    const kinds = files.map(kindOf);
    if (kinds.includes('plate')) return 'plate';
    if (kinds.length === 1 && kinds[0] === 'assembly') return 'assembly';
    return 'parts';
  });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [soloId, setSoloId] = useState<string | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [edges, setEdges] = useState(true);
  const [grid, setGrid] = useState(true);
  const [axes, setAxes] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const parsed = useMemo(() => {
    return items.map((f, i) => {
      let geo: THREE.BufferGeometry | null = null;
      try {
        if (loaderReady) { geo = stlParse(f.bytes); geo.computeBoundingBox(); }
      } catch (e) {
        console.warn('STL parse failed', f.name, e);
      }
      return { ...f, geo, color: PALETTE[i % PALETTE.length], kind: kindOf(f) };
    });
  }, [items, loaderReady]);

  // Dispose geometries when they are replaced or the viewer closes
  useEffect(() => () => { parsed.forEach(p => p.geo?.dispose()); }, [parsed]);

  const hasAssembly = parsed.some(p => p.kind === 'assembly' && p.geo);
  const hasPlate = parsed.some(p => p.kind === 'plate' && p.geo);
  const partCount = parsed.filter(p => p.kind === 'part' && p.geo).length;

  /** Files shown by the active mode, before the eye toggles. */
  const modeFiles = useMemo(() => {
    const parts = parsed.filter(p => p.kind === 'part' && p.geo);
    const assembly = parsed.filter(p => p.kind === 'assembly' && p.geo);
    const plate = parsed.find(p => p.kind === 'plate' && p.geo);
    if (mode === 'assembly') return assembly.length ? assembly : parts;
    if (mode === 'plate') return plate ? [plate] : parts;
    return parts.length ? parts : (plate ? [plate] : assembly);
  }, [parsed, mode]);

  /** True when the files are still centred on the same bed spot and need packing. */
  const needsPacking = !(mode === 'plate' && hasPlate) && mode !== 'assembly';

  const display = useMemo(() => {
    const list = modeFiles.filter(p => (soloId ? p.id === soloId : !hidden.has(p.id)));
    if (!list.length) return [] as { item: typeof list[number]; offset: [number, number, number] }[];

    if (!needsPacking || list.length === 1) {
      return list.map(item => ({ item, offset: [0, 0, 0] as [number, number, number] }));
    }

    const sizes = list.map(p => {
      const bb = p.geo!.boundingBox!;
      const s = bb.getSize(new THREE.Vector3());
      return { w: s.x, h: s.y };
    });
    const totalArea = sizes.reduce((a, s) => a + Math.max(s.w, 0.1) * Math.max(s.h, 0.1), 0);
    const maxW = Math.max(...sizes.map(s => s.w));
    // Virtual bed: roomy enough that everything goes side by side
    const bed = Math.max(maxW, Math.sqrt(totalArea * 1.8), 50);
    const arr = arrangeOnPlates(sizes, bed, bed, Math.max(bed * 0.01, 1), Math.max(bed * 0.01, 1));

    return list.map((item, i) => {
      const bb = item.geo!.boundingBox!;
      const at = arr.placements[i];
      return { item, offset: [at.x - bb.min.x, at.y - bb.min.y, 0] as [number, number, number] };
    });
  }, [modeFiles, hidden, soloId, needsPacking]);

  const box = useMemo(() => {
    const b = new THREE.Box3();
    const tmp = new THREE.Box3();
    display.forEach(({ item, offset }) => {
      if (!item.geo?.boundingBox) return;
      tmp.copy(item.geo.boundingBox).translate(new THREE.Vector3(...offset));
      b.union(tmp);
    });
    return b;
  }, [display]);

  const size = useMemo(() => (box.isEmpty() ? null : box.getSize(new THREE.Vector3())), [box]);
  const tris = useMemo(
    () => display.reduce((n, { item }) => n + (item.geo ? (item.geo.getIndex()?.count ?? item.geo.attributes.position.count) / 3 : 0), 0),
    [display],
  );

  const addLocalFiles = useCallback(async (list: FileList | File[]) => {
    const picked = Array.from(list).filter(f => /\.stl$/i.test(f.name));
    if (!picked.length) return;
    setBusy(true);
    try {
      const loaded: ViewerFile[] = [];
      for (const f of picked) {
        const buf = new Uint8Array(await f.arrayBuffer());
        loaded.push({ id: `${f.name}-${Date.now()}-${loaded.length}`, name: f.name.replace(/\.stl$/i, ''), bytes: buf });
      }
      setItems(prev => [...loaded, ...prev]);
      setMode('parts');
      setError(null);
      setResetKey(k => k + 1);
    } catch (e) {
      console.warn('STL read failed', e);
      setError(t('viewer_error'));
    }
    setBusy(false);
  }, [t]);

  if (!open) return null;

  const toggleHidden = (id: string) => {
    setSoloId(null);
    setHidden(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${active
      ? 'bg-sky-600 border-sky-600 text-white'
      : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`;

  const modeBtn = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${active
      ? 'bg-white dark:bg-slate-600 text-sky-700 dark:text-white border-sky-500 shadow-sm'
      : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`;

  const fmt = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));

  const listItems = display.length ? display.map(d => d.item) : modeFiles;

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-2 sm:p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="stl-viewer-title">
      <div
        className="w-full max-w-6xl h-[92vh] flex flex-col rounded-xl overflow-hidden bg-white dark:bg-slate-800 shadow-2xl text-slate-800 dark:text-slate-100"
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); void addLocalFiles(e.dataTransfer.files); }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 p-3 border-b border-slate-200 dark:border-slate-700">
          <h2 id="stl-viewer-title" className="text-base sm:text-lg font-semibold flex items-center gap-2 min-w-0">
            <Box size={20} className="text-sky-600 dark:text-sky-400 shrink-0" />
            <span className="truncate">{t('viewer_title')}</span>
          </h2>
          {subtitle && <span className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400 truncate">· {subtitle}</span>}
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600">
              <FolderOpen size={15} /> <span className="hidden sm:inline">{t('viewer_open_file')}</span>
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700" aria-label={t('archive_close')}><X size={20} /></button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".stl,model/stl,application/sla"
            multiple
            className="hidden"
            onChange={e => { if (e.target.files) void addLocalFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {/* View mode: assembly / build plate / individual parts */}
        {(hasAssembly || hasPlate || partCount > 1) && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
            <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">{t('viewer_mode')}</span>
            {hasAssembly && (
              <button className={modeBtn(mode === 'assembly')} onClick={() => { setMode('assembly'); setSoloId(null); }} aria-pressed={mode === 'assembly'}>
                <Layers size={13} />{t('viewer_assembly')}
              </button>
            )}
            <button className={modeBtn(mode === 'plate')} onClick={() => { setMode('plate'); setSoloId(null); }} aria-pressed={mode === 'plate'}>
              <Boxes size={13} />{t('viewer_plate')}
            </button>
            {partCount > 1 && (
              <button className={modeBtn(mode === 'parts')} onClick={() => { setMode('parts'); setSoloId(null); }} aria-pressed={mode === 'parts'}>
                <List size={13} />{t('viewer_parts_view')} ({partCount})
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 flex flex-col sm:flex-row min-h-0">
          {/* File list */}
          <aside className="sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r border-slate-200 dark:border-slate-700 flex flex-col max-h-32 sm:max-h-none">
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>{t('viewer_parts')} ({modeFiles.length})</span>
              {soloId && (
                <button onClick={() => setSoloId(null)} className="text-sky-600 dark:text-sky-400 normal-case font-medium">{t('viewer_show_all')}</button>
              )}
            </div>
            <ul className="flex-1 overflow-y-auto text-xs divide-y divide-slate-100 dark:divide-slate-700/60">
              {listItems.map(p => {
                const isHidden = soloId ? p.id !== soloId : hidden.has(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-1.5 px-2 py-1.5">
                    <button
                      onClick={() => toggleHidden(p.id)}
                      className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white"
                      aria-label={p.name}
                      title={isHidden ? t('viewer_show_all') : t('viewer_only')}
                    >
                      {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${isHidden ? 'opacity-30' : ''}`} style={{ background: `#${p.color.toString(16).padStart(6, '0')}` }} />
                    <button
                      onClick={() => setSoloId(p.id)}
                      className={`flex-1 text-left truncate ${isHidden ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'}`}
                      title={p.path ?? p.name}
                    >
                      {p.name}
                    </button>
                    {!p.geo && <span className="text-[10px] text-red-500">!</span>}
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Canvas */}
          <div className="relative flex-1 min-h-0 bg-slate-50 dark:bg-slate-900">
            {parsed.length === 0 || !loaderReady ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                <Box size={36} className="opacity-40" />
                <p>{loaderReady ? t('viewer_empty') : t('viewer_loading')}</p>
                <button onClick={() => fileRef.current?.click()} className="mt-1 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium">
                  {t('viewer_open_file')}
                </button>
              </div>
            ) : (
              <Canvas
                dpr={[1, 2]}
                camera={{ position: [200, 160, 220], fov: 35, up: [0, 0, 1] }}
                gl={{ antialias: true }}
                onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}
              >
                <ambientLight intensity={1.2} />
                <directionalLight position={[1, 2, 1.5]} intensity={2.2} />
                <directionalLight position={[-1, -0.6, -1]} intensity={0.8} />
                <Rig box={box} resetKey={resetKey} />
                <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
                {display.map(({ item, offset }) => (
                  <Part
                    key={item.id}
                    geo={item.geo!}
                    color={item.color}
                    wireframe={wireframe}
                    edges={edges}
                    visible
                    position={offset}
                  />
                ))}
                {grid && size && (
                  <gridHelper
                    args={[Math.max(size.x, size.y) * 2.2, 24, 0x94a3b8, 0xcbd5e1]}
                    rotation={[Math.PI / 2, 0, 0]}
                    position={[box.getCenter(new THREE.Vector3()).x, box.getCenter(new THREE.Vector3()).y, box.min.z]}
                  />
                )}
                {axes && size && <axesHelper args={[Math.max(size.x, size.y, size.z) * 0.8]} position={[box.min.x, box.min.y, box.min.z]} />}
              </Canvas>
            )}

            {/* Toolbar */}
            <div className="absolute top-2 left-2 right-2 flex flex-wrap gap-1.5 pointer-events-none">
              <div className="flex flex-wrap gap-1.5 pointer-events-auto">
                <button className={chip(wireframe)} onClick={() => setWireframe(v => !v)}><Box size={13} />{t('viewer_wireframe')}</button>
                <button className={chip(edges)} onClick={() => setEdges(v => !v)}><Maximize2 size={13} />{t('viewer_edges')}</button>
                <button className={chip(grid)} onClick={() => setGrid(v => !v)}><Grid3x3 size={13} />{t('viewer_grid')}</button>
                <button className={chip(axes)} onClick={() => setAxes(v => !v)}><Move3d size={13} />{t('viewer_axes')}</button>
                <button className={chip(false)} onClick={() => setResetKey(k => k + 1)}><RotateCcw size={13} />{t('viewer_reset')}</button>
              </div>
            </div>

            {/* Info */}
            {size && (
              <div className="absolute bottom-2 left-2 right-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-slate-800/80 backdrop-blur px-2 py-1 rounded-lg w-fit">
                <span>{t('viewer_size', { x: fmt(size.x), y: fmt(size.y), z: fmt(size.z) })}</span>
                <span className="opacity-60">·</span>
                <span>{t('viewer_triangles', { count: Math.round(tris).toLocaleString() })}</span>
              </div>
            )}

            {drag && (
              <div className="absolute inset-0 flex items-center justify-center bg-sky-600/15 border-2 border-dashed border-sky-500 text-sky-700 dark:text-sky-300 font-semibold text-sm">
                {t('viewer_drop')}
              </div>
            )}
            {busy && (
              <div className="absolute inset-x-0 top-1/2 text-center text-sm text-slate-500">{t('viewer_loading')}</div>
            )}
            {error && (
              <div className="absolute bottom-12 left-2 right-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md px-2 py-1">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
