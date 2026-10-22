/**
 * Manual fuselage shaping ("station editor").
 *
 * A design can carry a list of control stations along the fuselage. Each one
 * scales the base cross-section (width / height) and may shift its centre line.
 * Everything downstream — the 3D mesh, the print sections, the 2D drawing, the
 * PDF templates, hatch and dowel placement, weight & balance — reads
 * `computeLayout().fuselage.section()`, so the deformation is applied in one
 * single place and stays consistent everywhere.
 *
 * Positions are stored as a fraction of the fuselage length (0 = nose, 1 = tail
 * end) so switching cm/mm or editing the length never distorts the shape.
 *
 * Multipliers are relative to the style profile, so with an empty list the
 * result is bit-identical to the previous behaviour.
 */

export interface FuseStation {
  /** Position along the fuselage as a fraction of its length (0 … 1). */
  s: number;
  /** Width multiplier on the base profile. */
  w: number;
  /** Height multiplier on the base profile. */
  h: number;
  /** Centre-line shift as a fraction of the fuselage height (−…+). */
  dy?: number;
}

export const STATION_MIN = 0.4;
export const STATION_MAX = 2;
export const STATION_DY_MAX = 0.4;
export const STATION_MAX_COUNT = 24;
/** Two control points closer than this (fraction of length) merge into one. */
export const STATION_MERGE = 0.02;

/** Neutral multipliers: leaves the base profile untouched. */
export const NEUTRAL_MUL: { w: number; h: number; dy: number } = { w: 1, h: 1, dy: 0 };

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** Clamp, sort, merge near-duplicates and cap the count. */
export function sanitizeStations(list: FuseStation[] | null | undefined): FuseStation[] {
  if (!Array.isArray(list)) return [];
  const out: FuseStation[] = [];
  list
    .filter(p => p && Number.isFinite(p.s))
    .map(p => ({
      s: clamp(p.s, 0, 1),
      w: clamp(p.w, STATION_MIN, STATION_MAX),
      h: clamp(p.h, STATION_MIN, STATION_MAX),
      dy: clamp(p.dy ?? 0, -STATION_DY_MAX, STATION_DY_MAX),
    }))
    .sort((a, b) => a.s - b.s)
    .forEach(p => {
      const prev = out[out.length - 1];
      if (prev && p.s - prev.s < STATION_MERGE) {
        // Keep the newer edit for the merged pair (average the position)
        prev.s = (prev.s + p.s) / 2;
        prev.w = p.w;
        prev.h = p.h;
        prev.dy = p.dy;
      } else {
        out.push(p);
      }
    });
  return out.slice(0, STATION_MAX_COUNT);
}

/**
 * Monotone cubic (PCHIP / Fritsch–Carlson) slopes. Chosen over Catmull-Rom
 * because the latter overshoots between control points and would bulge the
 * fuselage exactly where the user asked for a narrow waist.
 */
function pchipSlopes(x: number[], y: number[]): number[] {
  const n = x.length;
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;
  if (n === 2) {
    const s = (y[1] - y[0]) / (x[1] - x[0]);
    return [s, s];
  }
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = x[i + 1] - x[i];
    d[i] = (y[i + 1] - y[i]) / h[i];
  }
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0; // local extremum → flat, no overshoot
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  // End points: three-point estimate, clamped to stay monotone
  m[0] = ((2 * h[0] + h[1]) * d[0] - h[0] * d[1]) / (h[0] + h[1]);
  if (m[0] * d[0] <= 0) m[0] = 0;
  else if (d[0] * d[1] < 0 && Math.abs(m[0]) > Math.abs(3 * d[0])) m[0] = 3 * d[0];
  const iL = n - 1;
  m[iL] = ((2 * h[iL - 1] + h[iL - 2]) * d[iL - 1] - h[iL - 1] * d[iL - 2]) / (h[iL - 1] + h[iL - 2]);
  if (m[iL] * d[iL - 1] <= 0) m[iL] = 0;
  else if (d[iL - 1] * d[iL - 2] < 0 && Math.abs(m[iL]) > Math.abs(3 * d[iL - 1])) m[iL] = 3 * d[iL - 1];
  return m;
}

function hermite(x0: number, x1: number, y0: number, y1: number, m0: number, m1: number, x: number): number {
  const h = x1 - x0;
  const t = h === 0 ? 0 : (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * m0 +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * h * m1
  );
}

type Series = { x: number[]; w: number[]; h: number[]; dy: number[]; mw: number[]; mh: number[]; md: number[] };

/** Pre-computes the interpolation tables of a station list. */
export function prepareStations(list: FuseStation[] | null | undefined): Series | null {
  const st = sanitizeStations(list);
  if (!st.length) return null;
  const x = st.map(p => p.s);
  const w = st.map(p => p.w);
  const h = st.map(p => p.h);
  const dy = st.map(p => p.dy ?? 0);
  return {
    x, w, h, dy,
    mw: pchipSlopes(x, w),
    mh: pchipSlopes(x, h),
    md: pchipSlopes(x, dy),
  };
}

function evalSeries(x: number[], y: number[], m: number[], t: number): number {
  const n = x.length;
  if (n === 1) return y[0];
  if (t <= x[0]) return y[0];          // constant hold before the first point
  if (t >= x[n - 1]) return y[n - 1];  // …and after the last one
  let i = 0;
  while (i < n - 2 && t > x[i + 1]) i++;
  return hermite(x[i], x[i + 1], y[i], y[i + 1], m[i], m[i + 1], t);
}

/** Multipliers at position `t` (0 … 1 of the fuselage length). */
export function stationMultipliers(
  series: Series | null,
  t: number,
): { w: number; h: number; dy: number } {
  if (!series) return NEUTRAL_MUL;
  return {
    w: clamp(evalSeries(series.x, series.w, series.mw, t), STATION_MIN, STATION_MAX),
    h: clamp(evalSeries(series.x, series.h, series.mh, t), STATION_MIN, STATION_MAX),
    dy: clamp(evalSeries(series.x, series.dy, series.md, t), -STATION_DY_MAX, STATION_DY_MAX),
  };
}

/** Index of the control point at `t` (within STATION_MERGE), or -1. */
export function stationIndexAt(list: FuseStation[], t: number): number {
  let best = -1;
  let bestD: number = STATION_MERGE;
  list.forEach((p, i) => {
    const d = Math.abs(p.s - t);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** Adds a control point at `t` or updates the one already there. */
export function upsertStation(list: FuseStation[], next: FuseStation): FuseStation[] {
  const st = sanitizeStations(list);
  const i = stationIndexAt(st, next.s);
  if (i >= 0) st[i] = { ...next, s: st[i].s };
  else st.push(next);
  return sanitizeStations(st);
}

/** Removes the control point at `t` (if any). */
export function removeStationNear(list: FuseStation[], t: number): FuseStation[] {
  const st = sanitizeStations(list);
  const i = stationIndexAt(st, t);
  if (i >= 0) st.splice(i, 1);
  return st;
}

/**
 * Adds a *localised* edit: a single control point would otherwise scale the
 * whole fuselage (constant hold before the first / after the last point), which
 * is not what "widen the section before the tail" means. When the new point has
 * no neighbour within `NEIGHBOUR_SPAN`, neutral anchors are placed on both sides
 * so the change is a smooth bump instead of a global scale.
 */
export const NEIGHBOUR_SPAN = 0.3;
export const ANCHOR_HALF_WIDTH = 0.12;

export function addStationLocalized(list: FuseStation[], next: FuseStation): FuseStation[] {
  const st = sanitizeStations(list);
  if (stationIndexAt(st, next.s) >= 0) return upsertStation(st, next);
  const out = st.slice();
  const hasLeft = st.some(p => p.s < next.s && next.s - p.s <= NEIGHBOUR_SPAN);
  const hasRight = st.some(p => p.s > next.s && p.s - next.s <= NEIGHBOUR_SPAN);
  if (!hasLeft && next.s - ANCHOR_HALF_WIDTH > 0) {
    out.push({ s: next.s - ANCHOR_HALF_WIDTH, w: 1, h: 1, dy: 0 });
  }
  if (!hasRight && next.s + ANCHOR_HALF_WIDTH < 1) {
    out.push({ s: next.s + ANCHOR_HALF_WIDTH, w: 1, h: 1, dy: 0 });
  }
  out.push(next);
  return sanitizeStations(out);
}

/** Sampled multipliers for the UI curve (n points from 0 to 1). */
export function sampleStations(list: FuseStation[], n = 33): { t: number; w: number; h: number; dy: number }[] {
  const series = prepareStations(list);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { t, ...stationMultipliers(series, t) };
  });
}
