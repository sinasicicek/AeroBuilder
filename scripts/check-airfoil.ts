/**
 * Airfoil thickness/spec smoke test.
 * - Natural spec and "@natural" must be identical.
 * - Camber line must be preserved when scaling thickness.
 * - Every selectable profile must produce a sane, closed section.
 * - The whole pipeline (metrics → layout → mesh → print plan → balance) must
 *   run for an explicit-thickness spec without NaN.
 *
 * Run: npx tsc scripts/check-airfoil.ts --ignoreConfig --module esnext \
 *        --target es2022 --moduleResolution bundler --outDir /tmp/afcheck
 *      node /tmp/afcheck/scripts/check-airfoil.js
 */
import { AIRCRAFT_PRESETS, DEFAULT_CONTROL_SURFACES, calculateMetrics, type AirfoilSpec } from '../src/utils/calculations';
import { computeLayout } from '../src/utils/geometry';
import { buildAircraftParts } from '../src/utils/mesh';
import { buildPrintPlan, DEFAULT_PRINT_SETTINGS } from '../src/utils/printParts';
import { computeBalance, DEFAULT_COMPONENTS } from '../src/utils/components';
import { AIRFOIL_TYPES, airfoilNaturalPct, getAirfoil, makeAirfoilSpec, splitAirfoilSpec } from '../src/utils/airfoils';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) { fails++; console.log('  FAIL', msg); }
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

const xs = Array.from({ length: 21 }, (_, i) => i / 20);

// 1. Every profile is sane: leading edge ~closed, finite, thickness in range
for (const t of AIRFOIL_TYPES) {
  const af = getAirfoil(t);
  const bad = xs.some(x => !Number.isFinite(af.upper(x)) || !Number.isFinite(af.lower(x)));
  ok(!bad, `${t}: NaN in section`);
  ok(af.thickness > 0.05 && af.thickness < 0.2, `${t}: thickness ${af.thickness} out of range`);
  ok(af.upper(1) >= af.lower(1) - 1e-6, `${t}: upper below lower at TE`);
  ok(af.upper(0.02) > af.lower(0.02), `${t}: no thickness near LE`);
}

// 2. NACA digits are honoured
ok(near(getAirfoil('naca2412').thickness, 0.12, 1e-6), 'naca2412 thickness != 12%');
ok(near(getAirfoil('naca0009').thickness, 0.09, 1e-6), 'naca0009 thickness != 9%');
ok(near(getAirfoil('naca4415').thickness, 0.15, 1e-6), 'naca4415 thickness != 15%');
ok(near(getAirfoil('naca6409').thickness, 0.09, 1e-6), 'naca6409 thickness != 9%');

// 3. makeAirfoilSpec: natural value collapses to the bare type
for (const t of AIRFOIL_TYPES) {
  ok(makeAirfoilSpec(t, airfoilNaturalPct(t)) === t, `${t}: natural pct did not collapse`);
  ok(makeAirfoilSpec(t, null) === t, `${t}: null pct did not collapse`);
}
const spec = makeAirfoilSpec('naca2412', 14);
ok(spec === ('naca2412@14' as AirfoilSpec), `makeAirfoilSpec -> ${spec}`);
ok(splitAirfoilSpec(spec).pct === 14, 'split pct');
ok(splitAirfoilSpec('clarky').pct === undefined, 'split bare');

// 4. Scaled section: target thickness reached, camber preserved
for (const t of AIRFOIL_TYPES) {
  const base = getAirfoil(t);
  const natural = airfoilNaturalPct(t);
  const thicker = getAirfoil(makeAirfoilSpec(t, Math.min(20, natural + 4)));
  const thinner = getAirfoil(makeAirfoilSpec(t, Math.max(5, natural - 4)));
  ok(thicker.thickness > base.thickness, `${t}: thicker not thicker`);
  ok(thinner.thickness < base.thickness, `${t}: thinner not thinner`);
  // spec, 0.1 pt adımlara yuvarlanır → tolerans 0.06
  ok(near(thicker.thickness * 100, Math.min(20, natural + 4), 0.06), `${t}: thicker target missed`);
  // camber (mean line) must not move
  for (const x of xs) {
    const cBase = (base.upper(x) + base.lower(x)) / 2;
    const cNew = (thicker.upper(x) + thicker.lower(x)) / 2;
    ok(near(cBase, cNew, 1e-12), `${t}: camber moved at x=${x}`);
  }
}

// 5. Full pipeline with an explicit thickness
const dims = { ...AIRCRAFT_PRESETS[0].defaults };
const controls = DEFAULT_CONTROL_SURFACES.conventional;
for (const s of ['clarky', 'naca2412@14', 'naca6409@8', 'naca4415@17'] as AirfoilSpec[]) {
  try {
    const metrics = calculateMetrics(dims, 'conventional', controls);
    const layout = computeLayout(dims, 'conventional', controls, metrics, 'cm', 'trainer', 'prop_9x47', true, 'conventional');
    const parts = buildAircraftParts(layout, s);
    ok(parts.right.length + parts.center.length > 0, `${s}: no mesh parts`);
    const plan = buildPrintPlan(layout, s, DEFAULT_PRINT_SETTINGS, []);
    ok(plan.sections.length > 0, `${s}: no print sections`);
    const bal = computeBalance(layout, s, DEFAULT_COMPONENTS, plan);
    ok(Number.isFinite(bal.auw) && bal.auw > 0, `${s}: bad AUW`);
  } catch (e) {
    fails++;
    console.log('  FAIL pipeline', s, e);
  }
}

// 6. The 3B mesh really gets thicker (not just the 2B section)
{
  const metrics = calculateMetrics(dims, 'conventional', controls);
  const layout = computeLayout(dims, 'conventional', controls, metrics, 'cm', 'trainer', 'prop_9x47', true, 'conventional');
  const rootY = (spec: AirfoilSpec) => {
    const parts = buildAircraftParts(layout, spec);
    const wing = [...parts.right, ...parts.center].filter(p => p.kind === 'wing');
    const ys: number[] = [];
    for (const p of wing) {
      // kanat: X = açıklık, Z = veter, Y = kalınlık yönü. Sadece kök dilimi (X ≈ 0).
      const arr = p.geometry.getAttribute('position').array as ArrayLike<number>;
      for (let i = 0; i < arr.length; i += 3) if (Math.abs(arr[i]) <= 0.5) ys.push(arr[i + 1]);
    }
    return ys;
  };
  const thin = rootY('clarky@8');
  const thick = rootY('clarky@16');
  ok(thin.length === thick.length && thin.length > 0, 'mesh topology changed with thickness');
  let maxDelta = 0;
  for (let i = 0; i < thin.length; i++) maxDelta = Math.max(maxDelta, Math.abs(thick[i] - thin[i]));
  const topThin = Math.max(...thin), botThin = Math.min(...thin);
  const topThick = Math.max(...thick), botThick = Math.min(...thick);
  ok(topThick > topThin && botThick < botThin, 'mesh did not get thicker on both surfaces');
  ok(maxDelta > 0.4, `mesh thickness delta too small (${maxDelta.toFixed(2)} layout birimi)`);
  console.log('  mesh kök kesiti Y: 8% ->', (topThin - botThin).toFixed(2), ', 16% ->', (topThick - botThick).toFixed(2), ', maks kayma', maxDelta.toFixed(2), '(layout birimi)');
}

console.log(fails === 0 ? 'AIRFOIL OK' : `AIRFOIL ${fails} FAIL`);
