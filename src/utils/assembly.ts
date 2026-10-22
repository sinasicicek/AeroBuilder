/**
 * How the printed parts are held together.
 *
 *  - Wing halves: glued at the root and bridged by a printed joiner plate that
 *    sits flush in a shallow recess on the lower skin (the tension side), right
 *    across the dihedral joint. Works for every layout.
 *  - Conventional high wing (trainer fuselage): the whole wing is held on top
 *    of the fuselage by rubber bands stretched between two transverse dowels —
 *    one ahead of the leading edge, one behind the trailing edge. The dowels
 *    run through printed sleeves glued into holes drilled in the fuselage, and
 *    a printed guard on the trailing edge spreads the band pressure. In a crash
 *    the wing pops off instead of breaking.
 *  - Low/mid wing (sport fuselage) or when the user prefers it: wing glued.
 *
 * Everything here is in MILLIMETRES in the layout frame
 * (s = station aft of the nose, x = span right +, y = up).
 */
import type { AirfoilSpec } from './calculations';
import type { Layout } from './geometry';
import { isHighWing } from './geometry';
import { getAirfoil } from './airfoils';

export type WingMount = 'bands' | 'glued';

export interface Dowel {
  id: 'front' | 'rear';
  s: number;       // station of the dowel axis
  y: number;       // height of the dowel axis
  d: number;       // dowel diameter
  len: number;     // total length (fuselage width + both protruding ends)
  width: number;   // fuselage width at the dowel (= sleeve length)
}

export interface BandPath { id: string; pts: [number, number, number][] } // [x, y, s]

export interface AssemblySpec {
  /** What actually holds the wing: rubber bands, glue, or nothing (flying wing). */
  mount: WingMount | 'none';
  /** Rubber bands are only offered on a high wing that sits on top of the fuselage. */
  bandsAvailable: boolean;
  dowels: Dowel[];
  bands: { count: number; path: number; flatLen: number; paths: BandPath[] } | null;
  /** Printed joiner plate across the wing root (lower skin), flush in its recess. */
  /** recessed = flush in a recess; otherwise glued onto the skin (flying wings: the root is full of bays). */
  joiner: { halfLen: number; sa: number; sb: number; t: number; recessed: boolean };
  /** Printed trailing-edge guard under the bands (upper skin, glued on). */
  teGuard: { halfWidth: number; sa: number; sb: number; t: number } | null;
  /** Printed dowel sleeves: hole to drill = outer diameter. */
  sleeve: { od: number; id: number } | null;
}

const PROTRUDE = 14;   // mm each dowel sticks out of the fuselage side
const JOINER_T = 1.6;  // mm, joiner plate thickness (= recess depth)
const GUARD_T = 0.8;   // mm

/** Dowel size for the model's weight (hardwood or carbon). */
export function dowelDiameter(auw: number): number {
  return auw < 700 ? 5 : auw < 1500 ? 6 : 8;
}

/** ≈ one band per 100 g, even, 4…12. */
export function bandCount(auw: number): number {
  return Math.min(12, Math.max(4, 2 * Math.ceil(auw / 200)));
}

export function computeAssembly(L: Layout, airfoil: AirfoilSpec, pref: WingMount, auwEstimate: number): AssemblySpec {
  const mm = L.toCm * 10;
  const w = L.wing;
  const H = w.halfSpan * mm;
  const c0 = w.rootChord * mm;
  const le0 = w.leS * mm;
  const te0 = le0 + c0;

  // Joiner just ahead of the main spar (28 %), close to the CG so it does not
  // upset the balance; ~10 % of the half span on each side of the joint.
  // Flying wing: the spars stop at the centre bays, so the plate (glued under
  // the belly) is wider and longer and carries the centre on its own.
  const joiner = L.isFW
    ? { halfLen: Math.min(100, Math.max(60, 0.25 * H)), sa: le0 + 0.08 * c0, sb: le0 + 0.42 * c0, t: JOINER_T, recessed: false }
    : { halfLen: Math.min(80, Math.max(35, 0.1 * H)), sa: le0 + 0.09 * c0, sb: le0 + 0.24 * c0, t: JOINER_T, recessed: true };

  const fz = L.fuselage;
  const bandsAvailable = !!fz && isHighWing(fz.style);
  if (!fz) {
    return { mount: 'none', bandsAvailable, dowels: [], bands: null, joiner, teGuard: null, sleeve: null };
  }
  if (!bandsAvailable || pref === 'glued') {
    return { mount: 'glued', bandsAvailable, dowels: [], bands: null, joiner, teGuard: null, sleeve: null };
  }

  const d = dowelDiameter(auwEstimate);
  const expo = fz.expo;
  const dowelAt = (id: Dowel['id'], s: number): Dowel => {
    const sec = fz.section(s / mm);
    const top = (sec.yc + sec.h / 2) * mm;
    const y = top - (d / 2 + 4);
    // Width of the (superellipse) section at that height
    const yy = Math.min(1, Math.abs((y - sec.yc * mm) / ((sec.h / 2) * mm)));
    const width = sec.w * mm * Math.max(0, 1 - yy ** expo) ** (1 / expo);
    return { id, s, y, d, len: width + 2 * PROTRUDE, width };
  };
  const off = 10 + 1.5 * d;
  const dowels = [dowelAt('front', le0 - off), dowelAt('rear', te0 + off)];

  // Band paths: from a dowel end, over the wing's upper surface at the root, to
  // the other dowel's end. Half cross over the centre (X), half run straight.
  const af = getAirfoil(airfoil);
  const yTop = (f: number) => w.mountY * mm + af.upper(f) * c0 + 1.2;
  const [F, R] = dowels;
  const path = (xa: number, xb: number): [number, number, number][] => {
    const pts: [number, number, number][] = [[xa, F.y + d / 2, F.s]];
    const fs = [0.0, 0.04, 0.15, 0.3, 0.5, 0.7, 0.9, 0.99];
    fs.forEach(f => {
      const s = le0 + f * c0;
      const t = (s - F.s) / (R.s - F.s);
      pts.push([xa + (xb - xa) * t, yTop(f), s]);
    });
    pts.push([xb, R.y + d / 2, R.s]);
    return pts;
  };
  const count = bandCount(auwEstimate);
  const paths: BandPath[] = [];
  const endF = F.len / 2 - 4, endR = R.len / 2 - 4;
  for (let i = 0; i < count; i++) {
    const pair = Math.floor(i / 2), sg = i % 2 === 0 ? 1 : -1;
    const inset = pair * 2.5; // stack neighbouring bands side by side
    const crossed = pair % 2 === 0;
    const xa = sg * (endF - inset);
    const xb = (crossed ? -sg : sg) * (endR - inset);
    paths.push({ id: `band_${i}`, pts: path(xa, xb) });
  }
  const length = (pts: [number, number, number][]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]), 0);
  const pathLen = length(paths[0].pts);
  // A band hooked over two dowel ends runs as a loop; ~2.2× stretch holds firmly
  const flatLen = Math.max(60, Math.round(pathLen / 2.2 / 5) * 5);

  const secW = fz.section((le0 + 0.85 * c0) / mm).w * mm;
  const teGuard = { halfWidth: Math.min(secW / 2 + 12, H * 0.3), sa: le0 + 0.8 * c0, sb: le0 + 0.99 * c0, t: GUARD_T };

  return {
    mount: 'bands', bandsAvailable, dowels,
    bands: { count, path: pathLen, flatLen, paths },
    joiner, teGuard,
    sleeve: { od: d + 2.4, id: d + 0.4 },
  };
}
