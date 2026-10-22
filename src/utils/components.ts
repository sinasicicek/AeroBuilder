/**
 * Onboard components (servos, battery, ESC, receiver, motor), their placement,
 * the control linkages, and the mass & balance of the whole aircraft.
 *
 * All positions here are in MILLIMETRES using the layout frame:
 *   s = station aft of the nose (mm), x = span (right +), y = up.
 * Masses in grams.
 */
import * as THREE from 'three';
import type { AirfoilSpec } from './calculations';
import { sectionHalfHeightAt, type Layout } from './geometry';
import { getAirfoil } from './airfoils';
import { buildPrintPlan, DEFAULT_PRINT_SETTINGS, trimSparLines, type PrintPlan, type Pocket } from './printParts';
import { computeAssembly, type AssemblySpec, type WingMount } from './assembly';

export type ServoKey = 'micro5' | 'sg90' | 'mg90s' | 'mid17' | 'standard';
export type BatteryKey = 'auto' | string;

/**
 * l = body length (between the tabs), w = width, h = height (base to top, without shaft).
 * tabSpan = length over the mounting tabs, holeSpacing = screw hole spacing,
 * tabH = height of the underside of the tabs above the base.
 */
export interface ServoSpec { key: ServoKey; label: string; mass: number; l: number; w: number; h: number; tabSpan: number; holeSpacing: number; tabH: number }
export interface BatterySpec { key: string; cells: number; mAh: number; label: string; mass: number; l: number; w: number; h: number }

// Body sizes (mm): l = length (incl. no tabs), w = width, h = height
export const SERVOS: ServoSpec[] = [
  { key: 'micro5', label: '5 g micro (HK-5330)', mass: 5, l: 20, w: 8.5, h: 18, tabSpan: 26, holeSpacing: 23, tabH: 12.5 },
  { key: 'sg90', label: '9 g (SG90 / ES08MA)', mass: 9, l: 23, w: 12.5, h: 22.5, tabSpan: 32.5, holeSpacing: 28, tabH: 15.9 },
  { key: 'mg90s', label: '13 g metal (MG90S)', mass: 13.4, l: 23, w: 12.5, h: 22.5, tabSpan: 32.5, holeSpacing: 28, tabH: 15.9 },
  { key: 'mid17', label: '17 g (HXT-17 / HS-82)', mass: 17, l: 29, w: 13, h: 30, tabSpan: 39, holeSpacing: 34.5, tabH: 20.5 },
  { key: 'standard', label: 'Standard 40 g (MG996R)', mass: 45, l: 40.5, w: 20, h: 37, tabSpan: 54.5, holeSpacing: 49.5, tabH: 26.5 },
];

export const BATTERIES: BatterySpec[] = [
  { key: '2s800', cells: 2, mAh: 800, label: '2S 800 mAh', mass: 48, l: 60, w: 30, h: 13 },
  { key: '2s1000', cells: 2, mAh: 1000, label: '2S 1000 mAh', mass: 58, l: 70, w: 30, h: 14 },
  { key: '3s850', cells: 3, mAh: 850, label: '3S 850 mAh', mass: 72, l: 60, w: 30, h: 20 },
  { key: '3s1000', cells: 3, mAh: 1000, label: '3S 1000 mAh', mass: 88, l: 72, w: 34, h: 18 },
  { key: '3s1300', cells: 3, mAh: 1300, label: '3S 1300 mAh', mass: 110, l: 72, w: 35, h: 22 },
  { key: '3s1800', cells: 3, mAh: 1800, label: '3S 1800 mAh', mass: 150, l: 98, w: 34, h: 22 },
  { key: '3s2200', cells: 3, mAh: 2200, label: '3S 2200 mAh', mass: 180, l: 105, w: 34, h: 25 },
  { key: '4s1500', cells: 4, mAh: 1500, label: '4S 1500 mAh', mass: 170, l: 78, w: 35, h: 33 },
  { key: '4s2200', cells: 4, mAh: 2200, label: '4S 2200 mAh', mass: 235, l: 105, w: 34, h: 33 },
  { key: '4s3300', cells: 4, mAh: 3300, label: '4S 3300 mAh', mass: 340, l: 135, w: 43, h: 31 },
];

export interface ComponentSettings { servo: ServoKey; battery: BatteryKey; wingMount?: WingMount }
export const DEFAULT_COMPONENTS: ComponentSettings = { servo: 'sg90', battery: 'auto', wingMount: 'bands' };

export type ItemKind = 'airframe' | 'spar' | 'motor' | 'prop' | 'esc' | 'battery' | 'servo' | 'rx' | 'misc' | 'ballast' | 'mount' | 'hatch' | 'hardware';

export const COMPONENT_COLORS: Partial<Record<ItemKind, string>> = {
  servo: '#7c3aed',
  battery: '#10b981',
  esc: '#ef4444',
  rx: '#0ea5e9',
  ballast: '#52525b',
  spar: '#1e293b',
  mount: '#e2e8f0',
  hatch: '#38bdf8',
  hardware: '#92400e',
};

/** Colours of the assembly parts in the 2D/3D views. */
export const ASSEMBLY_COLORS = { dowel: '#92400e', band: '#d97706', joiner: '#0d9488', guard: '#0d9488', sleeve: '#e2e8f0', drill: '#e11d48', guide: '#94a3b8', tail: '#2563eb', pin: '#1e293b' };

export interface MassItem {
  id: string;
  kind: ItemKind;
  labelKey: string;
  detail?: string;
  mass: number;               // g
  s: number; x: number; y: number;          // centre (mm)
  size?: [number, number, number];          // [span (x), height (y), length (s)] mm, for boxes
  rotZ?: number;                            // optional rotation about the flight axis (rad)
}

export interface Linkage { id: string; from: [number, number, number]; to: [number, number, number]; length: number } // [x,y,s] mm

/**
 * Where a tail pushrod leaves the servo bay and the fuselage. Vase-mode walls
 * cannot carry holes, so these are drilled at assembly (see README).
 * `through` is the bay's aft wall (or its floor), `skin` the exit in the shell.
 */
export interface LinkExit {
  id: string;
  through: [number, number, number] | null;
  throughKind: 'wall' | 'floor';
  skin: [number, number, number] | null;
  guide: number;          // mm of guide tube from the bay wall to the skin exit
  hitsDowel: boolean;     // the rod would cross a wing-dowel sleeve
}

/**
 * Printable servo mount (flat plate, printed in normal mode). Drawn in its own
 * 2D frame (u, v) and extruded by t along its normal:
 *  - 'span' plate (wing servo): u = chord (station), v = up
 *  - 'up' tray (fuselage servos): u = span (x), v = station
 */
export interface MountSpec {
  id: string;
  side: 'R' | 'L' | 'C';
  normal: 'span' | 'up';
  origin: [number, number, number];      // centre of the plate [x, y, s] mm
  outline: [number, number][];           // closed polygon (u, v)
  windows: [number, number][][];         // closed polygons cut through
  holes: { u: number; v: number; d: number }[];
  t: number;
}

export interface SparLine { id: string; d: number; a: [number, number, number]; b: [number, number, number]; mirror: boolean }

export interface BalanceResult {
  items: MassItem[];
  linkages: Linkage[];
  mounts: MountSpec[];
  sparLines: SparLine[];
  servo: ServoSpec;
  battery: BatterySpec;
  auw: number;                // g
  airframe: number;           // g (printed parts + spars)
  cgTarget: number;           // station mm
  cgAchieved: number;         // station mm
  batteryRange: [number, number];
  ballast: { mass: number; s: number } | null;
  wingLoading: number;        // g/dm²
  warnings: { key: string; params?: Record<string, string | number> }[];
  /** Joints: wing joiner, dowels and rubber bands (see assembly.ts). */
  assembly: AssemblySpec;
  /** Two-piece tail with the stab seat and fin slot (null = glued tail). */
  tailFit: PrintPlan['tailFit'];
  /** Carbon alignment pins across the fuselage joints. */
  pins: PrintPlan['pins'];
  /** Flying wing: the pack lies across the wing (length along the span). */
  batteryAcross: boolean;
  /** Wing servo pocket depth from the lower skin (mm). */
  wingServoDepth: number;
  /** Tail pushrod exits to drill in the fuselage. */
  linkExits: LinkExit[];
}

// LW-PLA vase-mode shell: ~0.45 mm wall at ~0.7 g/cm³ (foamed at ~230 °C)
const SHELL_G_PER_MM2 = 0.45 * 0.7e-3;
const CARBON = 1.55e-3; // g/mm³

function motorMass(propIn: number) {
  if (propIn <= 6) return 18;     // 1806
  if (propIn <= 8) return 28;     // 2204
  if (propIn <= 10) return 52;    // 2212
  if (propIn <= 11) return 76;    // 2216
  return 90;                      // 2826
}
function escSpec(propIn: number) {
  if (propIn <= 7) return { amps: 12, mass: 12, l: 38, w: 18, h: 7 };
  if (propIn <= 10) return { amps: 30, mass: 28, l: 50, w: 25, h: 10 };
  return { amps: 45, mass: 45, l: 60, w: 30, h: 12 };
}
const RX = { mass: 10, l: 35, w: 20, h: 10 };

function meshAreaAndCentroid(geo: THREE.BufferGeometry) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.getIndex()!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  let area = 0; const cen = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    a.fromBufferAttribute(p, idx.getX(t)); b.fromBufferAttribute(p, idx.getX(t + 1)); c.fromBufferAttribute(p, idx.getX(t + 2));
    const ar = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
    area += ar;
    cen.addScaledVector(a.clone().add(b).add(c), ar / 3);
  }
  return { area, centroid: area > 0 ? cen.multiplyScalar(1 / area) : cen };
}

function sparMass(d: number, len: number) {
  // ≥ 5 mm: tube with 1 mm wall; below: solid rod
  const ring = d >= 5 ? Math.PI / 4 * (d * d - (d - 2) * (d - 2)) : Math.PI / 4 * d * d;
  return ring * len * CARBON;
}

/**
 * Places the components and solves the battery position so the CG lands on the
 * target (layout.cgS). Pass an existing print plan to avoid rebuilding it.
 */
export function computeBalance(L: Layout, airfoil: AirfoilSpec, settings: ComponentSettings, plan?: PrintPlan): BalanceResult {
  const mm = L.toCm * 10;
  const ownPlan = !plan;
  const P = plan ?? buildPrintPlan(L, airfoil, DEFAULT_PRINT_SETTINGS);
  const items: MassItem[] = [];
  const linkages: Linkage[] = [];
  const warnings: BalanceResult['warnings'] = [];
  const w = L.wing;
  const af = getAirfoil(airfoil);

  // ── Where things physically fit: floor / ceiling (mm) inside the part that holds them ──
  const WALL = 1.2;
  const ceilings: { s0: number; s1: number; y: number }[] = []; // obstacles from above (wing dowels)
  const envelope = (s: number, x: number): [number, number] | null => {
    if (L.isFW || !L.fuselage) {
      const f = Math.min(1, Math.abs(x) / (w.halfSpan * mm));
      const c = w.chordAt(f) * mm, u = (s - w.leAt(f) * mm) / c;
      if (u < 0.02 || u > 0.96) return null;
      if (L.teCut && Math.abs(x) <= L.teCut.halfWidth * mm && s >= L.teCut.sCut * mm) return null;
      // bays are open on the upper skin (the hatch closes them flush)
      return [w.yAt(f) * mm + af.lower(u) * c + WALL, w.yAt(f) * mm + af.upper(u) * c];
    }
    const fz = L.fuselage;
    if (s < 3 || s > fz.length * mm - 3) return null;
    const sec = fz.section(s / mm);
    if (Math.abs(x) > (sec.w * mm) / 2 - WALL) return null;
    const hh = sectionHalfHeightAt(sec, Math.abs(x) / mm, fz.style) * mm;
    let hi = sec.yc * mm + hh;
    ceilings.forEach(cl => { if (s > cl.s0 && s < cl.s1) hi = Math.min(hi, cl.y); });
    return [sec.yc * mm - hh + WALL, hi];
  };
  /** Rests a box (sx across, sy tall, ss long) on the floor at (s, x): y of its centre, or null if it does not fit. */
  const seat = (s: number, x: number, sx: number, sy: number, ss: number): number | null => {
    let lo = -Infinity, hi = Infinity;
    for (let i = 0; i <= 8; i++) {
      for (const dx of [-sx / 2, 0, sx / 2]) {
        const e = envelope(s - ss / 2 + (ss * i) / 8, x + dx);
        if (!e) return null;
        lo = Math.max(lo, e[0]); hi = Math.min(hi, e[1]);
      }
    }
    return lo + sy <= hi + 0.05 ? lo + sy / 2 : null;
  };
  /** Station closest to `s` within [a, b] where the box fits. */
  const nearestFit = (s: number, a: number, b: number, sx: number, sy: number, ss: number): { s: number; y: number } | null => {
    let best: { s: number; y: number } | null = null;
    for (let t = Math.ceil(a); t <= b; t += 1) {
      const y = seat(t, 0, sx, sy, ss);
      if (y !== null && (!best || Math.abs(t - s) < Math.abs(best.s - s))) best = { s: t, y };
    }
    return best;
  };
  const partsNoFit: string[] = [];
  const servo = SERVOS.find(s => s.key === settings.servo) ?? SERVOS[1];
  const propIn = L.prop.diameter * L.toCm / 2.54;

  // ── Airframe (printed shells), grouped by part kind ──
  const groups = new Map<string, { mass: number; ms: number; mx: number; my: number }>();
  P.sections.forEach(sec => {
    const { area, centroid } = meshAreaAndCentroid(sec.geometry);
    const m = area * SHELL_G_PER_MM2;
    const g = groups.get(sec.kind) ?? { mass: 0, ms: 0, mx: 0, my: 0 };
    g.mass += m; g.ms += m * -centroid.z; g.mx += m * centroid.x; g.my += m * centroid.y;
    groups.set(sec.kind, g);
  });
  groups.forEach((g, kind) => {
    items.push({ id: `airframe_${kind}`, kind: 'airframe', labelKey: `mb_part_${kind}`, mass: g.mass, s: g.ms / g.mass, x: 0, y: g.my / g.mass });
  });
  // Spars (centred on the wing/tail they belong to)
  P.spars.forEach(sp => {
    const m = sparMass(sp.diameter, sp.length) * sp.count;
    let s = w.leAt(0.5) * mm + w.chordAt(0.5) * mm * (sp.id === 'rear' ? 0.6 : 0.28);
    if (sp.id === 'tail' && L.hStab) s = (L.hStab.leS + L.hStab.rootChord * 0.3) * mm;
    if (sp.id === 'fin' && L.fin) s = (L.fin.leS + L.fin.rootChord * 0.3) * mm;
    if (sp.s !== undefined) s = sp.s;
    items.push({ id: `spar_${sp.id}`, kind: 'spar', labelKey: sp.part, detail: `Ø${sp.diameter} × ${sp.length} mm × ${sp.count}`, mass: m, s, x: 0, y: sp.y ?? w.mountY * mm });
  });
  if (ownPlan) P.sections.forEach(s => s.geometry.dispose());
  const airframe = items.reduce((a, i) => a + i.mass, 0);

  // ── Motor, prop, ESC ──
  const m = L.motor;
  const motorS = (m.mountS + m.dir * m.length / 2) * mm;
  items.push({ id: 'motor', kind: 'motor', labelKey: 'mb_motor', mass: motorMass(propIn), s: motorS, x: 0, y: L.prop.y * mm });
  items.push({ id: 'prop', kind: 'prop', labelKey: 'mb_prop', detail: L.prop.label, mass: Math.round(1.4 * propIn), s: L.prop.s * mm, x: 0, y: L.prop.y * mm });
  const esc = escSpec(propIn);

  // ── Servos + linkages ──
  const hingeX = 1 - L.aileron.chordFrac;
  const mainX = 0.28, rearX = Math.min(0.62, hingeX - 0.1);
  const servoXFrac = (mainX + rearX) / 2;
  const fS = L.aileron.f0 + 0.12 * (L.aileron.f1 - L.aileron.f0);
  const cS = w.chordAt(fS) * mm;
  const mounts: MountSpec[] = [];
  const PLATE_T = 2.5;
  // Pocket depth used for wing servos (keeps 1.2 mm of the opposite skin)
  const thickAtServo = (af.upper(servoXFrac) - af.lower(servoXFrac)) * cS;
  // The lower skin curves: raise the servo so no corner of its body pokes out of the pocket
  const servoLift = (() => {
    const sC = w.leAt(fS) * mm + servoXFrac * cS;
    const lowerAt = (s: number, x: number) => {
      const f = Math.min(1, Math.abs(x) / (w.halfSpan * mm));
      const c = w.chordAt(f) * mm;
      return w.yAt(f) * mm + af.lower((s - w.leAt(f) * mm) / c) * c;
    };
    const x0 = fS * w.halfSpan * mm, y0 = lowerAt(sC, x0);
    let m = 0;
    for (let i = 0; i <= 8; i++) for (const dx of [-servo.h / 2, 0, servo.h / 2]) m = Math.max(m, lowerAt(sC - servo.l / 2 + (servo.l * i) / 8, x0 + dx) - y0);
    return m;
  })();
  const servoPocketDepth = Math.min(servo.w + 3 + servoLift, thickAtServo - 1.2);
  const wingServo = (side: 1 | -1) => {
    // Servo lying on its side: height span-wise (output shaft pointing outboard),
    // length along the chord, width vertical; the arm comes out through the lower skin.
    const x = side * fS * w.halfSpan * mm;
    const s = w.leAt(fS) * mm + servoXFrac * cS;
    const lowerY = w.yAt(fS) * mm + af.lower(servoXFrac) * cS;
    const midY = lowerY + servoLift + servo.w / 2 + 0.5;
    items.push({
      id: `servo_wing_${side > 0 ? 'R' : 'L'}`, kind: 'servo', labelKey: L.isFW ? 'mb_servo_elevon' : 'mb_servo_aileron',
      detail: servo.label, mass: servo.mass, s, x, y: midY,
      size: [servo.h, servo.w, servo.l],
    });
    // Mounting plate at the tabs (servo slides in from inboard, tabs screw to the plate)
    const plateX = x + side * (-servo.h / 2 + servo.tabH + PLATE_T / 2);
    const plateH = Math.max(servoPocketDepth - servoLift - 0.4, servo.w + 1.5);
    const U = (servo.tabSpan + 5) / 2;
    const winW = (servo.l + 0.4) / 2;
    const vBot = -plateH / 2, vTop = plateH / 2, vWin = vBot + servo.w + 0.4;
    mounts.push({
      id: `mount_wing_${side > 0 ? 'R' : 'L'}`, side: side > 0 ? 'R' : 'L', normal: 'span',
      origin: [plateX, lowerY + servoLift + 0.2 + plateH / 2, s],
      // U-shaped plate: the window is open towards the pocket opening (lower skin)
      outline: [[-U, vBot], [-winW, vBot], [-winW, vWin], [winW, vWin], [winW, vBot], [U, vBot], [U, vTop], [-U, vTop]],
      windows: [],
      holes: [-1, 1].map(k => ({ u: k * servo.holeSpacing / 2, v: vBot + servo.w / 2 + 0.2, d: 1.8 })),
      t: PLATE_T,
    });
    // Arm at the shaft (outboard end, near one end of the body), pushrod aft to the horn
    const armX = x + side * (servo.h / 2 - 3);
    const armS = s + servo.l * 0.25;
    const armY = lowerY - 6;
    const hornS = w.leAt(fS) * mm + (hingeX + 0.04) * cS;
    const hornY = w.yAt(fS) * mm + af.lower(hingeX + 0.04) * cS - 8;
    const from: [number, number, number] = [armX, armY, armS];
    const to: [number, number, number] = [armX, hornY, hornS];
    linkages.push({ id: `link_wing_${side > 0 ? 'R' : 'L'}`, from, to, length: dist(from, to) });
  };
  wingServo(1); wingServo(-1);
  if (servo.w + 2.5 + servoLift > thickAtServo) {
    warnings.push({ key: 'mb_warn_servo_thick', params: { t: thickAtServo.toFixed(1), h: servo.w } });
  }

  if (!L.isFW && L.fuselage && L.hStab && L.fin) {
    const fz = L.fuselage;
    const sServo = (w.leS + w.rootChord) * mm + servo.l / 2 + 15;
    const sec = fz.section(sServo / mm);
    const baseY = sec.yc * mm - sectionHalfHeightAt(sec, (servo.w + 1) / mm, fz.style) * mm + servo.h / 2 + 3;
    // Two servos side by side, standing, long axis along the fuselage
    ([['elev', -1], ['rudder', 1]] as const).forEach(([id, side]) => {
      const x = side * (servo.w / 2 + 1);
      items.push({ id: `servo_${id}`, kind: 'servo', labelKey: id === 'elev' ? 'mb_servo_elevator' : 'mb_servo_rudder', detail: servo.label, mass: servo.mass, s: sServo, x, y: baseY, size: [servo.w, servo.h, servo.l] });
    });
    if ((sec.w * mm) < servo.w * 2 + 6 || (sec.h * mm) < servo.h + 6) {
      warnings.push({ key: 'mb_warn_servo_fuse' });
    }
    // Printed tray: servos drop in from the top and rest on their tabs
    {
      const trayY = baseY - servo.h / 2 + servo.tabH - PLATE_T / 2;
      const halfU = Math.min(servo.w + 1 + 6, (sec.w * mm) / 2 - 1.5);
      const halfV = (servo.tabSpan + 6) / 2;
      // (the two windows are offset by a hair so their edges are never collinear —
      // collinear hole edges make the ear-clipping triangulation drop vertices)
      const win = (cx: number): [number, number][] => {
        const a2 = (servo.w + 0.4) / 2, b2 = (servo.l + 0.4) / 2 + (cx > 0 ? 0.05 : 0);
        return [[cx - a2, -b2], [cx + a2, -b2], [cx + a2, b2], [cx - a2, b2]];
      };
      const cxs = [-(servo.w / 2 + 1), servo.w / 2 + 1];
      mounts.push({
        id: 'mount_tail_servos', side: 'C', normal: 'up',
        origin: [0, trayY, sServo],
        outline: [[-halfU, -halfV], [halfU, -halfV], [halfU, halfV], [-halfU, halfV]],
        windows: cxs.map(win),
        holes: cxs.flatMap(cx => [-1, 1].map(k => ({ u: cx, v: k * servo.holeSpacing / 2, d: 1.8 }))),
        t: PLATE_T,
      });
    }
    const h = L.hStab, f = L.fin;
    const eFrom: [number, number, number] = [-(servo.w / 2 + 1), baseY + servo.h / 2, sServo - servo.l * 0.25];
    // Elevator horn on the elevator just outside the fuselage side (left), under the stab
    const eHornS = (h.leS + h.rootChord * (1 - h.hingeFrac) + h.rootChord * 0.05) * mm;
    const eHornX = Math.min((fz.section(Math.min(eHornS / mm, fz.length)).w * mm) / 2 + 8, (h.span * mm) / 2 - 5);
    const eTo: [number, number, number] = [-eHornX, h.y * mm - 10, eHornS];
    const rFrom: [number, number, number] = [servo.w / 2 + 1, baseY + servo.h / 2, sServo - servo.l * 0.25];
    const rTo: [number, number, number] = [8, f.y * mm + 15, (f.leS + f.rootChord * (1 - f.hingeFrac) + f.rootChord * 0.05) * mm];
    linkages.push({ id: 'link_elev', from: eFrom, to: eTo, length: dist(eFrom, eTo) });
    linkages.push({ id: 'link_rudder', from: rFrom, to: rTo, length: dist(rFrom, rTo) });
  }

  // Printed servo mounts (PLA/PETG, ~70 % effective density)
  mounts.forEach(m => {
    let area = 0;
    m.outline.forEach(([u1, v1], i) => { const [u2, v2] = m.outline[(i + 1) % m.outline.length]; area += u1 * v2 - u2 * v1; });
    area = Math.abs(area) / 2;
    m.windows.forEach(wp => { let a2 = 0; wp.forEach(([u1, v1], i) => { const [u2, v2] = wp[(i + 1) % wp.length]; a2 += u1 * v2 - u2 * v1; }); area -= Math.abs(a2) / 2; });
    items.push({ id: m.id, kind: 'mount', labelKey: 'mb_mount', mass: area * m.t * 1.24e-3 * 0.7, s: m.origin[2], x: m.origin[0], y: m.origin[1] });
  });

  // ── ESC + receiver ──
  let escPos: [number, number, number];
  let rxPos: [number, number, number];
  if (!L.isFW && L.fuselage) {
    const fz = L.fuselage;
    const sE = 10 + esc.l / 2;
    const secE = fz.section(sE / mm);
    escPos = [0, secE.yc * mm + sectionHalfHeightAt(secE, (esc.w / 2) / mm, fz.style) * mm - esc.h / 2 - 3, sE];
    const sR = L.cgS * mm + 25;
    const secR = fz.section(sR / mm);
    rxPos = [0, secR.yc * mm + sectionHalfHeightAt(secR, (RX.w / 2) / mm, fz.style) * mm - RX.h / 2 - 3, sR];
  } else {
    // Flying wing: electronics as far forward as possible (they help the balance);
    // the motor wires run aft to the pusher.
    // Each part sits on the lower skin where the wing is thick enough for it.
    const mid = (s: number) => {
      const fr = (s - w.leAt(0) * mm) / (w.rootChord * mm);
      return w.mountY * mm + (af.upper(fr) + af.lower(fr)) / 2 * w.rootChord * mm;
    };
    const rootLe = w.leAt(0) * mm, rootTe = w.teAt(0) * mm;
    const sE = L.cgS * mm;
    const e = nearestFit(sE, rootLe, rootTe, esc.w, esc.h, esc.l);
    if (!e) partsNoFit.push('ESC');
    escPos = e ? [0, e.y, e.s] : [0, mid(sE), sE];
    const behind = escPos[2] + esc.l / 2 + RX.l / 2 + 4;
    const ahead = escPos[2] - esc.l / 2 - RX.l / 2 - 4;
    const r = nearestFit(behind, behind, rootTe, RX.w, RX.h, RX.l) ?? nearestFit(ahead, rootLe, ahead, RX.w, RX.h, RX.l);
    if (!r) partsNoFit.push('RX');
    rxPos = r ? [0, r.y, r.s] : [0, mid(behind), behind];
  }
  items.push({ id: 'esc', kind: 'esc', labelKey: 'mb_esc', detail: `${esc.amps} A`, mass: esc.mass, s: escPos[2], x: escPos[0], y: escPos[1], size: [esc.w, esc.h, esc.l] });
  items.push({ id: 'rx', kind: 'rx', labelKey: 'mb_rx', mass: RX.mass, s: rxPos[2], x: rxPos[0], y: rxPos[1], size: [RX.w, RX.h, RX.l] });

  // Wiring, glue, hinges, horns
  const sub = items.reduce((a, i) => a + i.mass, 0);
  const miscMass = sub * 0.06 + 4 * 2;
  const miscS = items.reduce((a, i) => a + i.mass * i.s, 0) / sub;
  items.push({ id: 'misc', kind: 'misc', labelKey: 'mb_misc', mass: miscMass, s: miscS, x: 0, y: 0 });

  // ── Joints: wing joiner plate, dowels + sleeves + bands, trailing-edge guard ──
  const PLA = 1.24e-3, WOOD = 0.7e-3; // g/mm³
  const preAuw = items.reduce((a, i) => a + i.mass, 0) * 1.3;
  const assembly = computeAssembly(L, airfoil, settings.wingMount ?? 'bands', preAuw);
  {
    const j = assembly.joiner;
    items.push({ id: 'joiner', kind: 'mount', labelKey: 'asm_joiner', detail: 'PETG/PLA', mass: 2 * j.halfLen * (j.sb - j.sa) * j.t * PLA, s: (j.sa + j.sb) / 2, x: 0, y: w.mountY * mm });
  }
  if (assembly.sleeve) {
    const od = assembly.sleeve.od;
    assembly.dowels.forEach(d => ceilings.push({ s0: d.s - od / 2 - 1, s1: d.s + od / 2 + 1, y: d.y - od / 2 }));
  }
  if (assembly.bands && assembly.sleeve) {
    const ds = assembly.dowels;
    const dm = ds.reduce((a, d) => a + Math.PI * (d.d / 2) ** 2 * d.len * WOOD, 0);
    items.push({ id: 'dowels', kind: 'hardware', labelKey: 'asm_dowels', detail: `2 × Ø${ds[0].d} × ${Math.round(ds[0].len)} mm`, mass: dm, s: (ds[0].s + ds[1].s) / 2, x: 0, y: ds[0].y });
    const sl = assembly.sleeve;
    const sm = ds.reduce((a, d) => a + Math.PI * ((sl.od / 2) ** 2 - (sl.id / 2) ** 2) * d.width * PLA, 0);
    items.push({ id: 'sleeves', kind: 'mount', labelKey: 'asm_sleeves', mass: sm, s: (ds[0].s + ds[1].s) / 2, x: 0, y: ds[0].y });
    const b = assembly.bands;
    items.push({ id: 'bands', kind: 'hardware', labelKey: 'asm_bands', detail: `${b.count} × ~${b.flatLen} mm`, mass: b.count * 1.3, s: w.leS * mm + w.rootChord * mm * 0.5, x: 0, y: w.mountY * mm });
    const g = assembly.teGuard!;
    items.push({ id: 'te_guard', kind: 'mount', labelKey: 'asm_te_guard', mass: 2 * g.halfWidth * (g.sb - g.sa) * g.t * PLA, s: (g.sa + g.sb) / 2, x: 0, y: w.mountY * mm });
  }

  // ── Battery: bay limits, then position that puts the CG on target ──
  const M0 = items.reduce((a, i) => a + i.mass, 0);
  const S0 = items.reduce((a, i) => a + i.mass * i.s, 0);
  const T = L.cgS * mm;
  // The ESC in the nose of a conventional fuselage hangs from the top: the pack must pass under it
  if (!L.isFW && L.fuselage) ceilings.push({ s0: escPos[2] - esc.l / 2 - 1, s1: escPos[2] + esc.l / 2 + 1, y: escPos[1] - esc.h / 2 - 1 });
  type BayOption = { range: [number, number]; y: number; fits: boolean; yAt: (s: number) => number; across: boolean };
  const bayCache = new Map<string, BayOption[]>();
  /**
   * Stations where the pack physically fits (largest continuous stretch), and
   * its height there. On a flying wing the pack may also lie across (length
   * along the span): it then needs much less chord and can sit further forward.
   */
  const bay = (bt: BatterySpec): BayOption[] => {
    const hit = bayCache.get(bt.key);
    if (hit) return hit;
    const opts = (L.isFW ? [false, true] : [false]).map(across => bayOne(bt, across));
    bayCache.set(bt.key, opts);
    return opts;
  };
  const bayOne = (bt: BatterySpec, across: boolean): BayOption => {
    const along = across ? bt.w : bt.l;   // footprint along the chord
    const wide = across ? bt.l : bt.w;    // footprint across
    let lo: number, hi: number, yFallback: number;
    if (!L.isFW && L.fuselage) {
      const fz = L.fuselage;
      lo = 10 + along / 2;                          // right behind the firewall
      hi = (w.leS + w.rootChord) * mm - along / 2;  // up to the wing TE
      const secMid = fz.section(((lo + hi) / 2) / mm);
      const hb = sectionHalfHeightAt(secMid, (wide / 2) / mm, fz.style) * mm;
      yFallback = secMid.yc * mm - hb + bt.h / 2 + 2;
    } else {
      lo = w.leAt(0) * mm + 8 + along / 2;
      // ahead of the ESC — and of the receiver when it had to go in front of the ESC
      const front = Math.min(escPos[2] - esc.l / 2, rxPos[2] < escPos[2] ? rxPos[2] - RX.l / 2 : Infinity);
      hi = front - 5 - along / 2;
      const frac = Math.min(0.5, Math.max(0.1, (lo - w.leAt(0) * mm) / (w.rootChord * mm)));
      yFallback = w.mountY * mm + (af.upper(frac) + af.lower(frac)) / 2 * w.rootChord * mm;
    }
    hi = Math.max(lo, hi);
    let best: [number, number] | null = null, run: [number, number] | null = null;
    const ys = new Map<number, number>();
    for (let s = Math.ceil(lo); s <= hi; s += 1) {
      const y = seat(s, 0, wide, bt.h, along);
      if (y !== null) {
        ys.set(s, y);
        run = run ? [run[0], s] : [s, s];
        if (!best || run[1] - run[0] > best[1] - best[0]) best = [run[0], run[1]];
      } else run = null;
    }
    return best
      ? { range: best, y: ys.get(best[0])!, fits: true, yAt: (s: number) => ys.get(Math.round(Math.min(best![1], Math.max(best![0], s))))!, across }
      : { range: [lo, hi] as [number, number], y: yFallback, fits: false, yAt: () => yFallback, across };
  };
  const solve = (bt: BatterySpec) => {
    const ideal = (T * (M0 + bt.mass) - S0) / bt.mass;
    // Among the orientations that fit, the one that gets closest to the ideal spot
    const opts = bay(bt);
    const ok = opts.filter(o => o.fits);
    const pick = (ok.length ? ok : opts).reduce((a, o) => {
      const da = Math.abs(Math.min(a.range[1], Math.max(a.range[0], ideal)) - ideal);
      const d = Math.abs(Math.min(o.range[1], Math.max(o.range[0], ideal)) - ideal);
      return d < da - 0.5 ? o : a;
    });
    const pos = Math.min(pick.range[1], Math.max(pick.range[0], ideal));
    return { range: pick.range, y: pick.yAt(pos), ideal, pos, fits: pick.fits, across: pick.across };
  };

  const cells = propIn <= 7 ? 2 : propIn <= 11 ? 3 : 4;
  let battery: BatterySpec;
  if (settings.battery !== 'auto' && BATTERIES.some(b => b.key === settings.battery)) {
    battery = BATTERIES.find(b => b.key === settings.battery)!;
  } else {
    // Target ≈ 22 % of AUW, but prefer the pack that needs the least ballast
    const want = (0.22 / 0.78) * M0;
    // Only packs that physically fit; other cell counts if none of the preferred one does
    const fitting = BATTERIES.filter(b => bay(b).some(o => o.fits));
    let pool = fitting.filter(b => b.cells === cells);
    if (!pool.length) pool = fitting;
    if (!pool.length) {
      const same = BATTERIES.filter(b => b.cells === cells);
      pool = [same.reduce((a, b) => (b.mass < a.mass ? b : a), same[0])];
    }
    const score = (b: BatterySpec) => {
      const r = solve(b);
      const Mt = M0 + b.mass;
      const S = S0 + b.mass * r.pos;
      const sN = L.isFW ? w.leAt(0) * mm + 10 : 5;
      const need = r.ideal < r.range[0] - 1 ? Math.max(0, (S - T * Mt) / (T - sN)) : 0;
      // Any ballast is dead weight: prefer a pack that balances without it
      return need * 3 + (need > 0.5 ? 15 : 0) + Math.abs(b.mass - want) + (b.mass > want * 1.8 ? 1000 : 0);
    };
    battery = pool.reduce((best, b) => (score(b) < score(best) ? b : best), pool[0]);
  }

  const mb = battery.mass;
  const sol = solve(battery);
  const range = sol.range;
  const ideal = sol.ideal;
  const bS = sol.pos;
  items.push({ id: 'battery', kind: 'battery', labelKey: 'mb_battery', detail: battery.label, mass: mb, s: bS, x: 0, y: sol.y, size: sol.across ? [battery.l, battery.h, battery.w] : [battery.w, battery.h, battery.l] });

  let ballast: BalanceResult['ballast'] = null;
  const Mt = M0 + mb;
  if (ideal < range[0] - 1) {
    // Tail heavy even with the battery all the way forward → nose ballast
    const sN = L.isFW ? w.leAt(0) * mm + 10 : 5;
    const mBal = (S0 + mb * bS - T * Mt) / (T - sN);
    if (mBal > 0.5) {
      ballast = { mass: mBal, s: sN };
      items.push({ id: 'ballast', kind: 'ballast', labelKey: 'mb_ballast', mass: mBal, s: sN, x: 0, y: L.isFW ? w.mountY * mm : (L.fuselage ? (L.fuselage.section(0).yc) * mm : 0) });
      warnings.push({ key: 'mb_warn_nose_ballast', params: { g: Math.round(mBal) } });
    }
  } else if (ideal > range[1] + 1) {
    const tailS = L.isFW ? w.teAt(0) * mm : (L.fuselage ? L.fuselage.length * mm - 20 : T + 100);
    const mBal = (T * Mt - (S0 + mb * bS)) / (tailS - T);
    if (mBal > 0.5) {
      ballast = { mass: mBal, s: tailS };
      items.push({ id: 'ballast', kind: 'ballast', labelKey: 'mb_ballast', mass: mBal, s: tailS, x: 0, y: 0 });
      warnings.push({ key: 'mb_warn_tail_ballast', params: { g: Math.round(mBal) } });
    }
  }
  if (!sol.fits) {
    if (!L.isFW && L.fuselage) {
      const sec = L.fuselage.section(bS / mm);
      warnings.push({ key: 'mb_warn_battery_fit', params: { w: Math.round(sec.w * mm), h: Math.round(sec.h * mm) } });
    } else {
      const t = (af.upper(0.3) - af.lower(0.3)) * w.rootChord * mm;
      warnings.push({ key: 'mb_warn_battery_thick', params: { t: Math.round(t) } });
    }
  }
  if (partsNoFit.length) warnings.push({ key: 'mb_warn_parts_fit', params: { parts: partsNoFit.join(', ') } });

  // ── Tail pushrods: where they cross the bay wall and leave the fuselage ──
  const linkExits: LinkExit[] = [];
  if (!L.isFW && L.fuselage) {
    const fz = L.fuselage;
    const n = fz.expo;
    const inside = (p: [number, number, number]) => {
      const s = p[2];
      if (s <= 0 || s >= fz.length * mm) return false;
      const sec = fz.section(s / mm);
      return Math.abs(p[0] / (sec.w * mm / 2)) ** n + Math.abs((p[1] - sec.yc * mm) / (sec.h * mm / 2)) ** n < 1;
    };
    const bayParts = ['rx', 'servo_elev', 'servo_rudder'].map(id => items.find(i => i.id === id)).filter((c): c is MassItem => !!c?.size);
    const bayEnd = Math.max(...bayParts.map(c => c.s + c.size![2] / 2)) + 3;
    const floorY = Math.min(...bayParts.map(c => c.y - c.size![1] / 2)) - 1;
    linkages.filter(l => l.id === 'link_elev' || l.id === 'link_rudder').forEach(l => {
      const P = (t: number): [number, number, number] => [0, 1, 2].map(k => l.from[k] + (l.to[k] - l.from[k]) * t) as [number, number, number];
      let through: [number, number, number] | null = null;
      let throughKind: LinkExit['throughKind'] = 'wall';
      if (l.from[2] < bayEnd && l.to[2] > bayEnd) {
        const t = (bayEnd - l.from[2]) / (l.to[2] - l.from[2]);
        through = P(t);
        if (through[1] < floorY && l.to[1] < l.from[1]) {
          // the rod dips through the bay floor before reaching the aft wall
          const tf = (floorY - l.from[1]) / (l.to[1] - l.from[1]);
          through = P(tf); throughKind = 'floor';
        }
      }
      let tl = -1;
      for (let i = 0; i <= 400; i++) if (inside(P(i / 400))) tl = i / 400;
      const skin = tl >= 0 && tl < 1 ? P(tl) : null;
      const hitsDowel = assembly.dowels.some(d => {
        const r = (assembly.sleeve?.od ?? d.d) / 2 + 1;
        for (let i = 0; i <= 200; i++) {
          const p = P(i / 200);
          if (Math.abs(p[2] - d.s) < r && Math.abs(p[1] - d.y) < r && Math.abs(p[0]) < d.width / 2) return true;
        }
        return false;
      });
      linkExits.push({ id: l.id, through, throughKind, skin, guide: skin ? dist(through ?? l.from, skin) : 0, hitsDowel });
      if (!skin) warnings.push({ key: 'mb_warn_link_inside', params: { id: l.id } });
      if (hitsDowel) warnings.push({ key: 'mb_warn_link_dowel', params: { id: l.id } });
    });
  }

  const auw = items.reduce((a, i) => a + i.mass, 0);
  const cgAchieved = items.reduce((a, i) => a + i.mass * i.s, 0) / auw;
  const wingAreaDm2 = ((w.rootChord + w.tipChord) / 2 * w.halfSpan * 2) * mm * mm / 1e4;

  const result: BalanceResult = {
    items, linkages, mounts, sparLines: P.sparLines, servo, battery, auw, airframe,
    cgTarget: T, cgAchieved, batteryRange: range, ballast,
    wingLoading: auw / wingAreaDm2,
    warnings,
    assembly,
    tailFit: P.tailFit,
    pins: P.pins,
    batteryAcross: !!sol.across,
    linkExits,
    wingServoDepth: servo.w + 3 + servoLift,
  };
  // Spars stop at the wall of any centre bay they would cross (same rule as the STL)
  result.sparLines = trimSparLines(P.sparLines, cutoutsFromBalance(result, L), w.halfSpan * mm);
  return result;
}

function dist(a: [number, number, number], b: [number, number, number]) {
  return Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
}

/**
 * Pockets to cut into the printed parts so the components fit:
 * - wing servos: pocket open on the lower skin (both wings)
 * - flying wing: battery / ESC / receiver bays open on the upper skin at the root
 * - conventional: open-top bays in the fuselage (front: ESC + battery;
 *   middle: receiver + tail servos, under the wing)
 */
export function cutoutsFromBalance(b: BalanceResult, L: Layout): Pocket[] {
  const out: Pocket[] = [];
  const it = (id: string) => b.items.find(i => i.id === id);
  // Recess for the wing joiner plate: lower skin, across the root
  const j = b.assembly.joiner;
  if (j.recessed) out.push({ id: 'joiner', part: 'wing', side: 'lower', xa: 0, xb: j.halfLen, sa: j.sa, sb: j.sb, depth: j.t + 0.2 });
  const sv = it('servo_wing_R');
  const plate = b.mounts.find(m => m.id === 'mount_wing_R');
  if (sv?.size) {
    const [sx, sy, ss] = sv.size;
    const halfChord = Math.max(ss / 2, plate ? Math.max(...plate.outline.map(p => Math.abs(p[0]))) : 0) + 1;
    out.push({ id: 'servo_wing', part: 'wing', side: 'lower', xa: sv.x - sx / 2 - 1, xb: sv.x + sx / 2 + 1, sa: sv.s - halfChord, sb: sv.s + halfChord, depth: Math.max(sy + 3, b.wingServoDepth) });
  }
  if (L.isFW) {
    ['battery', 'esc', 'rx'].forEach(id => {
      const c = it(id);
      if (!c?.size) return;
      const [sx, sy, ss] = c.size;
      out.push({ id: `bay_${id}`, part: 'wing', side: 'upper', xa: 0, xb: Math.abs(c.x) + sx / 2 + 2, sa: c.s - ss / 2 - 2, sb: c.s + ss / 2 + 2, depth: sy + 1.5 });
    });
  } else if (L.fuselage) {
    const bay = (id: string, ids: string[]) => {
      const cs = ids.map(it).filter((c): c is MassItem => !!c?.size);
      if (!cs.length) return;
      const sa = Math.min(...cs.map(c => c.s - c.size![2] / 2)) - 3;
      const sb = Math.max(...cs.map(c => c.s + c.size![2] / 2)) + 3;
      const halfWidth = Math.max(...cs.map(c => Math.abs(c.x) + c.size![0] / 2)) + 2;
      const floorY = Math.min(...cs.map(c => c.y - c.size![1] / 2)) - 1;
      out.push({ id, part: 'fuselage', side: 'top', xa: -halfWidth, xb: halfWidth, sa, sb, depth: 0, halfWidth, floorY });
    };
    bay('bay_front', ['esc', 'battery']);
    bay('bay_mid', ['rx', 'servo_elev', 'servo_rudder']);
  }
  return out;
}
