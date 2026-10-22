import * as THREE from 'three';
import type { AirfoilSpec } from './calculations';
import type { Layout } from './geometry';
import { getAirfoil, airfoilSegment, type TailAirfoil } from './airfoils';

/**
 * Mesh generation for the aircraft parts.
 *
 * Every part is a closed (water-tight) loft through a series of cross-section
 * rings with the same vertex count, capped at both ends. The resulting
 * geometries are in real units (the layout's unit) and use the 3D frame:
 *   X = right, Y = up, Z = forward  (Z = -station)
 * so they can be exported to STL without any rescaling.
 */

type V3 = [number, number, number];

/**
 * Loft through rings[k][i] (all rings same length, even count, arranged so
 * that point i and point n-1-i are "opposite" — this lets the end caps be
 * triangulated as simple strips, which works for any airfoil segment or
 * mirrored cross-section).
 */
export function loftRings(rings: V3[][], capStart = true, capEnd = true): THREE.BufferGeometry {
  const n = rings[0].length;
  const pos: number[] = [];
  const idx: number[] = [];

  // Side walls (shared vertices → smooth shading)
  rings.forEach(r => r.forEach(p => pos.push(p[0], p[1], p[2])));
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const a = k * n + i, b = k * n + i2, c = (k + 1) * n + i2, d = (k + 1) * n + i;
      idx.push(a, b, c, a, c, d);
    }
  }

  // Caps (separate vertices → flat shading)
  const addCap = (r: V3[], flip: boolean) => {
    const base = pos.length / 3;
    r.forEach(p => pos.push(p[0], p[1], p[2]));
    for (let i = 0; i < n / 2 - 1; i++) {
      const a = base + i, b = base + i + 1, c = base + (n - 2 - i), d = base + (n - 1 - i);
      if (flip) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    }
  };
  if (capStart) addCap(rings[0], true);
  if (capEnd) addCap(rings[rings.length - 1], false);

  // Make sure all triangles face outward (positive signed volume)
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [i0, i1, i2] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2];
    const bx = pos[i1], by = pos[i1 + 1], bz = pos[i1 + 2];
    const cx = pos[i2], cy = pos[i2 + 1], cz = pos[i2 + 2];
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export interface PartMesh {
  id: string;
  kind: 'wing' | 'aileron' | 'hstab' | 'elevator' | 'fin' | 'rudder' | 'winglet' | 'fuselage';
  geometry: THREE.BufferGeometry;
}

const GAP = 0.012; // hinge gap, fraction of chord (visual & printable clearance)

/**
 * Horizontal lifting surface piece (wing / stab), right side.
 * fA..fB: span fractions; x0..x1: chord fractions.
 */
function horizontalPiece(
  af: ReturnType<typeof getAirfoil>,
  spanAt: (f: number) => number,
  leAt: (f: number) => number,
  chordAt: (f: number) => number,
  yAt: (f: number) => number,
  fA: number, fB: number, x0: number, x1: number | ((f: number) => number),
): THREE.BufferGeometry {
  const rings: V3[][] = [fA, fB].map(f => {
    const c = chordAt(f);
    const outline = airfoilSegment(af, x0, typeof x1 === 'function' ? x1(f) : x1);
    return outline.map(([cx, ty]) => [spanAt(f), yAt(f) + ty * c, -(leAt(f) + cx * c)] as V3);
  });
  return loftRings(rings);
}

/** Vertical surface piece (fin / winglet). h: height fractions, sideX: lateral position. */
function verticalPiece(
  af: ReturnType<typeof getAirfoil>,
  baseY: number, height: number, sideX: number,
  leAt: (t: number) => number, chordAt: (t: number) => number,
  tA: number, tB: number, x0: number, x1: number,
): THREE.BufferGeometry {
  const outline = airfoilSegment(af, x0, x1);
  const rings: V3[][] = [tA, tB].map(t => {
    const c = chordAt(t);
    return outline.map(([cx, ty]) => [sideX + ty * c, baseY + t * height, -(leAt(t) + cx * c)] as V3);
  });
  return loftRings(rings);
}

/**
 * Builds all parts (right side + fuselage/fin). Left-side parts are obtained by
 * mirroring on X in the renderer / exporter.
 */
export function buildAircraftParts(L: Layout, airfoil: AirfoilSpec): { right: PartMesh[]; center: PartMesh[] } {
  const right: PartMesh[] = [];
  const center: PartMesh[] = [];
  const wingAf = getAirfoil(airfoil);
  const tailAf = getAirfoil('sym_tail' as TailAirfoil);
  const w = L.wing;
  const a = L.aileron;
  const spanGap = Math.min(0.004, (a.f1 - a.f0) * 0.02); // span-wise clearance (fraction)

  const span = (f: number) => f * w.halfSpan;
  // ── Wing (split around the aileron / elevon) ──
  const hinge = 1 - a.chordFrac;
  if (a.f0 > 0.001) {
    if (L.teCut) {
      // Root trailing-edge notch for the pusher propeller
      const fc = Math.min(L.teCut.halfWidth / w.halfSpan, a.f0);
      const cutX1 = (f: number) => (L.teCut!.sCut - w.leAt(f)) / w.chordAt(f);
      right.push({ id: 'wing_root_cut', kind: 'wing', geometry: horizontalPiece(wingAf, span, w.leAt, w.chordAt, w.yAt, 0, fc, 0, cutX1) });
      if (fc < a.f0 - 1e-4) right.push({ id: 'wing_root', kind: 'wing', geometry: horizontalPiece(wingAf, span, w.leAt, w.chordAt, w.yAt, fc, a.f0, 0, 1) });
    } else {
      right.push({ id: 'wing_root', kind: 'wing', geometry: horizontalPiece(wingAf, span, w.leAt, w.chordAt, w.yAt, 0, a.f0, 0, 1) });
    }
  }
  right.push({ id: 'wing_mid', kind: 'wing', geometry: horizontalPiece(wingAf, span, w.leAt, w.chordAt, w.yAt, a.f0, a.f1, 0, hinge - GAP / 2) });
  right.push({ id: 'aileron', kind: 'aileron', geometry: horizontalPiece(wingAf, span, w.leAt, w.chordAt, w.yAt, a.f0 + spanGap, a.f1 - spanGap, hinge + GAP / 2, 1) });
  if (a.f1 < 0.999) {
    right.push({ id: 'wing_tip', kind: 'wing', geometry: horizontalPiece(wingAf, span, w.leAt, w.chordAt, w.yAt, a.f1, 1, 0, 1) });
  }

  // ── Horizontal stabiliser + elevator ──
  if (L.hStab) {
    const h = L.hStab;
    const hs = (f: number) => f * h.span / 2;
    const hLe = (f: number) => h.leS + h.sweep * f;
    const hC = (f: number) => h.rootChord + (h.tipChord - h.rootChord) * f;
    const hY = () => h.y;
    // V-tail: rotate the panel around the fuselage axis (Z), pivoting at the
    // root so the panel stays attached to the fuselage shoulder.
    const roll = h.rollRad ?? 0;
    const vTail = (g: THREE.BufferGeometry) => {
      if (!roll) return g;
      g.translate(0, -h.y, 0);
      g.rotateZ(roll);
      g.translate(0, h.y, 0);
      return g;
    };
    if (h.hingeFrac > 0.001) {
      const hh = 1 - h.hingeFrac;
      right.push({ id: 'hstab', kind: 'hstab', geometry: vTail(horizontalPiece(tailAf, hs, hLe, hC, hY, 0, 1, 0, hh - GAP / 2)) });
      right.push({ id: 'elevator', kind: 'elevator', geometry: vTail(horizontalPiece(tailAf, hs, hLe, hC, hY, 0, 1, hh + GAP / 2, 1)) });
    } else {
      right.push({ id: 'hstab', kind: 'hstab', geometry: vTail(horizontalPiece(tailAf, hs, hLe, hC, hY, 0, 1, 0, 1)) });
    }
  }

  // ── Fin + rudder ──
  if (L.fin) {
    const f = L.fin;
    const le = (t: number) => f.leS + f.sweep * t;
    const ch = (t: number) => f.rootChord + (f.tipChord - f.rootChord) * t;
    // Cruciform: a ventral fin continues below the fuselage centreline
    if (f.ventral && f.ventral > 0.001) {
      center.push({ id: 'fin_ventral', kind: 'fin', geometry: verticalPiece(tailAf, f.y - f.ventral, f.ventral, 0, le, ch, 0, 1, 0, 1) });
    }
    if (f.hingeFrac > 0.001) {
      const hh = 1 - f.hingeFrac;
      center.push({ id: 'fin', kind: 'fin', geometry: verticalPiece(tailAf, f.y, f.span, 0, le, ch, 0, 1, 0, hh - GAP / 2) });
      center.push({ id: 'rudder', kind: 'rudder', geometry: verticalPiece(tailAf, f.y, f.span, 0, le, ch, 0.02, 1, hh + GAP / 2, 1) });
    } else {
      center.push({ id: 'fin', kind: 'fin', geometry: verticalPiece(tailAf, f.y, f.span, 0, le, ch, 0, 1, 0, 1) });
    }
  }

  // ── Winglet (flying wing) ──
  if (L.winglet && L.winglet.span > 0) {
    const g = L.winglet;
    const le = (t: number) => g.leS + g.sweep * t;
    const ch = (t: number) => g.rootChord + (g.tipChord - g.rootChord) * t;
    // Start inside the wing skin so there is no visible gap at the tip
    const tipThick = wingAf.upper(0.7) * w.chordAt(1);
    right.push({ id: 'winglet', kind: 'winglet', geometry: verticalPiece(tailAf, g.y + Math.max(0, tipThick * 0.5), g.span, w.halfSpan, le, ch, 0, 1, 0, 1) });
  }

  // ── Fuselage ──
  if (L.fuselage) {
    const fz = L.fuselage;
    const nRing = 32;
    // Manual stations need a denser longitudinal sampling, otherwise a sharp
    // waist/step between two control points gets rounded off by the loft.
    const nSt = fz.stations.length ? 56 : 36;
    const expo = fz.expo; // superellipse exponent: boxy vs round
    const rings: V3[][] = [];
    for (let k = 0; k <= nSt; k++) {
      const s = (k / nSt) * fz.length;
      const sec = fz.section(s);
      const ring: V3[] = [];
      for (let i = 0; i < nRing; i++) {
        const th = Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / nRing;
        const c = Math.cos(th), sn = Math.sin(th);
        const x = (sec.w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / expo);
        const y = sec.yc + (sec.h / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / expo);
        ring.push([x, y, -s]);
      }
      rings.push(ring);
    }
    center.push({ id: 'fuselage', kind: 'fuselage', geometry: loftRings(rings) });
  }

  return { right, center };
}

export function disposeParts(parts: { right: PartMesh[]; center: PartMesh[] }) {
  parts.right.forEach(p => p.geometry.dispose());
  parts.center.forEach(p => p.geometry.dispose());
}
