/**
 * Shared aircraft layout.
 *
 * Every view (2D canvas, 3D scene, PDF templates and — later — STL export)
 * derives positions from this single module so they always agree.
 *
 * Conventions (all lengths in the SAME unit as the input dimensions):
 *  - "station" s  : distance measured aft from the nose / firewall (s = 0).
 *                   Negative values are ahead of the nose (motor, propeller).
 *  - "span" x     : lateral distance from the aircraft centreline (right = +).
 *  - "height" y   : vertical, up = +, 0 = fuselage reference line.
 */
import type { AircraftDimensions, AircraftMetrics, AircraftType, ControlSurfaces, FuselageType, PropellerType, TailType } from './calculations';
import { sanitizeControls, TAIL_TYPES } from './calculations';
import { prepareStations, sanitizeStations, stationMultipliers, type FuseStation } from './fuseStations';
import { PROP_BY_KEY } from './electricSystem';

export interface FuselageSection {
  w: number;  // full width at this station
  h: number;  // full height at this station
  yc: number; // vertical centre of the section
}

export interface WingLayout {
  halfSpan: number;
  rootChord: number;
  tipChord: number;
  sweep: number;
  dihedralRad: number;
  leS: number;        // station of the root leading edge
  mountY: number;     // height of the root chord line
  /** chord at span fraction f ∈ [0,1] */
  chordAt: (f: number) => number;
  /** leading-edge station at span fraction f */
  leAt: (f: number) => number;
  /** trailing-edge station at span fraction f */
  teAt: (f: number) => number;
  /** height of the chord line at span fraction f (dihedral) */
  yAt: (f: number) => number;
}

export interface SurfaceLayout {
  leS: number;
  span: number;       // full span (hStab) or height (fin / winglet)
  rootChord: number;
  tipChord: number;
  sweep: number;      // LE offset at the tip
  y: number;          // mounting height
  hingeFrac: number;  // control surface chord fraction (0 = none)
  /** Panel dihedral around the fuselage axis (rad). 0 = flat, >0 = V-tail panel up. */
  rollRad?: number;
  /** Extra fin length below `y` (ventral fin of a cruciform tail). */
  ventral?: number;
}

export interface TailLayout {
  type: TailType;
  /** Panel angle of the horizontal surfaces in degrees (0 = flat). */
  vAngleDeg: number;
  /** Panel length from the centreline to the tip (3D), projected span = span/2. */
  panelSpan: number;
}

export interface Layout {
  unit: 'cm' | 'mm';
  toCm: number;                 // multiply layout values by this to get cm
  isFW: boolean;
  wing: WingLayout;
  aileron: { f0: number; f1: number; chordFrac: number };
  tail: TailLayout;
  hStab: SurfaceLayout | null;
  fin: SurfaceLayout | null;
  winglet: SurfaceLayout | null;   // one side; mirrored
  fuselage: {
    length: number;
    width: number;
    height: number;
    style: FuselageType;
    /** Resolved superellipse exponent of the cross-section (custom included). */
    expo: number;
    /** Manual shape control points (fractions of the length); empty = base profile. */
    stations: FuseStation[];
    section: (s: number) => FuselageSection;
  } | null;
  motor: {
    pusher: boolean;
    diameter: number;
    length: number;
    mountS: number;               // firewall / mount station
    dir: 1 | -1;                  // +1 motor extends aft (pusher), -1 forward (tractor)
  };
  prop: { diameter: number; pitchIn: number; label: string; s: number; y: number };
  /**
   * Flying wing: notch in the root trailing edge so the pusher motor/prop sit
   * inside the wing (Zagi style). |x| ≤ halfWidth, stations ≥ sCut are removed.
   */
  teCut: { halfWidth: number; sCut: number } | null;
  /** Set when the cut-out was requested but does not fit (min. elevon start, %). */
  teCutNeedsElevonStart: number | null;
  cgS: number;
  npS: number;
  /** min/max station and max lateral extent, for fitting views */
  bounds: { sMin: number; sMax: number; xMax: number; yMin: number; yMax: number };
}

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export function computeLayout(
  dims: AircraftDimensions,
  aircraftType: AircraftType,
  controls: ControlSurfaces,
  metrics: Pick<AircraftMetrics, 'cgPosition' | 'neutralPoint'>,
  unit: 'cm' | 'mm',
  fuselageStyle: FuselageType = 'trainer',
  propeller: PropellerType = 'prop_9x47',
  propCutout = true,
  tailType: TailType = 'conventional',
): Layout {
  const isFW = aircraftType === 'flying_wing';
  const inch = unit === 'mm' ? 25.4 : 2.54;
  const toCm = unit === 'mm' ? 0.1 : 1;
  const u = 1 / toCm; // 1 cm expressed in the current unit

  const halfSpan = Math.max(dims.wingspan, 1 * u) / 2;
  const rootChord = Math.max(dims.rootChord, 0.5 * u);
  const tipChord = Math.max(dims.tipChord, 0.1 * u);
  const sweep = dims.sweepOffset;
  const dihedralRad = ((dims.dihedral || 0) * Math.PI) / 180;
  const c = sanitizeControls(controls);

  // ── Fuselage (conventional only) ──
  let fuselage: Layout['fuselage'] = null;
  const noseLength = isFW ? 0 : Math.max(dims.noseLength, 0);
  if (!isFW) {
    const L = Math.max(dims.fuselageLength, 1 * u);
    const W = Math.max(dims.fuselageWidth || 7 * u, 1 * u);
    const H = Math.max(dims.fuselageHeight || 8 * u, 1 * u);
    const wingLe = noseLength;
    const wingTe = noseLength + rootChord;
    const prof = fuseProfile(fuselageStyle, dims);
    // Manual station edits (empty list → null → base profile, unchanged)
    const stationSeries = prepareStations(dims.fuseStations);
    const section = (s: number): FuselageSection => {
      let k: number;          // width factor
      let kh: number;         // height factor
      let tt = 0;             // progress along the tail region (0 … 1)
      if (s <= wingLe) {
        const t = wingLe > 0 ? s / wingLe : 1;
        const sm = smooth(t);
        k = prof.noseW + (1 - prof.noseW) * sm;
        kh = prof.noseH + (1 - prof.noseH) * sm;
      } else if (s <= wingTe) {
        k = 1; kh = 1;
      } else {
        tt = (s - wingTe) / Math.max(L - wingTe, 1e-6);
        const sm = smooth(tt);
        k = 1 - prof.tailW * sm;
        kh = 1 - prof.tailH * sm;
      }
      // Mid-body fullness (egg / balloon styles), zero elsewhere.
      // Normalised so the widest station equals the nominal W/H envelope.
      if (prof.bulge) {
        const b = Math.sin(Math.PI * Math.min(Math.max(s / L, 0), 1));
        const f = (1 + prof.bulge * b) / (1 + prof.bulge);
        k *= f;
        kh *= f;
      }
      // Manual shape edit at this station (width / height / centre-line)
      const mul = stationSeries ? stationMultipliers(stationSeries, Math.min(Math.max(s / L, 0), 1)) : null;
      const w = W * k * prof.wf * (mul ? mul.w : 1);
      const h = H * kh * prof.hf * (mul ? mul.h : 1);
      // Flat bottom line for high-wing layouts; the sport/boom tail boom rises.
      // Computed after the station scaling so a wider/narrower slice keeps its
      // bottom line instead of sinking through the belly.
      let yc = prof.rise > 0 ? H * 0.12 * prof.rise * smooth(tt) : -H / 2 + h / 2;
      if (mul && mul.dy) yc += mul.dy * H;
      return { w, h, yc };
    };
    fuselage = { length: L, width: W, height: H, style: fuselageStyle, expo: prof.expo, stations: sanitizeStations(dims.fuseStations), section };
  }

  // Wing mounting height: trainer = high wing (sits on top), sport = low-mid wing
  let mountY = 0;
  if (fuselage) {
    const sec = fuselage.section(noseLength + rootChord * 0.3);
    mountY = isHighWing(fuselage.style) ? sec.yc + sec.h / 2 : sec.yc - sec.h * 0.18;
  }

  const wing: WingLayout = {
    halfSpan, rootChord, tipChord, sweep, dihedralRad,
    leS: noseLength,
    mountY,
    chordAt: f => rootChord + (tipChord - rootChord) * f,
    leAt: f => noseLength + sweep * f,
    teAt: f => noseLength + sweep * f + rootChord + (tipChord - rootChord) * f,
    yAt: f => mountY + halfSpan * f * Math.tan(dihedralRad),
  };

  // ── Tail ──
  let hStab: SurfaceLayout | null = null;
  let fin: SurfaceLayout | null = null;
  let winglet: SurfaceLayout | null = null;
  const recipe = TAIL_TYPES[tailType] ?? TAIL_TYPES.conventional;
  const vAngle = (recipe.vAngleDeg * Math.PI) / 180;
  const isV = Math.abs(recipe.vAngleDeg) > 0.01;
  if (!isFW) {
    const hLe = noseLength + rootChord + Math.max(dims.wingToTailDistance, 0);
    const hc = Math.max(dims.hStabChord, 0.1 * u);
    const secAtTail = fuselage!.section(Math.min(hLe + hc * 0.5, fuselage!.length));
    const hSpan = Math.max(dims.hStabSpan, 0.1 * u);
    // V-tail: `hStabSpan` stays the *projected* span, so each panel is longer:
    // panel length = (span/2) ÷ cos α  →  full span = span ÷ cos α.
    const panelSpan = isV ? hSpan / Math.cos(vAngle) : hSpan;

    // Vertical fin first: a T-tail carries the stab on top of it.
    if (recipe.fin) {
      const vc = Math.max(dims.vStabChord, 0.1 * u);
      const finLe = hLe + hc - vc; // fin TE aligned with stab TE
      const secAtFin = fuselage!.section(Math.min(Math.max(finLe + vc * 0.5, 0), fuselage!.length));
      const finSpan = Math.max(dims.vStabSpan, 0.1 * u);
      fin = {
        leS: finLe, span: finSpan, rootChord: vc, tipChord: vc, sweep: 0,
        y: secAtFin.yc + secAtFin.h / 2, hingeFrac: c.rudderChord / 100,
        ventral: recipe.ventralFrac > 0 ? finSpan * recipe.ventralFrac : 0,
      };
    }

    // Stabiliser height: flat-on-fuselage, on top of the fin (T) or at the
    // fuselage shoulder (V / inverted V).
    let stabY = secAtTail.yc;
    if (recipe.stabOnFinTop && fin) stabY = fin.y + fin.span;
    else if (isV) stabY = secAtTail.yc + secAtTail.h * 0.45;

    hStab = {
      leS: hLe, span: panelSpan, rootChord: hc, tipChord: hc, sweep: 0,
      y: stabY, hingeFrac: c.elevatorChord / 100,
      rollRad: isV ? vAngle : 0,
    };
    // The fuselage ends just ahead of the elevator hinge line, like on a real
    // model: the elevator is free behind it (2 mm so its leading edge clears
    // the tail when it deflects). The cross-section taper is unchanged.
    if (hStab.hingeFrac > 0.001) {
      const hinge = hLe + hc * (1 - hStab.hingeFrac);
      const end = hinge - 2 * (u / 10); // 2 mm in layout units
      if (end < fuselage!.length && end > noseLength + rootChord) fuselage!.length = end;
    }
  } else {
    const vc = Math.max(dims.vStabChord, 0.1 * u);
    winglet = {
      leS: wing.teAt(1) - vc, span: Math.max(dims.vStabSpan, 0), rootChord: vc, tipChord: vc * 0.5,
      sweep: vc * 0.5, y: wing.yAt(1), hingeFrac: 0,
    };
  }
  const tail: TailLayout = {
    type: tailType,
    vAngleDeg: isV ? recipe.vAngleDeg : 0,
    panelSpan: hStab && isV ? hStab.span / 2 : 0,
  };

  // ── Motor & propeller ──
  const spec = PROP_BY_KEY[propeller];
  const propIn = spec ? spec.diameter_inch : 9;
  const pitchIn = spec ? spec.pitch_inch : 4.7;
  const propD = propIn * inch;
  // Outrunner size scales loosely with prop: 6" → ~24 mm (1806), 12" → ~36 mm (3536)
  const motorD = (1.2 + 0.2 * propIn) * u;
  const motorL = motorD * 0.9;
  let motor: Layout['motor'];
  let prop: Layout['prop'];
  let teCut: Layout['teCut'] = null;
  let teCutNeedsElevonStart: number | null = null;
  if (isFW) {
    // Pusher: either inside a trailing-edge notch (motor further forward) or behind the TE
    const hw = propD / 2 + 1 * u;
    const depth = motorL + 2.5 * u;
    const maxHw = c.aileronStart / 100 * halfSpan - 0.5 * u;
    let mountS = rootChord;
    if (propCutout) {
      if (hw <= maxHw && depth < rootChord * 0.35) {
        const sCut = noseLength + rootChord - depth;
        teCut = { halfWidth: hw, sCut };
        mountS = sCut + 0.3 * u;
      } else {
        teCutNeedsElevonStart = Math.ceil(((hw + 0.5 * u) / halfSpan) * 100);
      }
    }
    motor = { pusher: true, diameter: motorD, length: motorL, mountS, dir: 1 };
    prop = { diameter: propD, pitchIn, label: spec?.label ?? '', s: mountS + motorL + 0.6 * u, y: 0 };
  } else {
    const fy = fuselage!.section(0).yc;
    motor = { pusher: false, diameter: motorD, length: motorL, mountS: 0, dir: -1 };
    prop = { diameter: propD, pitchIn, label: spec?.label ?? '', s: -(motorL + 0.6 * u), y: fy };
  }

  const cgS = noseLength + metrics.cgPosition;
  const npS = noseLength + metrics.neutralPoint;

  // Bounds
  const stations = [prop.s - 1 * u, wing.leAt(0), wing.leAt(1), wing.teAt(0), wing.teAt(1)];
  if (fuselage) stations.push(fuselage.length);
  if (hStab) stations.push(hStab.leS + hStab.rootChord);
  if (fin) stations.push(fin.leS + fin.rootChord);
  if (isFW) stations.push(prop.s + 1 * u);
  const xMax = Math.max(halfSpan, hStab ? (hStab.span / 2) * Math.abs(Math.cos(hStab.rollRad ?? 0)) : 0, propD / 2);
  const yVals = [wing.yAt(1), mountY, prop.y + propD / 2, prop.y - propD / 2];
  if (fuselage) yVals.push(-fuselage.height / 2, fuselage.height / 2);
  if (fin) {
    yVals.push(fin.y + fin.span);
    if (fin.ventral) yVals.push(fin.y - fin.ventral);
  }
  if (hStab) {
    // V-tail panels swing up (or down) with the roll angle
    const tipY = hStab.y + (hStab.span / 2) * Math.sin(hStab.rollRad ?? 0);
    yVals.push(hStab.y, tipY);
  }
  if (winglet) yVals.push(winglet.y + winglet.span);

  return {
    unit, toCm, isFW, wing, tail, teCut, teCutNeedsElevonStart,
    aileron: { f0: c.aileronStart / 100, f1: c.aileronEnd / 100, chordFrac: c.aileronChord / 100 },
    hStab, fin, winglet, fuselage, motor, prop, cgS, npS,
    bounds: {
      sMin: Math.min(...stations), sMax: Math.max(...stations), xMax,
      yMin: Math.min(...yVals), yMax: Math.max(...yVals),
    },
  };
}

/** Planform polygon of one aileron/elevon (right side), as [x, s] points. */
export function aileronOutline(L: Layout): [number, number][] {
  const { wing, aileron } = L;
  const pts: [number, number][] = [];
  const hinge = (f: number) => wing.teAt(f) - wing.chordAt(f) * aileron.chordFrac;
  pts.push([aileron.f0 * wing.halfSpan, hinge(aileron.f0)]);
  pts.push([aileron.f1 * wing.halfSpan, hinge(aileron.f1)]);
  pts.push([aileron.f1 * wing.halfSpan, wing.teAt(aileron.f1)]);
  pts.push([aileron.f0 * wing.halfSpan, wing.teAt(aileron.f0)]);
  return pts;
}

/** Superellipse exponent of the fuselage cross-section for each style. */
/** Shape recipe of one fuselage style. */
export interface FuseProfile {
  expo: number;    // cross-section superellipse exponent: 1.2 diamond … 9 box
  noseW: number;   // width factor at the nose tip (0 … 1)
  noseH: number;   // height factor at the nose tip (0 … 1)
  tailW: number;   // width lost between the wing TE and the tail end
  tailH: number;   // height lost between the wing TE and the tail end
  wf: number;      // envelope width multiplier
  hf: number;      // envelope height multiplier
  rise: number;    // >0: tail boom centre line rises (sport / boom)
  bulge: number;   // mid-body fullness (egg), 0 = none
  highWing: boolean;
}

export const FUSE_PROFILES: Record<FuselageType, FuseProfile> = {
  //          expo  noseW noseH tailW tailH  wf    hf    rise bulge highWing
  trainer:  { expo: 6,   noseW: 0.85, noseH: 0.85, tailW: 0.65, tailH: 0.55, wf: 1,    hf: 1,    rise: 0,   bulge: 0,    highWing: true },
  sport:    { expo: 2.4, noseW: 0.62, noseH: 0.62, tailW: 0.65, tailH: 0.55, wf: 1,    hf: 1,    rise: 1,   bulge: 0,    highWing: false },
  pod:      { expo: 3.2, noseW: 0.70, noseH: 0.56, tailW: 0.50, tailH: 0.45, wf: 1.18, hf: 0.70, rise: 0,   bulge: 0,    highWing: true },
  slab:     { expo: 6,   noseW: 0.90, noseH: 0.90, tailW: 0.20, tailH: 0.10, wf: 1,    hf: 0.32, rise: 0,   bulge: 0,    highWing: false },
  boom:     { expo: 2,   noseW: 0.55, noseH: 0.55, tailW: 0.78, tailH: 0.78, wf: 1,    hf: 1,    rise: 0.6, bulge: 0,    highWing: true },
  box:      { expo: 9,   noseW: 0.85, noseH: 0.80, tailW: 0.15, tailH: 0.20, wf: 1.05, hf: 1,    rise: 0,   bulge: 0,    highWing: true },
  egg:      { expo: 2.2, noseW: 0.55, noseH: 0.55, tailW: 0.70, tailH: 0.65, wf: 1,    hf: 1,    rise: 0,   bulge: 0.22, highWing: true },
  faceted:  { expo: 1.25,noseW: 0.50, noseH: 0.50, tailW: 0.50, tailH: 0.50, wf: 1.08, hf: 0.95, rise: 0,   bulge: 0,    highWing: true },
  custom:   { expo: 3,   noseW: 0.75, noseH: 0.75, tailW: 0.55, tailH: 0.50, wf: 1,    hf: 1,    rise: 0,   bulge: 0,    highWing: true },
};

/** Styles where the wing sits on top (high wing, rubber-band mounting). */
export const isHighWing = (style: FuselageType): boolean => FUSE_PROFILES[style].highWing;

/** Cross-section exponent of a style (kept for convenience). */
export const FUSE_EXPO: Record<FuselageType, number> =
  Object.fromEntries(Object.entries(FUSE_PROFILES).map(([k, v]) => [k, v.expo])) as Record<FuselageType, number>;

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Profile of a style. For 'custom' the four `fuse*` dimensions override the
 * recipe, clamped to sane printing ranges.
 */
export function fuseProfile(
  style: FuselageType,
  dims?: Pick<AircraftDimensions, 'fuseExpo' | 'fuseNose' | 'fuseTailW' | 'fuseTailH'>,
): FuseProfile {
  const base = FUSE_PROFILES[style];
  if (style !== 'custom' || !dims) return base;
  const nose = clampNum(dims.fuseNose ?? base.noseW, 0.3, 0.98);
  return {
    ...base,
    expo: clampNum(dims.fuseExpo ?? base.expo, 1.2, 9),
    noseW: nose,
    noseH: nose,
    tailW: clampNum(dims.fuseTailW ?? base.tailW, 0, 0.85),
    tailH: clampNum(dims.fuseTailH ?? base.tailH, 0, 0.85),
  };
}

/**
 * Half height of a fuselage cross-section at lateral offset x (same unit as
 * the section): the top is at yc + h, the bottom at yc − h. Round (sport)
 * sections get much lower towards the sides.
 */
export function sectionHalfHeightAt(sec: FuselageSection, x: number, style: FuselageType): number {
  const n = FUSE_EXPO[style];
  return (sec.h / 2) * Math.max(0, 1 - Math.abs((2 * x) / sec.w) ** n) ** (1 / n);
}
