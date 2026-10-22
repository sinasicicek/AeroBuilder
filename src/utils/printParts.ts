/**
 * Printable parts for 3D printing in LW-PLA "spiral vase" mode.
 *
 * Each part is exported as its OUTER solid. The slicer prints it with a single
 * perimeter (vase mode), giving a light shell. Spar channels are cut as
 * "keyholes": a round hole joined to the lower skin by a very thin slit. The
 * single vase-mode perimeter follows the slit into the part and around the hole,
 * producing a tube for the carbon rod plus an internal shear web — the same
 * trick used by commercial printable RC planes.
 *
 * All geometry here is built in MILLIMETRES in the aircraft frame
 * (X = right, Y = up, Z = forward) and then split into sections that fit the
 * printer's build volume.
 */
import * as THREE from 'three';
import type { AirfoilSpec } from './calculations';
import type { Layout } from './geometry';
import { getAirfoil, chordSamples, type AirfoilSurface } from './airfoils';

type V3 = [number, number, number];
type V2 = [number, number];

export interface PrintSettings {
  bedX: number;       // mm
  bedY: number;       // mm
  bedZ: number;       // mm
  slit: number;       // keyhole slit width, mm
  minTe: number;      // minimum trailing-edge thickness, mm
  clearance: number;  // spar hole clearance on diameter, mm (the stab / fin seats use 80% of it per side)
  /** Fit-test kit: only the joints, at real scale (tail seat, fin tab, one fuselage joint, wing root). */
  kit?: boolean;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  bedX: 220, bedY: 220, bedZ: 250,
  slit: 0.2, minTe: 0.8, clearance: 0.3,
};

export type PrintKind = 'wing' | 'aileron' | 'hstab' | 'elevator' | 'fin' | 'rudder' | 'winglet' | 'fuselage' | 'mount' | 'hatch' | 'joint';

export interface PrintSection {
  name: string;               // file-friendly name, e.g. "wing_R_02"
  kind: PrintKind;
  side: 'R' | 'L' | 'C';
  index: number;              // 1-based section number within its part
  axis: V3;                   // direction that becomes +Z (up) when printing
  geometry: THREE.BufferGeometry; // assembled position, mm
  length: number;             // extent along the print axis, mm
}

export interface SparSpec {
  id: 'main' | 'rear' | 'tail' | 'fin' | 'fuse_pin';
  part: string;               // human description key
  diameter: number;           // rod diameter (mm), hole is diameter + clearance
  length: number;             // one piece, mm
  count: number;
  /** Where its mass sits (mm, station / height), when it is not on the wing. */
  s?: number;
  y?: number;
}

/** How the tail is fitted to the fuselage (for the assembly notes and the UI). */
export interface TailFit {
  /** Station where the fuselage splits into the lower/upper tail pieces. */
  sTail: number;
  /** Fin tab depth into the slot on top of the upper tail piece (0 = glued flat). */
  finTab: number;
}

export interface PrintPlan {
  sections: PrintSection[];
  spars: SparSpec[];
  /** Spar axes in mm [x, y, s]; `mirror` = also on the left side. */
  sparLines: { id: string; d: number; a: [number, number, number]; b: [number, number, number]; mirror: boolean }[];
  warnings: { key: string; params?: Record<string, string | number> }[];
  settings: PrintSettings;
  /** Null when the tail is simply glued on (no fuselage, flying wing, or no room). */
  tailFit: TailFit | null;
  /** Alignment pins across the fuselage joints (count per joint = 2). */
  pins: { d: number; length: number; joints: number[] } | null;
}

const ROD_SIZES = [2, 3, 4, 5, 6, 8, 10, 12];
const WALL = 1.2;       // mm of material kept around a spar hole
const GAP = 0.012;      // hinge gap (chord fraction) — matches the 3D view
// Tail fit and fuselage alignment pins
const PIN_LEN = 40;          // mm, one carbon pin across each fuselage joint (20 mm each side)
const PIN_TAPER = 8;         // mm over which the pin channel closes beyond the pin
const TAIL_CL_FACTOR = 0.8;  // stab / fin seat gap per side = 80% of the hole clearance (0.24 mm by default)
const KIT_LEN = 30;          // mm of stab / fin / wing root in the fit-test kit
const KIT_FUSE = 25;         // mm each side of the tested fuselage joint
const FIN_TAB = 8;           // mm the fin root sinks into its slot
const TAIL_MARGIN = 8;       // mm of the tail pieces ahead of the stab / fin
const TAIL_WALL = 2.5;       // mm kept above / below the stab cavity

// ───────────────────────── Geometry helpers ─────────────────────────

/** Newell normal of a planar-ish ring. */
function ringNormal(r: V3[]): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    n.x += (a[1] - b[1]) * (a[2] + b[2]);
    n.y += (a[2] - b[2]) * (a[0] + b[0]);
    n.z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n.normalize();
}

function centroid(r: V3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  r.forEach(p => { c.x += p[0]; c.y += p[1]; c.z += p[2]; });
  return c.multiplyScalar(1 / r.length);
}

/** Triangulate a (possibly concave, keyholed) planar ring with ear-clipping. */
export function capTriangles(r: V3[]): number[][] {
  const n = ringNormal(r);
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  const pick = (p: V3): THREE.Vector2 =>
    ax >= ay && ax >= az ? new THREE.Vector2(p[1], p[2])
      : ay >= az ? new THREE.Vector2(p[2], p[0])
        : new THREE.Vector2(p[0], p[1]);
  const pts = r.map(pick);
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  // Ear-clipping drops collinear/duplicate boundary points; the side walls still
  // use them, so re-insert them (fan from the opposite vertex) to avoid T-junctions.
  const nr = r.length;
  const used = new Set<number>();
  tris.forEach(t => t.forEach(i => used.add(i)));
  if (used.size === nr) return tris;
  const out: number[][] = [];
  const skipped = (a: number, b: number): number[] | null => {
    // indices strictly between a and b going forward around the ring, all unused
    const between: number[] = [];
    for (let i = (a + 1) % nr; i !== b; i = (i + 1) % nr) {
      if (used.has(i)) return null;
      between.push(i);
      if (between.length > nr) return null;
    }
    return between;
  };
  tris.forEach(([a, b, c]) => {
    let done = false;
    for (const [u, v, w] of [[a, b, c], [b, c, a], [c, a, b]]) {
      const fwd = skipped(u, v);
      if (fwd && fwd.length) {
        const chain = [u, ...fwd, v];
        for (let i = 0; i < chain.length - 1; i++) out.push([chain[i], chain[i + 1], w]);
        done = true; break;
      }
      const bwd = skipped(v, u);
      if (bwd && bwd.length) {
        const chain = [v, ...bwd, u];
        for (let i = 0; i < chain.length - 1; i++) out.push([chain[i + 1], chain[i], w]);
        done = true; break;
      }
    }
    if (!done) out.push([a, b, c]);
  });
  return out;
}

/**
 * Closed solid lofted through rings (same vertex count). Caps are
 * triangulated with ear-clipping so they may be any simple polygon (keyholes).
 * All faces are oriented outward.
 */
export function loftSolid(rings: V3[][]): THREE.BufferGeometry {
  const n = rings[0].length;
  const pos: number[] = [];
  const idx: number[] = [];
  rings.forEach(r => r.forEach(p => pos.push(p[0], p[1], p[2])));

  // Side orientation: check the quad at the ring point farthest from the centroid
  const c0 = centroid(rings[0]);
  let far = 0, farD = -1;
  rings[0].forEach((p, i) => {
    const d = (p[0] - c0.x) ** 2 + (p[1] - c0.y) ** 2 + (p[2] - c0.z) ** 2;
    if (d > farD) { farD = d; far = i; }
  });
  const P = (k: number, i: number) => new THREE.Vector3(...rings[k][i % n]);
  const a = P(0, far), b = P(0, far + 1), d = P(1, far);
  const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
  // Quad (a, b, c, d) with c = next ring, next point; triangle (a,b,c) normal ≈ (b-a)×(d-a)
  const outward = new THREE.Vector3().subVectors(a, c0);
  const flipSides = nrm.dot(outward) < 0;

  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const qa = k * n + i, qb = k * n + i2, qc = (k + 1) * n + i2, qd = (k + 1) * n + i;
      if (flipSides) idx.push(qa, qc, qb, qa, qd, qc);
      else idx.push(qa, qb, qc, qa, qc, qd);
    }
  }

  // Caps: orient them topologically so every edge is shared with opposite
  // direction by the neighbouring side triangle, then fix the global sign below.
  const projArea = (r: V3[], tri: number[] | null) => {
    const nrm = ringNormal(r);
    const ax = Math.abs(nrm.x), ay = Math.abs(nrm.y), az = Math.abs(nrm.z);
    const pick = (p: V3): [number, number] => (ax >= ay && ax >= az ? [p[1], p[2]] : ay >= az ? [p[2], p[0]] : [p[0], p[1]]);
    const pts = (tri ?? r.map((_, i) => i)).map(i => pick(r[i]));
    let A = 0;
    for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; A += x1 * y2 - x2 * y1; }
    return A;
  };
  const addCap = (ringIdx: number, followRing: boolean) => {
    const base = ringIdx * n;
    const r = rings[ringIdx];
    const ringSign = Math.sign(projArea(r, null));
    const tris = capTriangles(r);
    // Ear-clipping output is consistently wound: compare its total signed area once
    const triSign = Math.sign(tris.reduce((acc, t) => acc + projArea(r, t), 0));
    const keep = (triSign === ringSign) === followRing;
    tris.forEach(t => {
      const [i0, i1, i2] = keep ? t : [t[0], t[2], t[1]];
      idx.push(base + i0, base + i1, base + i2);
    });
  };
  addCap(0, flipSides);
  addCap(rings.length - 1, !flipSides);

  // Drop zero-area triangles (collapsed pocket vertices, duplicate stations at
  // pocket end walls). Neighbouring faces share those edges, so the mesh stays closed.
  const same = (i: number, j: number) =>
    Math.abs(pos[i * 3] - pos[j * 3]) < 1e-7 && Math.abs(pos[i * 3 + 1] - pos[j * 3 + 1]) < 1e-7 && Math.abs(pos[i * 3 + 2] - pos[j * 3 + 2]) < 1e-7;
  const clean: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [i0, i1, i2] = [idx[t], idx[t + 1], idx[t + 2]];
    if (same(i0, i1) || same(i1, i2) || same(i0, i2)) continue;
    clean.push(i0, i1, i2);
  }
  idx.length = 0;
  idx.push(...clean);
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3;
    vol += pos[A] * (pos[B + 1] * pos[C + 2] - pos[B + 2] * pos[C + 1])
      - pos[A + 1] * (pos[B] * pos[C + 2] - pos[B + 2] * pos[C])
      + pos[A + 2] * (pos[B] * pos[C + 1] - pos[B + 1] * pos[C]);
  }
  if (vol < 0) for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Mirror a geometry across X = 0, keeping faces outward. */
export function mirrorX(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.clone();
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  const index = g.getIndex()!;
  const arr = index.array as Uint32Array | Uint16Array;
  for (let t = 0; t < arr.length; t += 3) { const tmp = arr[t + 1]; arr[t + 1] = arr[t + 2]; arr[t + 2] = tmp; }
  index.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ───────────────────────── Keyholed airfoil outline ─────────────────────────

interface Hole { x: number; d: number } // chord fraction, hole diameter (mm)
/** Pocket cut into one skin: chord fractions a..b, depth in mm (0 = inactive at this station). */
interface Notch { a: number; b: number; d: number }

/**
 * Pocket for a component (servo, battery, ESC, receiver), in mm.
 * - part 'wing': open on the upper or lower skin of the RIGHT wing (mirrored
 *   to the left). xa..xb = span range, sa..sb = station range, depth from the skin.
 * - part 'fuselage': open on top. sa..sb = station range, halfWidth, floorY (absolute).
 */
export interface Pocket {
  id: string;
  part: 'wing' | 'fuselage';
  side: 'upper' | 'lower' | 'top';
  xa: number; xb: number;
  sa: number; sb: number;
  depth: number;
  halfWidth?: number;
  floorY?: number;
}

/**
 * Airfoil section between chord fractions x0..x1 at a given chord (mm), as a
 * closed outline (u along chord from the LE, v up), with keyhole spar holes
 * and optional pockets (notches) in the upper/lower skin. The vertex count
 * depends only on the NUMBER of holes/notches, never on the chord or on
 * whether a notch is active, so consecutive stations can always be lofted.
 */
function sectionOutline(
  af: AirfoilSurface, x0: number, x1: number, chord: number, holes: Hole[],
  upper: Notch[], lower: Notch[], s: PrintSettings,
): V2[] {
  const yU = (x: number) => {
    const u = af.upper(x) * chord, l = af.lower(x) * chord;
    return u - l < s.minTe ? (u + l) / 2 + s.minTe / 2 : u;
  };
  const yL = (x: number) => {
    const u = af.upper(x) * chord, l = af.lower(x) * chord;
    return u - l < s.minTe ? (u + l) / 2 - s.minTe / 2 : l;
  };
  const SKIN = 1.2; // mm kept on the opposite skin under a pocket
  const NSEG = 12, NARC = 20, NFLOOR = 6;
  const out: V2[] = [];
  const push = (x: number, y: number) => out.push([x * chord, y]);

  // ── Upper surface, LE → TE, with notches ──
  let cur = x0;
  let first = true;
  const seg = (from: number, to: number, f: (x: number) => number, skipFirst: boolean) => {
    chordSamples(from, to, upper.length ? NSEG : 28).forEach((x, i) => { if (!(skipFirst && i === 0)) push(x, f(x)); });
  };
  upper.slice().sort((p, q) => p.a - q.a).forEach(n => {
    seg(cur, n.a, yU, !first);
    first = false;
    for (let i = 0; i < NFLOOR; i++) {
      const x = n.a + ((n.b - n.a) * i) / (NFLOOR - 1);
      push(x, n.d > 0 ? Math.max(yU(x) - n.d, Math.min(yU(x), yL(x) + SKIN)) : yU(x));
    }
    push(n.b, yU(n.b));
    cur = n.b;
  });
  seg(cur, x1, yU, !first);

  // ── Lower surface, TE → LE, with keyholes and notches ──
  const g = s.slit / 2 / chord;
  type Feat = { hi: number; lo: number; emit: () => void; endsOnSurface: boolean };
  const feats: Feat[] = [];
  holes.forEach(h => feats.push({
    hi: h.x + g, lo: h.x - g,
    emit: () => {
      const hx = h.x * chord;
      const hy = (af.upper(h.x) + af.lower(h.x)) / 2 * chord;
      const r = h.d / 2;
      const gAbs = Math.min(s.slit / 2, r * 0.9);
      const th0 = -Math.PI / 2 + Math.asin(gAbs / r);
      const th1 = (3 * Math.PI) / 2 - Math.asin(gAbs / r);
      for (let i = 0; i < NARC; i++) {
        const th = th0 + ((th1 - th0) * i) / (NARC - 1);
        out.push([hx + r * Math.cos(th), hy + r * Math.sin(th)]);
      }
    },
    endsOnSurface: false,
  }));
  lower.forEach(n => feats.push({
    hi: n.b, lo: n.a,
    emit: () => {
      for (let i = 0; i < NFLOOR; i++) {
        const x = n.b - ((n.b - n.a) * i) / (NFLOOR - 1);
        push(x, n.d > 0 ? Math.min(yL(x) + n.d, Math.max(yL(x), yU(x) - SKIN)) : yL(x));
      }
      push(n.a, yL(n.a));
    },
    endsOnSurface: true,
  }));
  feats.sort((p, q) => q.hi - p.hi);
  let from = x1;
  let skipFirst = true; // the TE point was already emitted by the upper run
  feats.forEach(ft => {
    chordSamples(ft.hi, from, NSEG).reverse().forEach((x, i) => { if (!(i === 0 && skipFirst)) push(x, yL(x)); });
    ft.emit();
    skipFirst = ft.endsOnSurface;
    from = ft.lo;
  });
  chordSamples(x0, from, NSEG).reverse().forEach((x, i) => {
    if (i === 0 && skipFirst) return;
    if (x === x0 && Math.abs(yU(x0) - yL(x0)) < 1e-6) return; // sharp LE: avoid a duplicate point
    push(x, yL(x));
  });
  return out;
}

function keyholeOutline(af: AirfoilSurface, x0: number, x1: number, chord: number, holes: Hole[], s: PrintSettings): V2[] {
  return sectionOutline(af, x0, x1, chord, holes, [], [], s);
}

/** Largest standard rod that leaves WALL mm of material in a thickness t (mm). */
function pickRod(t: number, max = 12): number {
  const fits = ROD_SIZES.filter(d => d <= max && d + 2 * WALL + 0.3 <= t * 0.75);
  return fits.length ? fits[fits.length - 1] : 0;
}

// ───────────────────────── Plan builder ─────────────────────────

/** Evenly splits [a,b] into pieces no longer than maxLen (given the length of [a,b]). */
function splits(a: number, b: number, lengthMm: number, maxLen: number): number[] {
  const n = Math.max(1, Math.ceil(lengthMm / maxLen - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

export function buildPrintPlan(L: Layout, airfoil: AirfoilSpec, settings: PrintSettings = DEFAULT_PRINT_SETTINGS, pockets: Pocket[] = []): PrintPlan {
  const mm = L.toCm * 10; // layout unit → mm
  const s = settings;
  const maxLen = Math.max(s.bedZ - 5, 20);
  const kit = !!s.kit;
  const tailCl = s.clearance * TAIL_CL_FACTOR;
  const sections: PrintSection[] = [];
  const spars: SparSpec[] = [];
  const sparLines: PrintPlan['sparLines'] = [];
  const warnings: PrintPlan['warnings'] = [];
  const wingAf = getAirfoil(airfoil);
  const tailAf = getAirfoil('sym_tail');
  const w = L.wing;
  const a = L.aileron;

  // Wing functions in mm
  const halfSpan = w.halfSpan * mm;
  const chordAt = (f: number) => w.chordAt(f) * mm;
  const leAt = (f: number) => w.leAt(f) * mm;
  const yAt = (f: number) => w.yAt(f) * mm;

  // ── Spars: size from the thinnest station they pass through (the tip) ──
  const hinge = 1 - a.chordFrac;
  const mainX = 0.28;
  const rearX = Math.min(0.62, hinge - 0.1);
  const thick = (af: AirfoilSurface, x: number, chord: number) => (af.upper(x) - af.lower(x)) * chord;
  // Cap by size class: ~6 mm up to 1 m span, 8 mm up to 1.5 m, 10 mm above
  const mainCap = halfSpan * 2 <= 1000 ? 6 : halfSpan * 2 <= 1500 ? 8 : 10;
  const mainD = pickRod(thick(wingAf, mainX, chordAt(1)), mainCap);
  const rearD = rearX > mainX + 0.15 ? Math.min(pickRod(thick(wingAf, rearX, chordAt(1)), 4), Math.max(mainD - 2, 0)) : 0;
  let mainStart = 0, rearStart = 0; // set below, once the spar lines are known
  /** Spar holes of a section between chord fractions x0..x1 that starts at span fraction fa. */
  const wingHoles = (x0: number, x1: number, fa = 1): Hole[] => {
    const hs: Hole[] = [];
    if (mainD && fa >= mainStart - 1e-6 && mainX > x0 + 0.05 && mainX < x1 - 0.05) hs.push({ x: mainX, d: mainD + s.clearance });
    if (rearD && fa >= rearStart - 1e-6 && rearX > x0 + 0.05 && rearX < x1 - 0.05) hs.push({ x: rearX, d: rearD + s.clearance });
    return hs;
  };
  const sparPt = (x: number, f: number): [number, number, number] =>
    [f * halfSpan, yAt(f) + (wingAf.upper(x) + wingAf.lower(x)) / 2 * chordAt(f), leAt(f) + x * chordAt(f)];
  // Spars stop at the wall of a centre bay they would otherwise cross
  const startOf = (x: number, d: number) => (d ? sparStartFraction({ d: d + s.clearance, a: sparPt(x, 0), b: sparPt(x, 1) }, pockets, halfSpan) : 0);
  mainStart = startOf(mainX, mainD);
  rearStart = startOf(rearX, rearD);
  const sparLen = (x: number, f0: number) => {
    const [a0, b0] = [sparPt(x, f0), sparPt(x, 1)];
    return Math.round(Math.hypot(b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]));
  };
  if (mainD) sparLines.push({ id: 'main', d: mainD, a: sparPt(mainX, mainStart), b: sparPt(mainX, 1), mirror: true });
  if (rearD) sparLines.push({ id: 'rear', d: rearD, a: sparPt(rearX, rearStart), b: sparPt(rearX, 1), mirror: true });
  if (mainD) spars.push({ id: 'main', part: 'spar_main', diameter: mainD, length: sparLen(mainX, mainStart), count: 2 });
  else warnings.push({ key: 'stl_warn_no_spar' });
  if (rearD) spars.push({ id: 'rear', part: 'spar_rear', diameter: rearD, length: sparLen(rearX, rearStart), count: 2 });
  if (mainStart > 0 || rearStart > 0) warnings.push({ key: 'stl_info_spar_bays', params: { mm: Math.round(Math.max(mainStart, rearStart) * halfSpan) } });

  // ── Wing halves ──
  type X1 = number | ((f: number) => number);
  const wingPieces: { f0: number; f1: number; x0: number; x1: X1; kind: PrintKind; label: string }[] = [];
  if (a.f0 > 0.001) {
    if (L.teCut) {
      // Root trailing-edge notch for the pusher propeller (Zagi style)
      const fc = Math.min((L.teCut.halfWidth * mm) / halfSpan, a.f0);
      const sCut = L.teCut.sCut * mm;
      wingPieces.push({ f0: 0, f1: fc, x0: 0, x1: (f: number) => (sCut - leAt(f)) / chordAt(f), kind: 'wing', label: 'wing' });
      if (fc < a.f0 - 1e-4) wingPieces.push({ f0: fc, f1: a.f0, x0: 0, x1: 1, kind: 'wing', label: 'wing' });
    } else {
      wingPieces.push({ f0: 0, f1: a.f0, x0: 0, x1: 1, kind: 'wing', label: 'wing' });
    }
  }
  wingPieces.push({ f0: a.f0, f1: a.f1, x0: 0, x1: hinge - GAP / 2, kind: 'wing', label: 'wing' });
  if (a.f1 < 0.999) wingPieces.push({ f0: a.f1, f1: 1, x0: 0, x1: 1, kind: 'wing', label: 'wing' });
  // A section boundary where each spar starts, so the sections inboard of it have no spar hole
  [mainStart, rearStart].filter(f => f > 0).sort((p, q) => p - q).forEach(fc => {
    const i = wingPieces.findIndex(pc => fc > pc.f0 + 1e-4 && fc < pc.f1 - 1e-4);
    if (i >= 0) {
      const pc = wingPieces[i];
      wingPieces.splice(i, 1, { ...pc, f1: fc }, { ...pc, f0: fc });
    }
  });

  // Fit-test kit: only the wing root, long enough for the joiner plate and the spar start
  let kitF = 1;
  if (kit) {
    const joiner = pockets.find(p => p.id === 'joiner');
    kitF = Math.min(0.5, Math.max(KIT_LEN + 10, (joiner ? joiner.xb + 8 : 0), Math.max(mainStart, rearStart) * halfSpan + KIT_LEN) / halfSpan);
    for (let i = wingPieces.length - 1; i >= 0; i--) {
      if (wingPieces[i].f0 >= kitF - 1e-6) wingPieces.splice(i, 1);
      else wingPieces[i] = { ...wingPieces[i], f1: Math.min(wingPieces[i].f1, kitF) };
    }
  }

  // Longest chord that fits the bed standing up (straight, or diagonally with its thickness)
  const bedMin = Math.min(s.bedX, s.bedY) - 4, bedMax = Math.max(s.bedX, s.bedY) - 4;
  const maxChordFit = Math.max(bedMax, (Math.SQRT2 * bedMin) / (1 + wingAf.thickness * 1.1));
  let chordSplit = false;

  // ── Pockets in the wing skins (servos, and on a flying wing the battery/ESC/RX bays) ──
  const wingPockets = pockets.filter(p => p.part === 'wing').sort((p, q) => p.sa - q.sa);
  const toNotch = (p: Pocket, f: number, x0: number, x1: number, holes: Hole[], active: boolean): Notch => {
    const c = chordAt(f), le = leAt(f);
    let na = (p.sa - le) / c, nb = (p.sb - le) / c;
    const lo = x0 + 0.02, hi = x1 - 0.02;
    na = Math.max(na, lo); nb = Math.min(nb, hi);
    holes.forEach(h => {
      const m = (h.d / 2 + 1.5) / c;
      if (h.x + m > na && h.x - m < nb) {
        if (h.x < (na + nb) / 2) na = Math.max(na, h.x + m); else nb = Math.min(nb, h.x - m);
      }
    });
    if (nb - na < 0.01) { const mid = Math.min(Math.max((na + nb) / 2, lo), hi); return { a: mid, b: mid + 0.001, d: 0 }; }
    return { a: na, b: nb, d: active ? p.depth : 0 };
  };
  /** Rings for a wing section fa..fb / chord x0..x1, stepping in and out of pockets. */
  const wingRings = (fa: number, fb: number, x0: number, x1f: X1, holes: Hole[]): V3[][] => {
    const H = halfSpan;
    const X1 = (f: number) => (typeof x1f === 'function' ? x1f(f) : x1f);
    const x1 = Math.min(X1(fa), X1(fb));
    const mine = wingPockets.filter(p => p.xb > fa * H && p.xa < fb * H && (() => {
      const f = Math.min(Math.max(((p.xa + p.xb) / 2) / H, fa), fb);
      const c = chordAt(f), le = leAt(f);
      return (p.sb - le) / c > x0 + 0.02 && (p.sa - le) / c < x1 - 0.02;
    })());
    const ups = mine.filter(p => p.side === 'upper');
    const los = mine.filter(p => p.side === 'lower');
    // Breakpoints where a pocket starts/ends inside this section
    const bps = [fa, fb];
    mine.forEach(p => [p.xa / H, p.xb / H].forEach(f => { if (f > fa + 1e-6 && f < fb - 1e-6) bps.push(f); }));
    bps.sort((p, q) => p - q);
    const uniq = bps.filter((f, i) => i === 0 || f - bps[i - 1] > 1e-6);
    const activeAt = (p: Pocket, fm: number) => fm * H > p.xa && fm * H < p.xb;
    const ring = (f: number, fm: number) => sectionOutline(
      wingAf, x0, X1(f), chordAt(f), holes,
      ups.map(p => toNotch(p, f, x0, X1(f), holes, activeAt(p, fm))),
      los.map(p => toNotch(p, f, x0, X1(f), holes, activeAt(p, fm))),
      s,
    ).map(([u, v]) => [f * H, yAt(f) + v, -(leAt(f) + u)] as V3);
    // Duplicate a station only where the set of active pockets changes (pocket end walls)
    const key = (fm: number) => mine.map(p => (activeAt(p, fm) ? 1 : 0)).join('');
    const rings: V3[][] = [];
    for (let i = 0; i < uniq.length - 1; i++) {
      const fm = (uniq[i] + uniq[i + 1]) / 2;
      if (i === 0) rings.push(ring(uniq[0], fm));
      else if (key(fm) !== key((uniq[i - 1] + uniq[i]) / 2)) rings.push(ring(uniq[i], fm));
      rings.push(ring(uniq[i + 1], fm));
    }
    return rings;
  };

  let wingIdx = 0;
  wingPieces.forEach(pc => {
    // Standing on its root face, a swept section's footprint is its chord plus
    // the sweep over its height: add span-wise cuts until it fits the bed
    const x1At = (f: number) => (typeof pc.x1 === 'function' ? pc.x1(f) : pc.x1);
    const footprint = (fa: number, fb: number) => {
      const lo = Math.min(leAt(fa) + pc.x0 * chordAt(fa), leAt(fb) + pc.x0 * chordAt(fb));
      const hi = Math.max(leAt(fa) + x1At(fa) * chordAt(fa), leAt(fb) + x1At(fb) * chordAt(fb));
      return hi - lo;
    };
    let nSpan = Math.max(1, Math.ceil(((pc.f1 - pc.f0) * halfSpan) / maxLen - 1e-9));
    const worst = (n: number) => Math.max(...Array.from({ length: n }, (_, i) =>
      footprint(pc.f0 + ((pc.f1 - pc.f0) * i) / n, pc.f0 + ((pc.f1 - pc.f0) * (i + 1)) / n)));
    while (nSpan < 12 && worst(nSpan) > maxChordFit && worst(nSpan + 1) < worst(nSpan) - 1) nSpan++;
    const fs = Array.from({ length: nSpan + 1 }, (_, i) => pc.f0 + ((pc.f1 - pc.f0) * i) / nSpan);
    for (let i = 0; i < fs.length - 1; i++) {
      wingIdx++;
      // Chord-wise split when the section's longest chord does not fit the bed
      const x1Of = (f: number) => (typeof pc.x1 === 'function' ? pc.x1(f) : pc.x1);
      const x1Here = x1Of(fs[i]);
      const usedChord = Math.max(chordAt(fs[i]) * (x1Here - pc.x0), footprint(fs[i], fs[i + 1]));
      const nC = Math.ceil(usedChord / maxChordFit - 1e-9);
      let xs = Array.from({ length: nC + 1 }, (_, k) => pc.x0 + ((x1Here - pc.x0) * k) / nC);
      if (nC > 1) {
        chordSplit = true;
        // Keep cuts at least 6% chord away from the spar holes
        const holeXs = [mainD ? mainX : -1, rearD ? rearX : -1].filter(x => x > 0);
        xs = xs.map((x, k) => {
          if (k === 0 || k === xs.length - 1) return x;
          const near = holeXs.find(h => Math.abs(h - x) < 0.06);
          return near === undefined ? x : (x < near ? near - 0.06 : near + 0.06);
        });
      }
      const len = (fs[i + 1] - fs[i]) * halfSpan;
      for (let k = 0; k < xs.length - 1; k++) {
        const last = k === xs.length - 2;
        const hiX: X1 = last ? pc.x1 : xs[k + 1];
        const holes = wingHoles(xs[k], last ? Math.min(x1Of(fs[i]), x1Of(fs[i + 1])) : xs[k + 1], fs[i]);
        const rings = wingRings(fs[i], fs[i + 1], xs[k], hiX, holes);
        const geo = loftSolid(rings);
        const suffix = xs.length > 2 ? String.fromCharCode(97 + k) : '';
        sections.push({ name: `wing_R_${pad(wingIdx)}${suffix}`, kind: 'wing', side: 'R', index: wingIdx, axis: [1, 0, 0], geometry: geo, length: len });
        sections.push({ name: `wing_L_${pad(wingIdx)}${suffix}`, kind: 'wing', side: 'L', index: wingIdx, axis: [-1, 0, 0], geometry: mirrorX(geo), length: len });
      }
    }
  });
  if (chordSplit) warnings.push({ key: 'stl_info_chord_split', params: { max: Math.round(maxChordFit) } });

  // ── Ailerons / elevons ──
  if (!kit) {
    const spanGap = Math.min(0.004, (a.f1 - a.f0) * 0.02);
    const fs = splits(a.f0 + spanGap, a.f1 - spanGap, (a.f1 - a.f0) * halfSpan, maxLen);
    for (let i = 0; i < fs.length - 1; i++) {
      const rings = [fs[i], fs[i + 1]].map(f => keyholeOutline(wingAf, hinge + GAP / 2, 1, chordAt(f), [], s)
        .map(([u, v]) => [f * halfSpan, yAt(f) + v, -(leAt(f) + u)] as V3));
      const geo = loftSolid(rings);
      const len = (fs[i + 1] - fs[i]) * halfSpan;
      sections.push({ name: `${L.isFW ? 'elevon' : 'aileron'}_R_${pad(i + 1)}`, kind: 'aileron', side: 'R', index: i + 1, axis: [1, 0, 0], geometry: geo, length: len });
      sections.push({ name: `${L.isFW ? 'elevon' : 'aileron'}_L_${pad(i + 1)}`, kind: 'aileron', side: 'L', index: i + 1, axis: [-1, 0, 0], geometry: mirrorX(geo), length: len });
    }
  }

  // ── Horizontal stabiliser + elevator ──
  if (L.hStab) {
    const h = L.hStab;
    const hs = (h.span / 2) * mm;
    const hc = h.rootChord * mm;
    const hLe = h.leS * mm;
    const hy = h.y * mm;
    const eh = 1 - h.hingeFrac;
    const hasElev = h.hingeFrac > 0.001;
    const tailD = pickRod(thick(tailAf, 0.3, hc), 4);
    const holes: Hole[] = tailD ? [{ x: 0.3, d: tailD + s.clearance }] : [];
    if (tailD) {
      spars.push({ id: 'tail', part: 'spar_tail', diameter: tailD, length: Math.round(hs * 2 * 0.9), count: 1 });
      sparLines.push({ id: 'tail', d: tailD, a: [-hs * 0.9, hy, hLe + 0.3 * hc], b: [hs * 0.9, hy, hLe + 0.3 * hc], mirror: false });
    }
    const pieces: [number, number, PrintKind, string][] = [[0, hasElev ? eh - GAP / 2 : 1, 'hstab', 'hstab']];
    if (hasElev) pieces.push([eh + GAP / 2, 1, 'elevator', 'elevator']);
    pieces.forEach(([x0, x1, kind, label]) => {
      if (kit && kind === 'elevator') return;
      const f0 = 0; // elevator halves are glued into one piece at the centre
      const fs = kit ? [0, Math.min(1, KIT_LEN / hs)] : splits(f0, 1, hs, maxLen);
      for (let i = 0; i < fs.length - 1; i++) {
        const rings = [fs[i], fs[i + 1]].map(f => keyholeOutline(tailAf, x0, x1, hc, kind === 'hstab' ? holes : [], s)
          .map(([u, v]) => [f * hs, hy + v, -(hLe + u)] as V3));
        const geo = loftSolid(rings);
        const len = (fs[i + 1] - fs[i]) * hs;
        sections.push({ name: `${label}_R_${pad(i + 1)}`, kind, side: 'R', index: i + 1, axis: [1, 0, 0], geometry: geo, length: len });
        sections.push({ name: `${label}_L_${pad(i + 1)}`, kind, side: 'L', index: i + 1, axis: [-1, 0, 0], geometry: mirrorX(geo), length: len });
      }
    });
  }

  // ── Tail fit: the stab is sandwiched between a lower and an upper tail piece
  //    whose faces follow its airfoil; the fin root sinks into a slot on top ──
  const fexpo = L.fuselage ? L.fuselage.expo : 2;
  const fsec = (sm: number) => {
    const q = L.fuselage!.section(Math.min(Math.max(sm, 0), L.fuselage!.length * mm) / mm);
    return { W: q.w * mm, H: q.h * mm, yc: q.yc * mm };
  };
  let tailFit: TailFit | null = null;
  let cavity: ((sm: number, inStab: boolean) => [number, number]) | null = null;
  let finSlot: { s0: number; s1: number; hw: number; floor: number } | null = null;
  if (L.fuselage && L.hStab && L.fin) {
    const h = L.hStab, f = L.fin;
    const Lmm = L.fuselage.length * mm;
    const hLe = h.leS * mm, hc = h.rootChord * mm, hy = h.y * mm;
    const fLe = f.leS * mm, fc = f.rootChord * mm, fy = f.y * mm;
    const feh = f.hingeFrac > 0.001 ? 1 - f.hingeFrac - GAP / 2 : 1;
    const sTail = Math.min(hLe, fLe) - TAIL_MARGIN;
    const bayInTail = pockets.some(p => p.part === 'fuselage' && p.sb > sTail - PIN_LEN);
    if (!bayInTail && sTail > Lmm * 0.4 && Lmm - sTail > 40 && hLe + hc * 0.3 < Lmm) {
      let squeezed = false;
      cavity = (sm, inStab) => {
        if (!inStab) return [hy, hy];
        const u = Math.min(Math.max((sm - hLe) / hc, 0), 1);
        const q = fsec(sm);
        const cl = tailCl * Math.min(1, (sm - hLe) / 2); // ramps in, so the faces stay continuous at the LE
        const lo0 = hy + tailAf.lower(u) * hc - cl;
        const up0 = hy + tailAf.upper(u) * hc + cl;
        const lo = Math.max(lo0, q.yc - q.H / 2 + TAIL_WALL);
        const up = Math.min(up0, q.yc + q.H / 2 - TAIL_WALL);
        if (lo > lo0 + 0.3 || up < up0 - 0.3) squeezed = true;
        return [Math.min(lo, hy), Math.max(up, hy)];
      };
      // Fin slot: as deep as FIN_TAB, keeping a wall above the stab cavity
      const s0 = fLe - tailCl, s1 = fLe + feh * fc + tailCl;
      let depth = FIN_TAB;
      for (let k = 0; k <= 20; k++) {
        const sm = s0 + ((s1 - s0) * k) / 20;
        const inStab = sm >= hLe && sm <= hLe + hc;
        depth = Math.min(depth, fy - cavity(sm, inStab)[1] - TAIL_WALL);
      }
      if (depth >= 3) finSlot = { s0, s1, hw: (tailAf.thickness * fc) / 2 + tailCl, floor: fy - depth };
      // Probe the cavity once so a squeezed stab is reported
      for (let k = 0; k <= 30; k++) cavity(hLe + (hc * k) / 30, true);
      if (squeezed) warnings.push({ key: 'stl_warn_tail_thin' });
      tailFit = { sTail, finTab: finSlot ? Math.round(depth * 10) / 10 : 0 };
    }
  }

  // ── Fin + rudder ──
  if (L.fin) {
    const f = L.fin;
    const H = f.span * mm, fc = f.rootChord * mm, fLe = f.leS * mm, fy = f.y * mm;
    const hasRud = f.hingeFrac > 0.001;
    const eh = 1 - f.hingeFrac;
    const finD = pickRod(thick(tailAf, 0.3, fc), 3);
    if (finD) {
      spars.push({ id: 'fin', part: 'spar_fin', diameter: finD, length: Math.round(H * 0.9), count: 1 });
      sparLines.push({ id: 'fin', d: finD, a: [0, fy + 0.05 * H, fLe + 0.3 * fc], b: [0, fy + 0.95 * H, fLe + 0.3 * fc], mirror: false });
    }
    const pieces: [number, number, PrintKind][] = [[0, hasRud ? eh - GAP / 2 : 1, 'fin']];
    if (hasRud) pieces.push([eh + GAP / 2, 1, 'rudder']);
    pieces.forEach(([x0, x1, kind]) => {
      // The fin root continues down into its slot on top of the tail; a
      // cruciform tail also prints the ventral extension below the fuselage.
      const ventralMm = (f.ventral ?? 0) * mm;
      const t0 = kind === 'rudder' ? 0.02 : -((tailFit?.finTab ?? 0) + ventralMm) / H;
      if (kit && kind === 'rudder') return;
      const ts = kit ? [t0, Math.min(1, KIT_LEN / H)] : splits(t0, 1, H, maxLen);
      for (let i = 0; i < ts.length - 1; i++) {
        const holes = kind === 'fin' && finD ? [{ x: 0.3, d: finD + s.clearance }] : [];
        const rings = [ts[i], ts[i + 1]].map(t => keyholeOutline(tailAf, x0, x1, fc, holes, s)
          .map(([u, v]) => [v, fy + t * H, -(fLe + u)] as V3));
        sections.push({ name: `${kind}_${pad(i + 1)}`, kind, side: 'C', index: i + 1, axis: [0, 1, 0], geometry: loftSolid(rings), length: (ts[i + 1] - ts[i]) * H });
      }
    });
  }

  // ── Winglets ──
  if (L.winglet && L.winglet.span > 0 && !kit) {
    const g = L.winglet;
    const H = g.span * mm;
    const le = (t: number) => (g.leS + g.sweep * t) * mm;
    const ch = (t: number) => (g.rootChord + (g.tipChord - g.rootChord) * t) * mm;
    const base = g.y * mm;
    const ts = splits(0, 1, H, maxLen);
    for (let i = 0; i < ts.length - 1; i++) {
      const rings = [ts[i], ts[i + 1]].map(t => keyholeOutline(tailAf, 0, 1, ch(t), [], s)
        .map(([u, v]) => [halfSpan + v, base + t * H, -(le(t) + u)] as V3));
      const geo = loftSolid(rings);
      sections.push({ name: `winglet_R_${pad(i + 1)}`, kind: 'winglet', side: 'R', index: i + 1, axis: [0, 1, 0], geometry: geo, length: (ts[i + 1] - ts[i]) * H });
      sections.push({ name: `winglet_L_${pad(i + 1)}`, kind: 'winglet', side: 'L', index: i + 1, axis: [0, 1, 0], geometry: mirrorX(geo), length: (ts[i + 1] - ts[i]) * H });
    }
  }

  // ── Fuselage (printed standing, split along its length), with open-top bays,
  //    alignment pins across the joints and the two-piece tail ──
  let pinsOut: PrintPlan['pins'] = null;
  if (L.fuselage) {
    const fz = L.fuselage;
    const Lmm = fz.length * mm;
    const expo = fexpo;
    const bays = pockets.filter(p => p.part === 'fuselage').sort((p, q) => p.sa - q.sa);
    const NTOP = 6, NFLOOR = 8, NLOW = 6, NSIDE = 10, NARC = 16, NCUT = 10;
    const g = s.slit / 2;
    const se = (th: number, W: number, Hh: number, yc: number): V2 => {
      const c = Math.cos(th), sn = Math.sin(th);
      return [(W / 2) * Math.sign(c) * Math.abs(c) ** (2 / expo), yc + (Hh / 2) * Math.sign(sn) * Math.abs(sn) ** (2 / expo)];
    };
    const halfH = (x: number, W: number, Hh: number) => (Hh / 2) * Math.max(0, 1 - Math.abs((2 * x) / W) ** expo) ** (1 / expo);
    /** Angle of the lower-right / lower-left outline point at |x|. */
    const thR = (x: number, W: number) => -Math.acos(Math.min(Math.max((2 * x) / W, 0), 0.999) ** (expo / 2));
    const thL = (x: number, W: number) => Math.PI + Math.acos(Math.min(Math.max((2 * x) / W, 0), 0.999) ** (expo / 2));
    /** Angle of the right outline point at height y. */
    const thY = (y: number, Hh: number, yc: number) => {
      const v = Math.min(Math.max((y - yc) / (Hh / 2), -0.97), 0.97);
      return Math.sign(v) * Math.asin(Math.abs(v) ** (expo / 2));
    };

    // Joints: the vase sections up to the tail, then the tail pieces
    const sEnd = tailFit ? tailFit.sTail : Lmm;
    const cuts = splits(0, sEnd, sEnd, maxLen);
    const joints = cuts.slice(1, -1).concat(tailFit ? [tailFit.sTail] : []);

    // ── Alignment pins: two per joint, in the lower corners (outside the bays) ──
    const Wmin = Math.min(...joints.map(j => fsec(j).W), 1e9);
    const pinD = Wmin < 45 ? 2 : 3;
    const pr = (pinD + s.clearance) / 2;
    const PH = PIN_LEN / 2 + 2;
    const rC = 0.5; // between pins the channel shrinks to a 1 mm keyhole (a thin internal web in vase mode)
    type Zone = { s: number; x: number; y: number };
    const zones: Zone[] = [];
    joints.forEach(sj => {
      const st = Array.from({ length: 9 }, (_, k) => sj - PH + (2 * PH * k) / 8);
      const minW = Math.min(...st.map(v => fsec(v).W));
      for (let frac = 0.84; frac >= 0.3; frac -= 0.01) {
        const x = (frac * minW) / 2;
        const y0 = Math.max(...st.map(v => { const q = fsec(v); return q.yc - halfH(x, q.W, q.H); })) + pr + 1.6;
        // Round sections: the circle may need to sit a little higher than straight above the skin
        const fitsAt = (y: number) => st.every(v => {
          const q = fsec(v);
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2, rr = pr + 1.2;
            const px = x + rr * Math.cos(a), py = y + rr * Math.sin(a);
            if (Math.abs((2 * px) / q.W) ** expo + Math.abs((2 * (py - q.yc)) / q.H) ** expo > 1) return false;
          }
          const bay = bays.find(b => v > b.sa - 1 && v < b.sb + 1);
          if (bay && x - pr - 1.4 < (bay.halfWidth ?? 0) && y + pr + 1.4 > (bay.floorY ?? -1e9)) return false;
          if (tailFit && cavity && v > tailFit.sTail - 0.5 && y + pr + 1.2 > cavity(v, false)[0]) return false;
          return true;
        });
        const y = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6].map(d => y0 + d).find(fitsAt);
        const ok = y !== undefined;
        if (ok) { zones.push({ s: sj, x, y: y! }); break; }
      }
    });
    if (zones.length < joints.length) warnings.push({ key: 'stl_warn_fuse_pin' });
    if (zones.length) {
      pinsOut = { d: pinD, length: PIN_LEN, joints: zones.map(z => Math.round(z.s)) };
      spars.push({ id: 'fuse_pin', part: 'spar_fuse_pin', diameter: pinD, length: PIN_LEN, count: zones.length * 2, s: zones.reduce((a, z) => a + z.s, 0) / zones.length, y: zones[0].y });
      zones.forEach((z, i) => sparLines.push({ id: `pin_${i + 1}`, d: pinD, a: [z.x, z.y, z.s - PIN_LEN / 2], b: [z.x, z.y, z.s + PIN_LEN / 2], mirror: true }));
    }
    /** Pin channel at a station: full inside a pin zone, closing over PIN_TAPER, a vanishing hole elsewhere. */
    const pinAt = (sm: number, W: number, Hh: number, yc: number): { x: number; y: number; r: number } => {
      const sorted = zones.slice().sort((p, q) => p.s - q.s);
      let x: number;
      if (!sorted.length) x = W * 0.25;
      else if (sm <= sorted[0].s) x = sorted[0].x;
      else if (sm >= sorted[sorted.length - 1].s) x = sorted[sorted.length - 1].x;
      else {
        const k = sorted.findIndex(z => z.s > sm);
        const p0 = sorted[k - 1], p1 = sorted[k];
        x = p0.x + ((p1.x - p0.x) * (sm - p0.s)) / (p1.s - p0.s);
      }
      const skin = (xx: number) => yc - halfH(xx, W, Hh);
      const inside = (cx: number, cy: number, rad: number) => {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          if (Math.abs((2 * (cx + rad * Math.cos(a))) / W) ** expo + Math.abs((2 * (cy + rad * Math.sin(a) - yc)) / Hh) ** expo > 1) return false;
        }
        return true;
      };
      // Narrow (tail) sections: move the small channel inwards until it sits inside the skin
      x = Math.min(x, W * 0.42);
      while (x > W * 0.12 && !inside(x, skin(x) + rC + 0.6, rC + 0.5)) x -= W * 0.02;
      const z = sorted.find(q => Math.abs(sm - q.s) <= PH + PIN_TAPER + 1e-6);
      const closed = { x, y: skin(x) + rC + 0.6, r: rC };
      if (!z) return closed;
      const d = Math.abs(sm - z.s);
      if (d <= PH + 1e-6) return { x: z.x, y: z.y, r: pr };
      const t = (d - PH) / PIN_TAPER;
      const cx = z.x + (x - z.x) * t;
      return { x: cx, y: z.y + (skin(cx) + rC + 0.6 - z.y) * t, r: pr + (rC - pr) * t };
    };
    /** Clockwise hole with its slit to the bottom skin (outline runs towards +x there). */
    const keyhole = (cx: number, cy: number, r: number): V2[] => {
      const al = Math.asin(Math.min(g / r, 0.999));
      const out: V2[] = [];
      for (let i = 0; i < NARC; i++) {
        const th = (3 * Math.PI) / 2 - al - ((2 * Math.PI - 2 * al) * i) / (NARC - 1);
        out.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
      }
      return out;
    };
    /** Bottom of a ring: right half from the bottom centre up to angle thTop (excl.), with the right pin channel. */
    const lowerRight = (W: number, Hh: number, yc: number, pin: { x: number; y: number; r: number }, thTop: number): V2[] => {
      const pts: V2[] = [];
      const tA = thR(pin.x - g, W), tB = thR(pin.x + g, W);
      for (let i = 0; i < NLOW; i++) pts.push(se(-Math.PI / 2 + ((tA + Math.PI / 2) * i) / (NLOW - 1), W, Hh, yc));
      pts.push(...keyhole(pin.x, pin.y, pin.r));
      for (let i = 0; i < NSIDE; i++) pts.push(se(tB + ((thTop - tB) * i) / NSIDE, W, Hh, yc));
      return pts;
    };
    /** Left half from angle thTop (excl.) down to the bottom centre (excl.), with the left pin channel. */
    const lowerLeft = (W: number, Hh: number, yc: number, pin: { x: number; y: number; r: number }, thTop: number): V2[] => {
      const pts: V2[] = [];
      const t0 = Math.PI - thTop, tC = thL(pin.x + g, W), tD = thL(pin.x - g, W);
      for (let i = 1; i <= NSIDE; i++) pts.push(se(t0 + ((tC - t0) * i) / NSIDE, W, Hh, yc));
      pts.push(...keyhole(-pin.x, pin.y, pin.r));
      for (let i = 0; i < NLOW - 1; i++) pts.push(se(tD + ((1.5 * Math.PI - tD) * i) / (NLOW - 1), W, Hh, yc));
      return pts;
    };
    /** Open-top notch (bay or fin slot) between two top angles; floor === null → no notch here. */
    const topNotch = (W: number, Hh: number, yc: number, xA: number, floor: number | null): V2[] => {
      const yTop = (x: number) => yc + halfH(x, W, Hh);
      const pts: V2[] = [[xA, yTop(xA)]];
      for (let i = 0; i < NFLOOR; i++) {
        const x = xA - (2 * xA * i) / (NFLOOR - 1);
        pts.push([x, floor === null ? yTop(x) : Math.min(floor, yTop(x))]);
      }
      pts.push([-xA, yTop(-xA)]);
      return pts;
    };

    /** Full cross-section ring of a vase section: bottom with pin channels, top with the bay notch. */
    const ring = (sMm: number, activeBay: Pocket | null): V3[] => {
      const { W, H: Hh, yc } = fsec(sMm);
      const pin = pinAt(sMm, W, Hh, yc);
      const hw = Math.min(activeBay?.halfWidth ?? Math.max(...bays.map(b => b.halfWidth ?? 10), 10), W / 2 - 1.5);
      const ratio = Math.min(Math.max((2 * hw) / W, 0.05), 0.95);
      const thA = Math.acos(ratio ** (expo / 2));
      const pts: V2[] = lowerRight(W, Hh, yc, pin, thA);
      if (bays.length) {
        const xA = se(thA, W, Hh, yc)[0];
        const yTopA = yc + halfH(xA, W, Hh);
        // The floor must stay above the bottom skin at the bay edges (round
        // sections rise towards the sides), otherwise the outline self-intersects
        const bottomAtEdge = yc - (yTopA - yc);
        const floor = activeBay ? Math.max(Math.min(activeBay.floorY ?? yc, yTopA - 1), bottomAtEdge + 1.2) : null;
        pts.push(...topNotch(W, Hh, yc, xA, floor));
      } else {
        for (let i = 0; i <= NTOP; i++) pts.push(se(thA + ((Math.PI - 2 * thA) * i) / NTOP, W, Hh, yc));
      }
      pts.push(...lowerLeft(W, Hh, yc, pin, thA));
      return pts.map(([x, y]) => [x, y, -sMm] as V3);
    };
    const bayAt = (sm: number) => bays.find(b => sm > b.sa && sm < b.sb) ?? null;
    const pinStations = (a0: number, b0: number) => zones.flatMap(z => [-PH - PIN_TAPER, -PH, PH, PH + PIN_TAPER].map(d => z.s + d)).filter(v => v > a0 + 0.5 && v < b0 - 0.5);
    // Fit-test kit: two short coupons around one pinned joint (or one ahead of the tail)
    let runs: [number, number, string][] = cuts.slice(0, -1).map((c, i) => [c, cuts[i + 1], `fuselage_${pad(i + 1)}`]);
    if (kit) {
      const inner = zones.filter(z => !tailFit || Math.abs(z.s - tailFit.sTail) > 1);
      const z = inner[0] ?? zones[0];
      const sj = z ? z.s : (tailFit ? tailFit.sTail : cuts[Math.floor(cuts.length / 2)]);
      runs = [[sj - KIT_FUSE, sj, 'fuselage_test_a']];
      if (!(tailFit && Math.abs(sj - tailFit.sTail) < 1)) runs.push([sj, sj + KIT_FUSE, 'fuselage_test_b']);
    }
    for (let i = 0; i < runs.length; i++) {
      const [ca, cb, runName] = runs[i];
      const nSt = kit ? 6 : 12;
      const st: number[] = [];
      for (let k = 0; k <= nSt; k++) st.push(ca + ((cb - ca) * k) / nSt);
      bays.forEach(b => [b.sa, b.sb].forEach(v => { if (v > ca + 0.5 && v < cb - 0.5) st.push(v); }));
      // Manual shape control points must become real rings, otherwise the print
      // would smooth them away (12 stations per run are not enough).
      const fuseLenMm = L.fuselage!.length * mm;
      L.fuselage!.stations.forEach(q => {
        const v = q.s * fuseLenMm;
        if (v > ca + 0.3 && v < cb - 0.3) st.push(v);
      });
      st.push(...pinStations(ca, cb));
      st.sort((p, q) => p - q);
      const uniq = st.filter((v, k) => k === 0 || v - st[k - 1] > 0.3);
      const rings: V3[][] = [];
      let prevBay: Pocket | null | undefined;
      for (let k = 0; k < uniq.length - 1; k++) {
        const bay = bayAt((uniq[k] + uniq[k + 1]) / 2);
        if (k === 0 || bay !== prevBay) rings.push(ring(uniq[k], bay));
        rings.push(ring(uniq[k + 1], bay));
        prevBay = bay;
      }
      sections.push({ name: runName, kind: 'fuselage', side: 'C', index: i + 1, axis: [0, 0, -1], geometry: loftSolid(rings), length: cb - ca });
    }

    // ── Tail pieces: lower (keel, pin channels at the front) and upper (fin slot) ──
    if (tailFit && cavity && L.hStab) {
      const hLe = L.hStab.leS * mm, hTe = hLe + L.hStab.rootChord * mm;
      const lowerRing = (sm: number, inStab: boolean): V3[] => {
        const { W, H: Hh, yc } = fsec(sm);
        const pin = pinAt(sm, W, Hh, yc);
        const c = cavity!(sm, inStab)[0];
        const thC = thY(c, Hh, yc);
        const xc = se(thC, W, Hh, yc)[0];
        const pts = lowerRight(W, Hh, yc, pin, thC);
        for (let i = 0; i <= NCUT; i++) pts.push([xc - (2 * xc * i) / NCUT, c]);
        pts.push(...lowerLeft(W, Hh, yc, pin, thC));
        return pts.map(([x, y]) => [x, y, -sm] as V3);
      };
      const upperRing = (sm: number, inStab: boolean, slot: boolean): V3[] => {
        const { W, H: Hh, yc } = fsec(sm);
        const c = cavity!(sm, inStab)[1];
        const thC = thY(c, Hh, yc);
        const xc = se(thC, W, Hh, yc)[0];
        const hw = Math.min(finSlot ? finSlot.hw : 3, W / 2 - 1.5);
        const thF = Math.max(Math.acos(Math.min(Math.max((2 * hw) / W, 0.05), 0.95) ** (expo / 2)), thC + 0.02);
        const xF = se(thF, W, Hh, yc)[0];
        const pts: V2[] = [];
        for (let i = 0; i < NSIDE; i++) pts.push(se(thC + ((thF - thC) * i) / NSIDE, W, Hh, yc));
        const floor = slot && finSlot ? Math.max(finSlot.floor, c + TAIL_WALL) : null;
        pts.push(...topNotch(W, Hh, yc, xF, floor));
        for (let i = 1; i <= NSIDE; i++) pts.push(se(Math.PI - thF + ((thF - thC) * i) / NSIDE, W, Hh, yc));
        for (let i = 1; i < NCUT; i++) pts.push([-xc + (2 * xc * i) / NCUT, c]);
        return pts.map(([x, y]) => [x, y, -sm] as V3);
      };
      const tcuts = splits(tailFit.sTail, Lmm, Lmm - tailFit.sTail, maxLen);
      const edges = [hLe, hLe + (1 - L.hStab.hingeFrac) * (hTe - hLe), hTe, ...(finSlot ? [finSlot.s0, finSlot.s1] : [])];
      for (let i = 0; i < tcuts.length - 1; i++) {
        const a0 = tcuts[i], b0 = tcuts[i + 1];
        const st: number[] = [];
        for (let k = 0; k <= 30; k++) st.push(a0 + ((b0 - a0) * k) / 30);
        // Walls (TE step, fin slot ends) as two stations 0.1 mm apart: no coincident rings
        edges.forEach(v => [v - 0.05, v + 0.05].forEach(e => { if (e > a0 + 0.3 && e < b0 - 0.3) st.push(e); }));
        st.push(...pinStations(a0, b0));
        st.sort((p, q) => p - q);
        const uniq = st.filter((v, k) => k === 0 || v - st[k - 1] > 0.02);
        const lo: V3[][] = [], up: V3[][] = [];
        uniq.forEach(v => {
          const inStab = v >= hLe && v <= hTe;
          const slot = !!finSlot && v > finSlot.s0 && v < finSlot.s1;
          lo.push(lowerRing(v, inStab));
          up.push(upperRing(v, inStab, slot));
        });
        const suffix = tcuts.length > 2 ? `_${pad(i + 1)}` : '';
        const idx = cuts.length + i;
        sections.push({ name: `fuselage_tail_lower${suffix}`, kind: 'fuselage', side: 'C', index: idx, axis: [0, 0, -1], geometry: loftSolid(lo), length: b0 - a0 });
        sections.push({ name: `fuselage_tail_upper${suffix}`, kind: 'fuselage', side: 'C', index: idx, axis: [0, 0, -1], geometry: loftSolid(up), length: b0 - a0 });
      }
    }
    // Manual shape edits can push a slice past the bed or pinch it thin, so the
    // checks use the real sections along the body instead of the nominal W/H.
    let maxW = 0, maxH = 0, minDim = Infinity;
    const LmmF = fz.length * mm;
    for (let sm = 0; sm <= LmmF; sm += 2) {
      const q = fz.section(sm / mm);
      maxW = Math.max(maxW, q.w * mm);
      maxH = Math.max(maxH, q.h * mm);
      minDim = Math.min(minDim, q.w * mm, q.h * mm);
    }
    if (maxW > Math.min(s.bedX, s.bedY) || maxH > Math.max(s.bedX, s.bedY)) {
      warnings.push({ key: 'stl_warn_fuse_bed' });
    }
    // Below ~12 mm a Ø6 pin plus walls no longer fits (2×1.2 wall + 6)
    if (fz.stations.length > 0 && minDim < 12) {
      warnings.push({ key: 'stl_warn_fuse_pinch', params: { mm: Math.round(minDim) } });
    }
  }

  if (kit) {
    // Short offcuts are enough to test the fits
    spars.forEach(sp => {
      if (sp.id === 'main' || sp.id === 'rear') sp.length = Math.max(20, Math.round((kitF - (sp.id === 'main' ? mainStart : rearStart)) * halfSpan - 5));
      else if (sp.id === 'tail') { sp.length = Math.round(KIT_LEN * 2 * 0.9); }
      else if (sp.id === 'fin') { sp.length = Math.round(KIT_LEN * 0.8); }
      if (sp.id === 'fuse_pin') sp.count = 2;
    });
  }
  return { sections, spars, sparLines, warnings, settings: s, tailFit, pins: pinsOut };
}

function pad(n: number) { return String(n).padStart(2, '0'); }

/**
 * Span fraction where a wing spar must start so it does not run through a
 * centre bay (flying-wing battery / ESC / receiver bays at the root). The spar
 * then stops at the bay's outboard wall; the joiner plate bridges the centre.
 */
export function sparStartFraction(line: { d: number; a: [number, number, number]; b: [number, number, number] }, pockets: Pocket[], halfSpanMm: number): number {
  let f0 = 0;
  const sAt = (x: number) => {
    const t = (x - line.a[0]) / Math.max(line.b[0] - line.a[0], 1e-6);
    return line.a[2] + (line.b[2] - line.a[2]) * t;
  };
  pockets.filter(p => p.part === 'wing' && p.xa <= 1).forEach(p => {
    const m = line.d / 2 + 1.5;
    for (let k = 0; k <= 24; k++) {
      const s = sAt(p.xa + ((p.xb - p.xa) * k) / 24);
      if (s + m > p.sa && s - m < p.sb) { f0 = Math.max(f0, Math.min(0.9, (p.xb + 4) / halfSpanMm)); break; }
    }
  });
  return f0;
}

/** Spar lines trimmed so they start at the wall of any centre bay they would cross. */
export function trimSparLines<T extends { id: string; d: number; a: [number, number, number]; b: [number, number, number] }>(lines: T[], pockets: Pocket[], halfSpanMm: number): T[] {
  return lines.map(l => {
    if (l.id !== 'main' && l.id !== 'rear') return l;
    const f0 = sparStartFraction(l, pockets, halfSpanMm);
    if (f0 <= 0) return l;
    const t = (f0 * halfSpanMm - l.a[0]) / Math.max(l.b[0] - l.a[0], 1e-6);
    const a = [0, 1, 2].map(k => l.a[k] + (l.b[k] - l.a[k]) * t) as [number, number, number];
    return { ...l, a };
  });
}
