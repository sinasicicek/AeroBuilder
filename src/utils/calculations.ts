export type AircraftType = 'conventional' | 'flying_wing';

/**
 * Tail configuration. Geometry, metrics and the UI all read the same recipe
 * table (TAIL_TYPES) so a new layout only needs one entry.
 */
export type TailType = 'conventional' | 't_tail' | 'v_tail' | 'inverted_v' | 'cruciform';

export interface TailRecipe {
  labelKey: string;
  /** Panel dihedral of the horizontal surfaces: 0 flat, >0 V-tail, <0 inverted V. */
  vAngleDeg: number;
  /** Vertical fin present (V-tails have none — the panels do both jobs). */
  fin: boolean;
  /** Horizontal stab carried on top of the fin (T-tail). */
  stabOnFinTop: boolean;
  /** Extra fin length below the fuselage, fraction of the fin span (cruciform). */
  ventralFrac: number;
  /** Tail-efficiency multiplier applied to the horizontal tail contribution. */
  effFactor: number;
}

export const TAIL_TYPES: Record<TailType, TailRecipe> = {
  conventional: { labelKey: 'tail_type_conventional', vAngleDeg: 0,   fin: true,  stabOnFinTop: false, ventralFrac: 0,    effFactor: 1 },
  t_tail:       { labelKey: 'tail_type_t_tail',       vAngleDeg: 0,   fin: true,  stabOnFinTop: true,  ventralFrac: 0,    effFactor: 1.05 },
  v_tail:       { labelKey: 'tail_type_v_tail',       vAngleDeg: 38,  fin: false, stabOnFinTop: false, ventralFrac: 0,    effFactor: 0.97 },
  inverted_v:   { labelKey: 'tail_type_inverted_v',   vAngleDeg: -38, fin: false, stabOnFinTop: false, ventralFrac: 0,    effFactor: 0.97 },
  cruciform:    { labelKey: 'tail_type_cruciform',    vAngleDeg: 0,   fin: true,  stabOnFinTop: false, ventralFrac: 0.45, effFactor: 1 },
};

export const TAIL_TYPE_KEYS: TailType[] = ['conventional', 't_tail', 'v_tail', 'inverted_v', 'cruciform'];
/**
 * Wing sections available in the UI. Every one of them is a real, published
 * shape: NACA 4-digit sections are generated from their formula (so the digits
 * are exact), Clark-Y and MH45 come from measured ordinate tables.
 *  - clarky   : classic balsa trainer / slow flyer
 *  - naca4412 : all-round sport/trainer
 *  - naca2412 : gentle trainer, forgiving stall
 *  - naca4415 : high lift, heavy/short-field models
 *  - naca0012 : symmetric, aerobatic
 *  - naca0009 : thin symmetric, fast/aerobatic
 *  - naca6409 : reflexed, flying wings (like MH45 but thinner)
 *  - mh45     : Martin Hepperle reflexed section, flying wings
 */
export type AirfoilType =
  | 'clarky' | 'naca4412' | 'naca2412' | 'naca4415'
  | 'naca0012' | 'naca0009' | 'naca6409' | 'mh45';

/**
 * The airfoil as it travels through the app: a bare type, or a type with an
 * explicit thickness in percent of chord ("clarky@14"). Keeping it a single
 * string means persistence, share links and project snapshots need no extra
 * field, and older saved projects ("clarky") keep loading unchanged.
 */
export type AirfoilSpec = AirfoilType | `${AirfoilType}@${number}`;
import type { FuseStation } from './fuseStations';
import { sanitizeStations } from './fuseStations';

export type FuselageType =
  | 'trainer'   // boxy high-wing trainer
  | 'sport'     // round mid/low wing
  | 'pod'       // wide flat equipment pod
  | 'slab'      // thin balsa/ply slab (wing passes through)
  | 'boom'      // pod + slim tail boom (gliders)
  | 'box'       // square cargo box, almost no taper
  | 'egg'       // full section amidships, egg profile
  | 'faceted'   // diamond / V section
  | 'custom';   // driven by the four fuse* dimensions

// Tractor props (conventional) — format: DiameterxPitch inches
// Pusher props (flying wing)    — suffix P indicates pusher (counter-rotating pitch)
export type PropellerType =
  | 'prop_6x4'    | 'prop_7x4'
  | 'prop_8x4'    | 'prop_8x6'
  | 'prop_9x47'   | 'prop_10x47'
  | 'prop_10x45'  | 'prop_11x55'
  | 'prop_12x6'   | 'prop_12x8'
  // Pusher variants
  | 'prop_7x4P'   | 'prop_8x45P'
  | 'prop_9x47P'  | 'prop_10x47P'
  | 'prop_10x7P'  | 'prop_11x55P';

// Future: 'delta' | 'canard'

/**
 * Control-surface layout. All values are percentages so they stay valid when
 * the user rescales the aircraft or toggles cm/mm.
 *  - aileronStart / aileronEnd: % of the semi-span, measured from the root
 *  - aileronChord / elevatorChord / rudderChord: % of the local chord
 * On a flying wing the "aileron" fields describe the elevons.
 */
export interface ControlSurfaces {
  aileronStart: number;
  aileronEnd: number;
  aileronChord: number;
  elevatorChord: number;
  rudderChord: number;
  /**
   * Flying wing only: target static margin (% of MAC). The CG is placed this
   * far ahead of the neutral point (Hepperle: 2–5 % typical, more for beginners).
   */
  fwStaticMargin: number;
  /**
   * Conventional only: target static margin (% of MAC). The CG is placed this
   * far ahead of the estimated neutral point (wing + tail − fuselage).
   */
  convStaticMargin: number;
}

export const DEFAULT_CONTROL_SURFACES: Record<AircraftType, ControlSurfaces> = {
  conventional: { aileronStart: 50, aileronEnd: 95, aileronChord: 25, elevatorChord: 30, rudderChord: 40, fwStaticMargin: 6, convStaticMargin: 12 },
  flying_wing:  { aileronStart: 30, aileronEnd: 95, aileronChord: 22, elevatorChord: 0,  rudderChord: 0, fwStaticMargin: 6, convStaticMargin: 12 },
};

/** Clamp control-surface values into physically meaningful ranges. */
export function sanitizeControls(c: ControlSurfaces): ControlSurfaces {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  const start = clamp(c.aileronStart, 0, 95);
  const end = clamp(c.aileronEnd, start + 5, 100);
  return {
    aileronStart: start,
    aileronEnd: end,
    aileronChord: clamp(c.aileronChord, 5, 50),
    elevatorChord: clamp(c.elevatorChord, 0, 60),
    rudderChord: clamp(c.rudderChord, 0, 60),
    fwStaticMargin: clamp(c.fwStaticMargin ?? 6, 1, 20),
    convStaticMargin: clamp(c.convStaticMargin ?? 12, 5, 25),
  };
}

/**
 * Usual CG window for conventional models (fraction of MAC). The CG now
 * follows the chosen static margin; outside this window the design gets a
 * warning (tail too weak, or CG unusually far aft for a first flight).
 */
export const CG_WINDOW_CONVENTIONAL: [number, number] = [0.20, 0.35];

/**
 * Fuselage pitch-moment factor K_f (per degree) vs. the position of the wing
 * root quarter chord as a fraction of fuselage length (Gilruth & White, as
 * charted in Raymer, "Aircraft Design", fig. 16.14 — approximate).
 */
const FUSELAGE_KF: [number, number][] = [
  [0.1, 0.0045], [0.2, 0.008], [0.3, 0.013], [0.4, 0.020], [0.5, 0.030], [0.6, 0.047],
];
function fuselageKf(x: number): number {
  const t = FUSELAGE_KF;
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, y0] = t[i - 1], [x1, y1] = t[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return t[t.length - 1][1];
}

/** Comfortable static-margin range (% MAC) per layout. */
export const SM_RANGE: Record<AircraftType, [number, number]> = {
  conventional: [5, 20],
  flying_wing: [2, 12],
};

export interface AircraftPreset {
  type: AircraftType;
  labelKey: string;         // i18n key for display name
  descriptionKey: string;   // i18n key for description
  defaults: AircraftDimensions;
  tailEfficiencyOverride?: number; // η override for non-conventional layouts
}

export const AIRCRAFT_PRESETS: AircraftPreset[] = [
  {
    type: 'conventional',
    labelKey: 'preset_conventional',
    descriptionKey: 'preset_conventional_desc',
    defaults: {
      wingspan: 100,
      rootChord: 20,
      tipChord: 15,
      sweepOffset: 5,
      dihedral: 5,
      hStabSpan: 32,
      hStabChord: 9,
      vStabSpan: 15,
      vStabChord: 10,
      fuselageLength: 80,
      noseLength: 15,
      wingToTailDistance: 32,
      fuselageWidth: 7,
      fuselageHeight: 8,
    },
  },
  {
    type: 'flying_wing',
    labelKey: 'preset_flying_wing',
    descriptionKey: 'preset_flying_wing_desc',
    tailEfficiencyOverride: 0,   // no tail
    defaults: {
      wingspan: 90,
      rootChord: 26,
      tipChord: 13,
      sweepOffset: 30,
      dihedral: 2,
      hStabSpan: 0,
      hStabChord: 0,
      vStabSpan: 8,
      vStabChord: 6,
      fuselageLength: 30,
      noseLength: 0,
      wingToTailDistance: 0,
      fuselageWidth: 0,
      fuselageHeight: 0,
    },
  },
];

export interface AircraftDimensions {
  wingspan: number;
  rootChord: number;
  tipChord: number;
  sweepOffset: number;
  dihedral: number;

  hStabSpan: number;
  hStabChord: number;

  vStabSpan: number;
  vStabChord: number;

  fuselageLength: number;
  noseLength: number;
  wingToTailDistance: number;

  fuselageWidth: number;   // max cross-section width
  fuselageHeight: number;  // max cross-section height

  // ── Custom fuselage profile (style === 'custom'; ignored otherwise) ──
  fuseExpo?: number;    // cross-section roundness: 1.2 = diamond … 9 = box
  fuseNose?: number;    // width/height factor at the nose tip (0.3 … 0.98)
  fuseTailW?: number;   // width lost from the wing TE to the tail end (0 … 0.85)
  fuseTailH?: number;   // height lost from the wing TE to the tail end (0 … 0.85)

  /** Manual shape edits along the fuselage (empty/undefined = base profile). */
  fuseStations?: FuseStation[];
}

/** Numeric dimensions (everything except the manual station list). */
export type NumericDimKey = Exclude<keyof AircraftDimensions, 'fuseStations'>;

/** Dimensions that are lengths (converted on cm/mm toggle). */
export type LengthKey =
  | 'wingspan' | 'rootChord' | 'tipChord' | 'sweepOffset'
  | 'hStabSpan' | 'hStabChord' | 'vStabSpan' | 'vStabChord'
  | 'fuselageLength' | 'noseLength' | 'wingToTailDistance'
  | 'fuselageWidth' | 'fuselageHeight';

/** Keys of AircraftDimensions that are lengths (converted on cm/mm toggle). */
export const LENGTH_KEYS: LengthKey[] = [
  'wingspan', 'rootChord', 'tipChord', 'sweepOffset',
  'hStabSpan', 'hStabChord', 'vStabSpan', 'vStabChord',
  'fuselageLength', 'noseLength', 'wingToTailDistance',
  'fuselageWidth', 'fuselageHeight',
];

/** Converts a preset/default (always authored in cm) to the given unit. */
export function dimsInUnit(dimsCm: AircraftDimensions, unit: 'cm' | 'mm'): AircraftDimensions {
  if (unit === 'cm') return { ...dimsCm };
  const out = { ...dimsCm };
  LENGTH_KEYS.forEach(k => { out[k] = parseFloat((dimsCm[k] * 10).toFixed(2)); });
  return out;
}

/** Fills any missing/invalid field (e.g. data saved by an older version). */
export function normalizeDims(raw: Partial<AircraftDimensions> | null | undefined, fallback: AircraftDimensions): AircraftDimensions {
  const out = { ...fallback };
  if (raw) {
    (Object.keys(fallback) as NumericDimKey[]).forEach(k => {
      const v = Number(raw[k]);
      if (Number.isFinite(v)) out[k] = v;
    });
    // Optional custom-fuselage profile values: they are not part of the preset
    // defaults, so they must be carried over explicitly (saved state / share links).
    (['fuseExpo', 'fuseNose', 'fuseTailW', 'fuseTailH'] as const).forEach(k => {
      const v = Number(raw[k]);
      if (raw[k] !== undefined && Number.isFinite(v)) out[k] = v;
    });
    // Manual station edits (array of objects, so they need their own path)
    if (Array.isArray(raw.fuseStations)) out.fuseStations = sanitizeStations(raw.fuseStations);
  }
  return out;
}

export interface AircraftMetrics {
  wingArea: number;
  hStabArea: number;
  vStabArea: number;
  mac: number;
  cgPosition: number; // relative to root chord leading edge
  neutralPoint: number; // offset from root chord leading edge
  staticMargin: number; // percentage
  aspectRatio: number;
  tailMomentArm: number;

  halfWingArea: number;
  clAlpha: number; // wing lift-curve slope (per radian)
  downwashGradient: number; // dε/dα
  tailVolumeCoefficient: number;  // Vbar
  sweepRatio: number;   // sweepOffset / (wingspan / 2)  — dimensionless
  taperRatio: number;   // tipChord / rootChord           — dimensionless (same as lambda)
  cgFraction: number;   // CG position as fraction of MAC (from the MAC leading edge)
  fuselageNpShift: number; // forward NP shift caused by the fuselage (length units; 0 for flying wings)

  aileronArea: number;       // both ailerons / elevons
  aileronAreaRatio: number;  // aileronArea / wingArea
  elevatorArea: number;
  elevatorAreaRatio: number; // elevatorArea / hStabArea
  rudderArea: number;
  rudderAreaRatio: number;   // rudderArea / vStabArea
}

export type StatusLevel = 'stable' | 'warning' | 'unstable';

export interface ValidationCheck {
  id: string;
  level: StatusLevel;
  messageKey: string;
  fixKey: string;
}

export function calculateMetrics(
  dims: AircraftDimensions,
  aircraftType: AircraftType = 'conventional',
  controls: ControlSurfaces = DEFAULT_CONTROL_SURFACES[aircraftType],
  tailType: TailType = 'conventional',
): AircraftMetrics {
  const safeWingspan   = Math.max(dims.wingspan, 0.1);
  const safeRootChord  = Math.max(dims.rootChord, 0.1);
  const safeTipChord   = Math.max(dims.tipChord, 0.01);

  // Area = (Root Chord + Tip Chord) / 2 * Wingspan
  const wingArea = ((safeRootChord + safeTipChord) / 2) * safeWingspan;
  const halfWingArea = wingArea / 2;

  // Basic rectangular area for stabs (assuming mostly rectangular/simple shape for calculation ease,
  // but if we want more precision, we can use span * chord)
  const isFW = aircraftType === 'flying_wing';
  const tailRecipe = TAIL_TYPES[tailType] ?? TAIL_TYPES.conventional;
  const hStabArea = isFW ? 0 : Math.max(dims.hStabSpan, 0) * Math.max(dims.hStabChord, 0);
  // Flying wing: two winglets (root chord VC, tip chord 0.5·VC)
  // V-tail: the panels are the vertical surface too — their vertical projection
  // is hStabArea · tan(vAngle) (the horizontal projection is already hStabArea,
  // because hStabSpan is interpreted as the projected span).
  const isV = !isFW && tailRecipe.fin === false && Math.abs(tailRecipe.vAngleDeg) > 0.01;
  const vStabArea = isFW
    ? 2 * Math.max(dims.vStabSpan, 0) * Math.max(dims.vStabChord, 0) * 0.75
    : isV
      ? hStabArea * Math.tan((Math.abs(tailRecipe.vAngleDeg) * Math.PI) / 180)
      : Math.max(dims.vStabSpan, 0) * Math.max(dims.vStabChord, 0);

  // Mean Aerodynamic Chord (MAC) calculation for a swept tapered wing
  // Taper ratio (lambda)
  const lambda = safeTipChord / safeRootChord;
  const mac = safeRootChord * (2/3) * ((1 + lambda + lambda * lambda) / (1 + lambda));

  // The CG is derived later from the neutral point and the target margin.
  // We need to find MAC leading edge offset from root chord leading edge.
  // Y-coordinate of MAC from root is (wingspan/6) * ((1 + 2*lambda) / (1 + lambda))
  // Then the X-offset of MAC LE = Y_mac * tan(sweepAngle).
  // Assuming sweepOffset is the X-distance from root LE to tip LE.
  const yMac = (safeWingspan / 6) * ((1 + 2 * lambda) / (1 + lambda));
  const sweepAngleTan = dims.sweepOffset / (safeWingspan / 2);
  const macLeOffset = yMac * sweepAngleTan;

  const aspectRatio = (safeWingspan * safeWingspan) / wingArea;
  const cs = sanitizeControls(controls);

  // --- NEUTRAL POINT (independent of the CG) ---
  // Wing aerodynamic centre: quarter chord of the MAC, at its span station
  // (so sweep is already accounted for).
  const wingAcPosition = macLeOffset + (0.25 * mac);
  const wingAcAbsolutePosition = dims.noseLength + wingAcPosition;

  // Horizontal tail AC (approx. quarter chord of the stabiliser), from the nose.
  const wingTePosition = dims.noseLength + dims.rootChord;
  const hStabLePosition = wingTePosition + dims.wingToTailDistance;
  const hStabAcPosition = hStabLePosition + (0.25 * dims.hStabChord);
  const lt_np = hStabAcPosition - wingAcAbsolutePosition;

  // Wing lift-curve slope — Helmbold's approximation (subsonic)
  const clAlpha = (2 * Math.PI * aspectRatio) / (2 + Math.sqrt(aspectRatio * aspectRatio + 4));

  // Downwash gradient
  let downwashGradient = (2 * clAlpha) / (Math.PI * aspectRatio);
  downwashGradient = Math.min(0.8, Math.max(0, downwashGradient)); // clamp to [0, 0.8]

  // Tail efficiency factor
  const preset = AIRCRAFT_PRESETS.find(p => p.type === aircraftType);
  const tailEfficiency = (preset?.tailEfficiencyOverride ?? 0.9) * tailRecipe.effFactor;

  let neutralPoint: number;
  let fuselageNpShift = 0;
  if (isFW) {
    // Tailless wing (M. Hepperle, "Basic Design of Flying Wing Models"):
    // NP = aerodynamic centre = 25 % of the MAC.
    neutralPoint = wingAcPosition;
  } else {
    // Tail contribution pushes the NP aft…
    const tailShift = (hStabArea / wingArea) * lt_np * tailEfficiency * (1 - downwashGradient);
    // …the fuselage pulls it forward: Cmα_fus = K_f·W_f²·L_f / (c̄·S) per degree,
    // ΔNP/c̄ = Cmα_fus / CLα_wing (per degree).
    const lf = Math.max(dims.fuselageLength, 0.1);
    const wf = Math.max(dims.fuselageWidth, 0);
    const kf = fuselageKf((dims.noseLength + 0.25 * safeRootChord) / lf);
    const clAlphaDeg = clAlpha * Math.PI / 180;
    fuselageNpShift = ((kf * wf * wf * lf) / (mac * wingArea)) / clAlphaDeg * mac;
    neutralPoint = wingAcPosition + tailShift - fuselageNpShift;
  }

  // --- CG = NP − target static margin · MAC (both layouts) ---
  const targetSm = (isFW ? cs.fwStaticMargin : cs.convStaticMargin) / 100;
  const cgPosition = neutralPoint - targetSm * mac;
  const cgFraction = (cgPosition - macLeOffset) / mac;

  // Tail moment arm: CG to the horizontal tail AC
  const cgAbsolutePosition = dims.noseLength + cgPosition;
  const tailMomentArm = hStabAcPosition - cgAbsolutePosition;

  // Static Margin — SM = (NP − CG) / MAC · 100 (equals the target by construction)
  const staticMargin = ((neutralPoint - cgPosition) / mac) * 100;

  const tailVolumeCoefficient = isFW ? 0 : (hStabArea * tailMomentArm) / (wingArea * mac);

  // ── Control surface areas (both sides) ──
  const c = sanitizeControls(controls);
  const halfSpan = safeWingspan / 2;
  const f0 = c.aileronStart / 100, f1 = c.aileronEnd / 100;
  const chordAt = (f: number) => safeRootChord + (safeTipChord - safeRootChord) * f;
  const aileronArea = 2 * halfSpan * (f1 - f0) * ((chordAt(f0) + chordAt(f1)) / 2) * (c.aileronChord / 100);
  const elevatorArea = hStabArea * (c.elevatorChord / 100);
  const rudderArea = isFW ? 0 : vStabArea * (c.rudderChord / 100);

  return {
    wingArea,
    hStabArea,
    vStabArea,
    mac,
    cgPosition,
    neutralPoint,
    staticMargin,
    aspectRatio,
    tailMomentArm,
    halfWingArea,
    clAlpha,
    downwashGradient,
    tailVolumeCoefficient,
    sweepRatio: dims.sweepOffset / (safeWingspan / 2),
    taperRatio: lambda,
    cgFraction,
    fuselageNpShift,
    aileronArea,
    aileronAreaRatio: aileronArea / wingArea,
    elevatorArea,
    elevatorAreaRatio: hStabArea > 0 ? elevatorArea / hStabArea : 0,
    rudderArea,
    rudderAreaRatio: vStabArea > 0 ? rudderArea / vStabArea : 0,
  };
}

export function validateDesign(
  dims: AircraftDimensions,
  metrics: AircraftMetrics,
  aircraftType: AircraftType = 'conventional'
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // Aspect Ratio validation
  if (metrics.aspectRatio < 4.5) {
    checks.push({ id: 'ar_low', level: 'warning', messageKey: 'ar_warning_low', fixKey: 'fix_ar_low' });
  } else if (metrics.aspectRatio > 8) {
    checks.push({ id: 'ar_high', level: 'warning', messageKey: 'ar_warning_high', fixKey: 'fix_ar_high' });
  }

  if (aircraftType === 'conventional') {
    // Tail Moment Arm validation (2.5 to 3.5 times MAC)
    const tailArmRatio = metrics.tailMomentArm / metrics.mac;
    if (tailArmRatio < 2.5) {
      checks.push({ id: 'tail_short', level: 'unstable', messageKey: 'tail_arm_short', fixKey: 'fix_tail_short' });
    } else if (tailArmRatio > 4.0) {
      checks.push({ id: 'tail_long', level: 'warning', messageKey: 'tail_arm_long', fixKey: 'fix_tail_long' });
    }

    // Horizontal Stabilizer Area validation (20% to 25% of Wing Area)
    const hStabRatio = metrics.hStabArea / metrics.wingArea;
    if (hStabRatio < 0.15) {
      checks.push({ id: 'hstab_small', level: 'unstable', messageKey: 'hstab_area_small', fixKey: 'fix_hstab_small' });
    } else if (hStabRatio > 0.30) {
      checks.push({ id: 'hstab_large', level: 'warning', messageKey: 'hstab_area_large', fixKey: 'fix_hstab_large' });
    }

    // Vertical Stabilizer Area validation (10% to 15% of Wing Area)
    const vStabRatio = metrics.vStabArea / metrics.wingArea;
    if (vStabRatio < 0.08) {
      checks.push({ id: 'vstab_small', level: 'unstable', messageKey: 'vstab_area_small', fixKey: 'fix_vstab_small' });
    }

    // Tail must sit on the fuselage
    const tailTe = dims.noseLength + dims.rootChord + dims.wingToTailDistance + dims.hStabChord;
    if (tailTe > dims.fuselageLength * 1.02) {
      checks.push({ id: 'tail_beyond_fuse', level: 'warning', messageKey: 'tail_beyond_fuse', fixKey: 'fix_tail_beyond_fuse' });
    }

    // Elevator / rudder sizing
    if (metrics.elevatorAreaRatio > 0 && (metrics.elevatorAreaRatio < 0.2 || metrics.elevatorAreaRatio > 0.45)) {
      checks.push({ id: 'elevator_size', level: 'warning', messageKey: 'elevator_size', fixKey: 'fix_elevator_size' });
    }
    if (metrics.rudderAreaRatio > 0 && (metrics.rudderAreaRatio < 0.25 || metrics.rudderAreaRatio > 0.55)) {
      checks.push({ id: 'rudder_size', level: 'warning', messageKey: 'rudder_size', fixKey: 'fix_rudder_size' });
    }
  }

  // Aileron / elevon sizing (total area vs wing area)
  if (aircraftType === 'conventional') {
    if (metrics.aileronAreaRatio < 0.06 || metrics.aileronAreaRatio > 0.16) {
      checks.push({ id: 'aileron_size', level: 'warning', messageKey: 'aileron_size', fixKey: 'fix_aileron_size' });
    }
  } else if (metrics.aileronAreaRatio < 0.08 || metrics.aileronAreaRatio > 0.22) {
    checks.push({ id: 'elevon_size', level: 'warning', messageKey: 'elevon_size', fixKey: 'fix_elevon_size' });
  }

  if (aircraftType === 'flying_wing') {
    // Sweep check — flying wings need meaningful sweep for stability
    const sweepRatioFW = dims.sweepOffset / Math.max(dims.wingspan / 2, 0.1);
    if (sweepRatioFW < 0.10) {
      checks.push({
        id: 'fw_sweep_low', level: 'unstable',
        messageKey: 'fw_sweep_low', fixKey: 'fix_fw_sweep_low'
      });
    }
    // Taper check — extreme taper causes tip stall on flying wings
    const taperFW = dims.tipChord / Math.max(dims.rootChord, 0.1);
    if (taperFW < 0.2) {
      checks.push({
        id: 'fw_taper_low', level: 'warning',
        messageKey: 'fw_taper_low', fixKey: 'fix_fw_taper_low'
      });
    }
  }

  // Dihedral validation
  if (dims.dihedral === 0) {
    checks.push({ id: 'dihedral_zero', level: 'warning', messageKey: 'dihedral_zero', fixKey: 'fix_dihedral_zero' });
  } else if (dims.dihedral > 15) {
    checks.push({ id: 'dihedral_high', level: 'warning', messageKey: 'dihedral_high', fixKey: 'fix_dihedral_high' });
  }

  // Conventional: the CG follows the chosen margin, so check that it lands in
  // the usual window — outside it the tail (or the NP estimate) needs a look.
  if (aircraftType === 'conventional') {
    const [cgLo, cgHi] = CG_WINDOW_CONVENTIONAL;
    if (metrics.cgFraction < cgLo) {
      checks.push({ id: 'cg_fwd', level: 'warning', messageKey: 'cg_fwd', fixKey: 'fix_cg_fwd' });
    } else if (metrics.cgFraction > cgHi) {
      checks.push({ id: 'cg_aft', level: 'warning', messageKey: 'cg_aft', fixKey: 'fix_cg_aft' });
    }
  }

  // Static Margin validation (flying wings fly with much smaller margins)
  const [smLo, smHi] = SM_RANGE[aircraftType];
  if (metrics.staticMargin < smLo) {
    checks.push({ id: 'sm_low', level: 'unstable', messageKey: aircraftType === 'flying_wing' ? 'fw_sm_low' : 'sm_low', fixKey: aircraftType === 'flying_wing' ? 'fix_fw_sm_low' : 'fix_sm_low' });
  } else if (metrics.staticMargin > smHi) {
    checks.push({ id: 'sm_high', level: 'warning', messageKey: aircraftType === 'flying_wing' ? 'fw_sm_high' : 'sm_high', fixKey: aircraftType === 'flying_wing' ? 'fix_fw_sm_high' : 'fix_sm_high' });
  }

  return checks;
}
