import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  addStationLocalized, prepareStations, removeStationNear, sanitizeStations,
  stationIndexAt, stationMultipliers, STATION_DY_MAX, STATION_MAX, STATION_MIN,
  type FuseStation,
} from '../utils/fuseStations';
import * as THREE from 'three';
import { Play, Pause } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AirfoilSpec } from '../utils/calculations';
import type { Layout } from '../utils/geometry';
import { buildAircraftParts, disposeParts, type PartMesh } from '../utils/mesh';
import { buildPrintPlan, type PrintSettings, type Pocket, type PrintSection } from '../utils/printParts';
import { COMPONENT_COLORS, ASSEMBLY_COLORS, type BalanceResult } from '../utils/components';
import { buildExtraParts, disposeExtraParts } from '../utils/printables';

interface Scene3DProps {
  layout: Layout;
  airfoil: AirfoilSpec;
  isDarkMode: boolean;
  printSettings: PrintSettings;
  balance: BalanceResult | null;
  pockets: Pocket[];
  /** 0 = assembled, 1 = fully exploded */
  explode: number;
  onExplode: (v: number) => void;
  /** Manual fuselage shape control points (fractions of the length). */
  stations: FuseStation[];
  onStationsChange: (list: FuseStation[]) => void;
  unit: 'cm' | 'mm';
}

type V3 = [number, number, number];

/**
 * Exploded-view offsets (mm). The wing lifts off the fuselage (showing the
 * dowels and the saddle) and its halves separate (showing the joiner); in the
 * print-section view every section also moves away from its neighbour.
 */
function explodeOffsets(L: Layout, e: number) {
  const mm = L.toCm * 10;
  const lift = L.isFW ? 0 : e * Math.max((L.fuselage?.height ?? 0) * mm * 1.3 + 50, 0.14 * L.wing.halfSpan * 2 * mm);
  const gap = e * Math.max(20, 0.06 * L.wing.halfSpan * mm);
  const secGap = e * 18;
  const wing = (side: number): V3 => [side * gap, lift, 0];
  const section = (s: PrintSection): V3 => {
    const i = s.index - 1;
    const sg = s.side === 'R' ? 1 : s.side === 'L' ? -1 : 0;
    switch (s.kind) {
      case 'wing': case 'winglet': return [sg * (gap + i * secGap), lift, 0];
      case 'aileron': return [sg * (gap + i * secGap), lift, -secGap];
      case 'fuselage': return [0, s.name.includes('tail_upper') ? secGap * 2.5 : s.name.includes('tail_lower') ? -secGap * 1.5 : 0, -i * secGap * 1.5];
      case 'hstab': return [sg * i * secGap, 0, 0];
      case 'elevator': return [sg * i * secGap, 0, -secGap];
      case 'fin': return [0, i * secGap + (L.isFW ? 0 : secGap * 4), 0];
      case 'rudder': return [0, i * secGap + (L.isFW ? 0 : secGap * 4), -secGap];
      default: return [0, 0, 0];
    }
  };
  /** Offsets for onboard parts, by id / name. */
  const byId = (id: string): V3 => {
    const side = /_R(_|$)/.test(id) ? 1 : /_L(_|$)/.test(id) ? -1 : 0;
    if (/^(servo_wing|mount_wing|hatch_servo|link_wing|wing_)/.test(id)) return wing(side);
    if (/^(joint_wing_joiner|joint_te_guard)$/.test(id)) return [0, lift, 0];
    return [0, 0, 0];
  };
  return { lift, gap, wing, section, byId, active: e > 0.01 };
}


/** Wing dowels and rubber bands (mm). Bands are hidden in the exploded view. */
function Assembly({ balance, showBands }: { balance: BalanceResult; showBands: boolean }) {
  const asm = balance.assembly;
  const bandGeos = useMemo(() => (asm.bands?.paths ?? []).map(p => {
    const curve = new THREE.CatmullRomCurve3(p.pts.map(([x, y, s]) => new THREE.Vector3(x, y, -s)), false, 'centripetal');
    return { id: p.id, geo: new THREE.TubeGeometry(curve, 48, 1.1, 6, false) };
  }), [asm]);
  useEffect(() => () => bandGeos.forEach(b => b.geo.dispose()), [bandGeos]);
  return (
    <group>
      {asm.dowels.map(d => (
        <mesh key={d.id} position={[0, d.y, -d.s]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[d.d / 2, d.d / 2, d.len, 20]} />
          <meshStandardMaterial color={ASSEMBLY_COLORS.dowel} roughness={0.7} />
        </mesh>
      ))}
      {showBands && bandGeos.map(b => (
        <mesh key={b.id} geometry={b.geo}>
          <meshStandardMaterial color={ASSEMBLY_COLORS.band} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/** Servos, battery, ESC, receiver, ballast and pushrods (positions in mm). */
function Components({ L, balance, airfoil, pockets, explode }: { L: Layout; balance: BalanceResult; airfoil: AirfoilSpec; pockets: Pocket[]; explode: number }) {
  const ex = explodeOffsets(L, explode);
  const k = 1 / (L.toCm * 10); // mm → layout units
  const extras = useMemo(() => buildExtraParts(L, airfoil, balance, pockets), [L, airfoil, balance, pockets]);
  useEffect(() => () => disposeExtraParts(extras), [extras]);
  const sparMeshes = useMemo(() => balance.sparLines.flatMap(sp => {
    const sides = sp.mirror ? [1, -1] : [1];
    return sides.map(sg => {
      const a = new THREE.Vector3(sg * sp.a[0], sp.a[1], -sp.a[2]);
      const b = new THREE.Vector3(sg * sp.b[0], sp.b[1], -sp.b[2]);
      const dir = b.clone().sub(a);
      return {
        key: `${sp.id}_${sg}`, d: sp.d, len: dir.length(), wing: sp.id === 'main' || sp.id === 'rear', sg,
        mid: a.clone().add(b).multiplyScalar(0.5),
        q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
      };
    });
  }), [balance]);
  return (
    <group scale={k}>
      {/* Carbon spars */}
      {sparMeshes.map(m => (
        <mesh key={m.key} position={m.wing ? m.mid.clone().add(new THREE.Vector3(...ex.wing(m.sg))) : m.mid} quaternion={m.q}>
          <cylinderGeometry args={[m.d / 2, m.d / 2, m.len, 16]} />
          <meshStandardMaterial color={COMPONENT_COLORS.spar} roughness={0.35} metalness={0.4} />
        </mesh>
      ))}
      {/* Printed servo mounts and hatches */}
      {extras.map(x => (
        <mesh key={x.name} geometry={x.geometry} position={ex.byId(x.name)}>
          {x.kind === 'mount' || x.name.startsWith('joint_dowel_sleeve')
            ? <meshStandardMaterial color={COMPONENT_COLORS.mount} roughness={0.6} />
            : x.kind === 'joint'
              ? <meshStandardMaterial color={ASSEMBLY_COLORS.joiner} roughness={0.5} />
              : <meshStandardMaterial color={COMPONENT_COLORS.hatch} roughness={0.5} transparent opacity={0.45} depthWrite={false} side={THREE.DoubleSide} />}
        </mesh>
      ))}
      <Assembly balance={balance} showBands={!ex.active} />
      {balance.items.filter(i => i.size || i.kind === 'ballast').map(i => (
        i.kind === 'ballast' ? (
          <mesh key={i.id} position={[i.x, i.y, -i.s]}>
            <sphereGeometry args={[Math.cbrt(i.mass / 11.3 * 3 / (4 * Math.PI)) * 10, 16, 12]} />
            <meshStandardMaterial color={COMPONENT_COLORS.ballast} metalness={0.6} roughness={0.3} />
          </mesh>
        ) : (
          <mesh key={i.id} position={new THREE.Vector3(i.x, i.y, -i.s).add(new THREE.Vector3(...ex.byId(i.id)))}>
            <boxGeometry args={[i.size![0], i.size![1], i.size![2]]} />
            <meshStandardMaterial color={COMPONENT_COLORS[i.kind] ?? '#9ca3af'} roughness={0.5} />
          </mesh>
        )
      ))}
      {balance.linkages.map(l => {
        const lo = new THREE.Vector3(...ex.byId(l.id));
        const a = new THREE.Vector3(l.from[0], l.from[1], -l.from[2]).add(lo);
        const b = new THREE.Vector3(l.to[0], l.to[1], -l.to[2]).add(lo);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const dir = b.clone().sub(a);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        return (
          <group key={l.id}>
            <mesh position={mid} quaternion={q}>
              <cylinderGeometry args={[0.8, 0.8, dir.length(), 8]} />
              <meshStandardMaterial color="#111827" metalness={0.7} roughness={0.3} />
            </mesh>
            {/* control horn */}
            <mesh position={b}>
              <boxGeometry args={[1.5, 10, 6]} />
              <meshStandardMaterial color="#f8fafc" />
            </mesh>
          </group>
        );
      })}
      {/* Tail pushrods: guide tube from the bay wall to the exit, and the holes to drill */}
      {balance.linkExits.map(ex2 => {
        const pts = [ex2.through, ex2.skin].filter((p): p is [number, number, number] => !!p).map(p => new THREE.Vector3(p[0], p[1], -p[2]));
        const tube = pts.length === 2 ? (() => {
          const d = pts[1].clone().sub(pts[0]);
          return { mid: pts[0].clone().add(pts[1]).multiplyScalar(0.5), len: d.length(), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()) };
        })() : null;
        return (
          <group key={ex2.id}>
            {tube && (
              <mesh position={tube.mid} quaternion={tube.q}>
                <cylinderGeometry args={[1.6, 1.6, tube.len, 10]} />
                <meshStandardMaterial color={ASSEMBLY_COLORS.guide} transparent opacity={0.55} depthWrite={false} />
              </mesh>
            )}
            {pts.map((p, i) => (
              <mesh key={i} position={p}>
                <sphereGeometry args={[3, 14, 10]} />
                <meshStandardMaterial color={ASSEMBLY_COLORS.drill} emissive={ASSEMBLY_COLORS.drill} emissiveIntensity={0.35} />
              </mesh>
            ))}
          </group>
        );
      })}
      {/* Target CG ring on the fuselage/wing centreline */}
      <mesh position={[0, L.wing.mountY / k, -balance.cgAchieved]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[Math.max(L.wing.rootChord / k * 0.05, 6), 1.2, 8, 32]} />
        <meshStandardMaterial color={Math.abs(balance.cgAchieved - balance.cgTarget) < 2 ? '#16a34a' : '#dc2626'} />
      </mesh>
    </group>
  );
}

const KIND_OFFSET: Record<string, number> = { wing: 0, aileron: 5, hstab: 2, elevator: 1, fin: 3, rudder: 1, winglet: 6, fuselage: 7 };
const SECTION_COLORS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#eab308', '#ef4444', '#14b8a6', '#ec4899'];

/** Print sections (mm) drawn in their assembled position, alternating colours. */
function PrintSections({ L, airfoil, settings, pockets, explode }: { L: Layout; airfoil: AirfoilSpec; settings: PrintSettings; pockets: Pocket[]; explode: number }) {
  const ex = explodeOffsets(L, explode);
  const plan = useMemo(() => buildPrintPlan(L, airfoil, settings, pockets), [L, airfoil, settings, pockets]);
  useEffect(() => () => plan.sections.forEach(s => s.geometry.dispose()), [plan]);
  const mmToLayout = 1 / (L.toCm * 10);
  return (
    <group scale={mmToLayout}>
      {plan.sections.map((s, i) => (
        <mesh key={s.name} geometry={s.geometry} position={ex.section(s)}>
          {/* Neighbouring sections touch at the cut: alternate a depth offset so
              the shared faces don't z-fight (flicker) on some GPUs */}
          <meshStandardMaterial color={SECTION_COLORS[(s.index + (s.name.endsWith('b') ? 4 : 0) + KIND_OFFSET[s.kind]) % SECTION_COLORS.length]} roughness={0.5} side={THREE.DoubleSide} polygonOffset={i % 2 === 1} polygonOffsetFactor={1} polygonOffsetUnits={1} />
        </mesh>
      ))}
    </group>
  );
}

const COLORS: Record<PartMesh['kind'], string> = {
  wing: '#0284c7',
  aileron: '#f97316',
  hstab: '#db2777',
  elevator: '#f97316',
  fin: '#eab308',
  rudder: '#f97316',
  winglet: '#eab308',
  fuselage: '#6b7280',
};

/** Keeps a WebGL / loader failure from blanking the whole application. */
class SceneErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error('3D view failed', err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const MOVABLE = new Set<PartMesh['kind']>(['aileron', 'elevator', 'rudder']);

function PartMeshes({ parts, mirror, xray, onFuselageDown }: { parts: PartMesh[]; mirror?: boolean; xray?: boolean; onFuselageDown?: (e: ThreeEvent<PointerEvent>) => void }) {
  return (
    <group scale={mirror ? [-1, 1, 1] : [1, 1, 1]}>
      {parts.map((p, i) => (
        // No self-shadowing (it caused shimmering "shadow acne" while rotating);
        // the floor still gets the model's shadow. Transparent (x-ray) parts get
        // a fixed draw order so they don't pop/flicker as the model turns.
        <mesh
          key={p.id}
          geometry={p.geometry}
          castShadow={!xray}
          renderOrder={xray ? 10 + i : 0}
          onPointerDown={p.kind === 'fuselage' && onFuselageDown ? onFuselageDown : undefined}
        >
          <meshStandardMaterial
            color={COLORS[p.kind]}
            roughness={p.kind === 'fuselage' ? 0.55 : 0.4}
            metalness={0.05}
            side={THREE.DoubleSide}
            transparent={xray}
            opacity={xray ? 0.28 : 1}
            depthWrite={!xray}
            polygonOffset={MOVABLE.has(p.kind)}
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Soft light from the viewer's side, so whatever angle you look from (even from below) is lit. */
function HeadLight() {
  const ref = useRef<THREE.DirectionalLight>(null);
  const camera = useThree(st => st.camera);
  useFrame(() => { ref.current?.position.copy(camera.position); });
  return <directionalLight ref={ref} intensity={0.75} />;
}

function Powertrain({ L }: { L: Layout }) {
  const m = L.motor;
  const p = L.prop;
  const y = p.y;
  // All cylinders are built along Y and rotated to lie along Z
  const rot: [number, number, number] = [Math.PI / 2, 0, 0];
  const statorS = m.mountS + m.dir * m.length * 0.35;
  const bellS = m.mountS + m.dir * m.length * 0.75;
  const shaftS = m.mountS + m.dir * m.length * 1.1;
  const R = m.diameter / 2;
  const bladeLen = p.diameter / 2;
  const bladeW = p.diameter * 0.08;
  const bladeT = p.diameter * 0.012;
  return (
    <group>
      {/* Mount plate */}
      <mesh rotation={rot} position={[0, y, -m.mountS]}>
        <cylinderGeometry args={[R * 1.15, R * 1.15, m.length * 0.08, 24]} />
        <meshStandardMaterial color="#2d3748" roughness={0.6} metalness={0.4} />
      </mesh>
      {/* Stator */}
      <mesh rotation={rot} position={[0, y, -statorS]}>
        <cylinderGeometry args={[R * 0.85, R * 0.85, m.length * 0.5, 24]} />
        <meshStandardMaterial color="#374151" roughness={0.5} metalness={0.5} />
      </mesh>
      {/* Bell (rotor can) */}
      <mesh rotation={rot} position={[0, y, -bellS]}>
        <cylinderGeometry args={[R, R, m.length * 0.5, 24]} />
        <meshStandardMaterial color="#9ca3af" roughness={0.25} metalness={0.8} />
      </mesh>
      {/* Shaft */}
      <mesh rotation={rot} position={[0, y, -shaftS]}>
        <cylinderGeometry args={[R * 0.12, R * 0.12, m.length * 0.6, 12]} />
        <meshStandardMaterial color="#d1d5db" roughness={0.15} metalness={0.95} />
      </mesh>
      {/* Propeller: two blades + translucent disc showing the swept area */}
      <group position={[0, y, -p.s]}>
        {[-1, 1].map(side => (
          <mesh key={side} position={[side * bladeLen * 0.5, 0, 0]} rotation={[0, 0, 0]} scale={[bladeLen * 0.5, bladeW / 2, bladeT]}>
            <sphereGeometry args={[1, 16, 8]} />
            <meshStandardMaterial color="#111827" roughness={0.5} />
          </mesh>
        ))}
        <mesh>
          <sphereGeometry args={[R * 0.35, 12, 8]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh rotation={rot}>
          <cylinderGeometry args={[bladeLen, bladeLen, p.diameter * 0.002, 48]} />
          <meshStandardMaterial color="#111827" transparent opacity={0.12} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

function BalanceMarkers({ L }: { L: Layout }) {
  // CG shown as a sphere with a vertical post at the wing root
  const y = L.wing.mountY;
  const r = Math.max(L.wing.rootChord * 0.035, 0.4);
  return (
    <group>
      <mesh position={[0, y + r * 3, -L.cgS]}>
        <sphereGeometry args={[r, 16, 12]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      <mesh position={[0, y + r * 1.5, -L.cgS]}>
        <cylinderGeometry args={[r * 0.15, r * 0.15, r * 3, 8]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      <mesh position={[0, y + r * 3, -L.npS]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[r * 0.9, r * 1.8, 12]} />
        <meshStandardMaterial color="#f97316" />
      </mesh>
    </group>
  );
}

/**
 * Range slider used by the station editor. Kept outside the panel component on
 * purpose: a component defined inside a render gets a new identity every time
 * and remounts the <input>, which drops the drag mid-gesture (very noticeable
 * on touch).
 */
function StationSlider({
  label, value, min, max, step, suffix, sub, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  suffix?: string; sub: string; onChange: (n: number) => void;
}) {
  return (
    <label className="block mb-2">
      <span className={`flex items-center justify-between text-[11px] font-medium ${sub}`}>
        <span>{label}</span>
        <span className="tabular-nums font-semibold">{value.toFixed(2)}{suffix ?? ''}</span>
      </span>
      <input
        type="range"
        className="w-full mt-0.5 h-8 accent-sky-600 touch-pan-y cursor-pointer"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

/**
 * Station editor: the fuselage slice picked in the 3D view. Width / height
 * multipliers and a centre-line shift are applied on top of the style profile,
 * with neutral anchors so a single edit stays local (a global scale would be
 * surprising when you only want a wider shoulder before the tail).
 */
function StationEditor({
  L, frac, stations, onChange, unit, isDarkMode, onClose,
}: {
  L: Layout; frac: number; stations: FuseStation[]; onChange: (l: FuseStation[]) => void;
  unit: 'cm' | 'mm'; isDarkMode: boolean; onClose: () => void;
}) {
  const { t } = useTranslation();
  const fz = L.fuselage!;
  const idx = stationIndexAt(stations, frac);
  const active = idx >= 0 ? stations[idx] : null;
  const cur = stationMultipliers(prepareStations(stations), frac);
  // With no control point yet the sliders start from the interpolated value, so
  // nudging one immediately creates the point at exactly this station.
  const value = active ?? { s: frac, w: cur.w, h: cur.h, dy: cur.dy };

  const apply = (patch: Partial<FuseStation>) => {
    onChange(addStationLocalized(stations, { ...value, ...patch, s: active ? active.s : frac }));
  };

  const sec = fz.section(frac * fz.length);
  const toCm = L.toCm;
  const fmtSize = (v: number) => (unit === 'mm' ? (v * toCm * 10).toFixed(0) : (v * toCm).toFixed(1));

  const card = isDarkMode ? 'bg-slate-900/95 border-slate-700 text-slate-100' : 'bg-white/95 border-slate-200 text-slate-800';
  const sub = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const btn = isDarkMode
    ? 'border-slate-600 text-slate-200 hover:bg-slate-800'
    : 'border-slate-300 text-slate-700 hover:bg-slate-50';

  return (
    <div data-station-panel className={`absolute z-20 border shadow-lg backdrop-blur rounded-t-xl sm:rounded-xl inset-x-0 bottom-0 max-h-[62%] overflow-y-auto sm:max-h-none sm:inset-x-auto sm:right-3 sm:bottom-3 sm:w-72 p-3 ${card}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <div className="text-xs font-semibold">{t('fuse_edit_title')}</div>
          <div className={`text-[11px] ${sub}`}>
            {t('fuse_edit_station')} %{Math.round(frac * 100)} · {fmtSize(sec.w)} × {fmtSize(sec.h)} {unit}
          </div>
        </div>
        <button onClick={onClose} className={`text-xs px-2 py-0.5 rounded border ${btn}`} aria-label="close">✕</button>
      </div>

      <StationSlider label={t('fuse_edit_width')} value={value.w} min={STATION_MIN} max={STATION_MAX} step={0.01} suffix="×" sub={sub} onChange={(n) => apply({ w: n })} />
      <StationSlider label={t('fuse_edit_height')} value={value.h} min={STATION_MIN} max={STATION_MAX} step={0.01} suffix="×" sub={sub} onChange={(n) => apply({ h: n })} />
      <StationSlider label={t('fuse_edit_shift')} value={value.dy ?? 0} min={-STATION_DY_MAX} max={STATION_DY_MAX} step={0.01} sub={sub} onChange={(n) => apply({ dy: n })} />

      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={() => onChange(removeStationNear(stations, active ? active.s : frac))}
          disabled={!active}
          className={`flex-1 text-[11px] py-1.5 rounded border ${btn} disabled:opacity-40`}
        >
          {t('fuse_edit_remove')}
        </button>
        <button
          onClick={() => onChange([])}
          disabled={!stations.length}
          className={`flex-1 text-[11px] py-1.5 rounded border ${btn} disabled:opacity-40`}
        >
          {t('fuse_edit_reset')}
        </button>
      </div>
      <div className={`text-[10px] mt-1.5 ${sub}`}>
        {stations.length} {t('fuse_edit_points')}
      </div>
    </div>
  );
}

/**
 * Highlight ring of the fuselage station picked in the 3D view. Drawn from the
 * same `section()` used by the mesh, STL and 2D drawing, so what you see is
 * exactly the slice that will be printed.
 */
function StationRing({ L, frac, color }: { L: Layout; frac: number; color: string }) {
  const fz = L.fuselage!;
  const geo = useMemo(() => {
    const s = Math.min(Math.max(frac, 0), 1) * fz.length;
    const sec = fz.section(s);
    const n = 72;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const th = Math.PI / 2 + (2 * Math.PI * i) / n;
      const c = Math.cos(th), sn = Math.sin(th);
      const x = (sec.w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / fz.expo);
      const y = sec.yc + (sec.h / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / fz.expo);
      pts.push(new THREE.Vector3(x, y, -s));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [fz, frac]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <lineLoop geometry={geo} renderOrder={20}>
      <lineBasicMaterial color={color} transparent opacity={0.95} depthTest={false} />
    </lineLoop>
  );
}

function Aircraft({
  L, airfoil, isRotating, sections, printSettings, balance, pockets, explode,
  selectedStation, onPickStation, highlight,
}: {
  L: Layout; airfoil: AirfoilSpec; isRotating: boolean; sections: boolean;
  printSettings: PrintSettings; balance: BalanceResult | null; pockets: Pocket[];
  explode: number; selectedStation: number | null;
  onPickStation: (frac: number) => void; highlight: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (groupRef.current && isRotating) groupRef.current.rotation.y += delta * 0.25;
  });

  const parts = useMemo(() => buildAircraftParts(L, airfoil), [L, airfoil]);
  useEffect(() => () => disposeParts(parts), [parts]);
  const isWingPart = (p: PartMesh) => p.kind === 'wing' || p.kind === 'aileron' || p.kind === 'winglet';
  const wingR = parts.right.filter(isWingPart);
  const otherR = parts.right.filter(p => !isWingPart(p));
  const ex = explodeOffsets(L, explode);
  const toL = (v: V3): V3 => v.map(c => c / (L.toCm * 10)) as V3;

  /** Pointer → fuselage station (0 = nose, 1 = tail end). The geometry runs
   *  along −Z in layout units, so the local z gives the station directly. */
  const pickStation = (e: ThreeEvent<PointerEvent>) => {
    const fz = L.fuselage;
    if (!fz) return;
    e.stopPropagation();
    const local = e.object.worldToLocal(e.point.clone());
    const s = Math.min(Math.max(-local.z, 0), fz.length);
    onPickStation(s / fz.length);
  };

  // Centre the model on the origin (stations run along −Z)
  const midS = (L.bounds.sMin + L.bounds.sMax) / 2;
  const midY = (L.bounds.yMin + L.bounds.yMax) / 2;

  return (
    <group ref={groupRef} scale={L.toCm}>
      <group position={[0, -midY, midS]}>
        {sections ? (
          <PrintSections L={L} airfoil={airfoil} settings={printSettings} pockets={pockets} explode={explode} />
        ) : (
          <>
            <group position={toL(ex.wing(1))}><PartMeshes parts={wingR} xray={!!balance} /></group>
            <group position={toL(ex.wing(-1))}><PartMeshes parts={wingR} mirror xray={!!balance} /></group>
            <PartMeshes parts={otherR} xray={!!balance} />
            <PartMeshes parts={otherR} mirror xray={!!balance} />
            <PartMeshes parts={parts.center} xray={!!balance} onFuselageDown={pickStation} />
            {L.fuselage && selectedStation != null && (
              <StationRing L={L} frac={selectedStation} color={highlight} />
            )}
          </>
        )}
        {balance && <Components L={L} balance={balance} airfoil={airfoil} pockets={pockets} explode={explode} />}
        <Powertrain L={L} />
        <BalanceMarkers L={L} />
      </group>
    </group>
  );
}

export default function Scene3D({ layout, airfoil, isDarkMode, printSettings, balance, pockets, explode, onExplode, stations, onStationsChange, unit }: Scene3DProps) {
  const { t } = useTranslation();
  const [isRotating, setIsRotating] = useState(true);
  const [showSections, setShowSections] = useState(false);
  const [showComponents, setShowComponents] = useState(true);
  /** Picked station as a fraction of the fuselage length (null = none). */
  const [picked, setPicked] = useState<number | null>(null);

  // Everything is rendered in centimetres
  const b = layout.bounds;
  const sizeCm = Math.max(b.xMax * 2, b.sMax - b.sMin, 10) * layout.toCm;
  const dist = sizeCm * 1.15;
  const floorY = -((b.yMax - b.yMin) / 2) * layout.toCm - sizeCm * 0.08;

  const fallback = (
    <div className="w-full h-full flex items-center justify-center p-6 text-center text-sm text-slate-500 dark:text-slate-400">
      {t('scene_error')}
    </div>
  );

  return (
    <div className="w-full h-full absolute inset-0 bg-gradient-to-b from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
      <SceneErrorBoundary fallback={fallback}>
        <Canvas
          key={layout.isFW ? 'fw' : 'conv'}
          camera={{ position: [dist * 0.75, dist * 0.45, dist * 0.8], fov: 38, near: 0.5, far: sizeCm * 20 }}
          shadows
          dpr={[1, 2]}
        >
          {/* Sky + a light ground bounce, so the underside isn't dark */}
          <hemisphereLight args={[isDarkMode ? '#cbd5e1' : '#ffffff', isDarkMode ? '#64748b' : '#cbd5e1', 0.85]} />
          <directionalLight
            position={[sizeCm, sizeCm * 1.5, sizeCm * 0.8]}
            intensity={1.3}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0005}
            shadow-normalBias={0.02}
            shadow-camera-left={-sizeCm}
            shadow-camera-right={sizeCm}
            shadow-camera-top={sizeCm}
            shadow-camera-bottom={-sizeCm}
            shadow-camera-near={1}
            shadow-camera-far={sizeCm * 5}
          />
          <directionalLight position={[-sizeCm, sizeCm * 0.3, -sizeCm]} intensity={0.3} />
          {/* Fill from below */}
          <directionalLight position={[0, -sizeCm * 1.5, sizeCm * 0.3]} intensity={0.45} />
          <HeadLight />
          <Aircraft
            L={layout}
            airfoil={airfoil}
            isRotating={isRotating && picked == null}
            sections={showSections}
            printSettings={printSettings}
            balance={showComponents && !showSections ? balance : null}
            pockets={pockets}
            explode={explode}
            selectedStation={picked}
            onPickStation={(f) => { setIsRotating(false); setPicked(f); }}
            highlight={isDarkMode ? '#38bdf8' : '#0284c7'}
          />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY, 0]} receiveShadow>
            <circleGeometry args={[sizeCm * 0.9, 64]} />
            <meshStandardMaterial color={isDarkMode ? '#1f2937' : '#e2e8f0'} transparent opacity={0.6} />
          </mesh>
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
        </Canvas>
      </SceneErrorBoundary>

      {/* Fuselage station editor (3D only, conventional layouts) */}
      {layout.fuselage && !showSections && picked != null && (
        <StationEditor
          L={layout}
          frac={picked}
          stations={sanitizeStations(stations)}
          onChange={onStationsChange}
          unit={unit}
          isDarkMode={isDarkMode}
          onClose={() => setPicked(null)}
        />
      )}
      {layout.fuselage && !showSections && picked == null && (
        <div className="absolute bottom-3 right-3 z-20 text-[11px] px-2 py-1 rounded-md bg-white/85 dark:bg-slate-900/80 backdrop-blur shadow-sm text-slate-600 dark:text-slate-300">
          {t('fuse_edit_hint')}
        </div>
      )}

      {/* Legend */}
      <div className="absolute top-3 left-3 max-w-[calc(100%-4.5rem)] flex flex-wrap gap-x-3 gap-y-1 text-xs bg-white/80 dark:bg-slate-900/70 backdrop-blur rounded-md px-2 py-1.5 text-slate-700 dark:text-slate-300 shadow-sm">
        <span className="flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: COLORS.aileron }} />{t(layout.isFW ? 'elevons' : 'control_surfaces_short')}</span>
        {showComponents && !showSections && balance && (
          <>
            <span className="flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: COMPONENT_COLORS.servo }} />{t('mb_servos')}</span>
            <span className="flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: COMPONENT_COLORS.battery }} />{t('mb_battery')}</span>
            <span className="flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: COMPONENT_COLORS.esc }} />ESC</span>
            <span className="flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: COMPONENT_COLORS.rx }} />RX</span>
            <span className="flex items-center gap-1"><i className="inline-block w-3 h-1.5 rounded-sm" style={{ background: COMPONENT_COLORS.spar }} />{t('mb_spars')}</span>
            <span className="flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm border border-slate-300" style={{ background: COMPONENT_COLORS.mount }} />{t('stl_mounts')}</span>
            <span className="flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm opacity-60" style={{ background: COMPONENT_COLORS.hatch }} />{t('stl_hatches')}</span>
            <span className="flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: ASSEMBLY_COLORS.joiner }} />{t('asm_joiner_short')}</span>
            {balance.assembly.bands && (
              <>
                <span className="flex items-center gap-1"><i className="inline-block w-3 h-1.5 rounded-sm" style={{ background: ASSEMBLY_COLORS.dowel }} />{t('asm_dowels_short')}</span>
                <span className="flex items-center gap-1"><i className="inline-block w-3 h-1 rounded-full" style={{ background: ASSEMBLY_COLORS.band }} />{t('asm_bands_short')}</span>
              </>
            )}
            {balance.linkExits.length > 0 && (
              <span className="flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: ASSEMBLY_COLORS.drill }} />{t('link_exit_short')}</span>
            )}
          </>
        )}
        <span className="flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-full bg-slate-900 dark:bg-white" />CG</span>
        <span className="flex items-center gap-1"><i className="inline-block w-0 h-0 border-l-[6px] border-r-[6px] border-t-[10px] border-l-transparent border-r-transparent border-t-orange-500" />NP</span>
      </div>
      <div className="absolute bottom-2 right-3 text-xs text-slate-400 dark:text-slate-500 pointer-events-none">
        {t('drag_to_rotate')}
      </div>
      <div className="absolute top-14 right-3 flex flex-col items-stretch gap-1 text-xs bg-white/85 dark:bg-slate-900/75 backdrop-blur rounded-md px-2 py-1.5 shadow-sm text-slate-700 dark:text-slate-300 select-none">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showComponents} onChange={e => setShowComponents(e.target.checked)} className="accent-violet-600" />
          {t('show_components')}
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showSections} onChange={e => setShowSections(e.target.checked)} className="accent-emerald-600" />
          {t('show_print_sections')}
        </label>
        <label className="flex flex-col gap-1 pt-1 mt-0.5 border-t border-slate-200 dark:border-slate-700">
          <span className="flex items-center justify-between gap-2">{t('explode_view')}<b className="font-medium tabular-nums">{Math.round(explode * 100)}%</b></span>
          <input type="range" min={0} max={1} step={0.05} value={explode} onChange={e => onExplode(parseFloat(e.target.value))} className="accent-sky-600 w-36" aria-label={t('explode_view')} />
        </label>
      </div>
      <button
        onClick={() => setIsRotating(!isRotating)}
        className="absolute top-3 right-3 p-2 bg-white dark:bg-slate-800 rounded-full shadow-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        title={isRotating ? t('pause_rotation') : t('start_rotation')}
        aria-label={isRotating ? t('pause_rotation') : t('start_rotation')}
      >
        {isRotating ? <Pause size={20} /> : <Play size={20} />}
      </button>
    </div>
  );
}
