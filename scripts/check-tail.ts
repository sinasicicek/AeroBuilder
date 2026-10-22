/**
 * Tail-layout regression check.
 *
 * 1) Conventional tail must reproduce the pre-tail-type numbers bit for bit
 *    (the formulas are re-derived here from the old implementation).
 * 2) Each recipe must produce the geometry it promises (V panels, T mount,
 *    ventral fin, projected span).
 *
 * Run: node_modules/.bin/sucrase-node scripts/check-tail.ts
 */
import { AIRCRAFT_PRESETS, DEFAULT_CONTROL_SURFACES, calculateMetrics, type TailType } from '../src/utils/calculations';
import { computeLayout } from '../src/utils/geometry';

const dims = { ...AIRCRAFT_PRESETS[0].defaults };
const controls = DEFAULT_CONTROL_SURFACES.conventional;

// Reference: the tail block exactly as it was before tail types existed.
const REF = (() => {
  const noseLength = dims.noseLength;
  const rootChord = dims.rootChord;
  const hLe = noseLength + rootChord + dims.wingToTailDistance;
  const hc = dims.hStabChord;
  const vc = dims.vStabChord;
  const finLe = hLe + hc - vc;
  return { hLe, hc, vc, finLe };
})();

let fails = 0;
const eq = (name: string, a: number, b: number, tol = 0) => {
  const ok = Math.abs(a - b) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${a} vs ${b}`);
};

const metricsFor = (t: TailType) => calculateMetrics(dims, 'conventional', controls, t);
const layoutFor = (t: TailType) => computeLayout(dims, 'conventional', controls, metricsFor(t), 'cm', 'trainer', 'prop_9x47', true, t);

// ── 1. Conventional = old numbers ──
const base = layoutFor('conventional');
console.log('— conventional baseline —');
eq('hStab.leS', base.hStab!.leS, REF.hLe);
eq('hStab.span', base.hStab!.span, dims.hStabSpan);
eq('hStab.rootChord', base.hStab!.rootChord, REF.hc);
eq('fin.leS', base.fin!.leS, REF.finLe);
eq('fin.span', base.fin!.span, dims.vStabSpan);
eq('fin.rootChord', base.fin!.rootChord, REF.vc);
eq('hStab.rollRad', base.hStab!.rollRad ?? 0, 0);
eq('fin.ventral', base.fin!.ventral ?? 0, 0);
eq('tail.type', base.tail.vAngleDeg, 0);
eq('cgS', base.cgS, dims.noseLength + calculateMetrics(dims).cgPosition);
eq('npS', base.npS, dims.noseLength + calculateMetrics(dims).neutralPoint);
eq('bounds.xMax', base.bounds.xMax, Math.max(dims.wingspan / 2, dims.hStabSpan / 2, base.prop.diameter / 2));

// ── 2. V-tail ──
const v = layoutFor('v_tail');
console.log('— V-tail —');
eq('no vertical fin', v.fin === null ? 1 : 0, 1);
eq('roll angle', v.hStab!.rollRad!, (38 * Math.PI) / 180, 1e-12);
eq('projected half span', (v.hStab!.span / 2) * Math.cos(v.hStab!.rollRad!), dims.hStabSpan / 2, 1e-9);
eq('panel above root', Math.sin(v.hStab!.rollRad!) > 0 ? 1 : 0, 1);
eq('vertical area ≈ hStabArea·tan38', metricsFor('v_tail').vStabArea, dims.hStabSpan * dims.hStabChord * Math.tan((38 * Math.PI) / 180), 1e-9);
eq('top-view half span == hStabSpan/2', (v.hStab!.span / 2) * Math.cos(v.hStab!.rollRad!), dims.hStabSpan / 2, 1e-9);

// ── 3. Inverted V ──
const iv = layoutFor('inverted_v');
console.log('— inverted V —');
eq('roll angle', iv.hStab!.rollRad!, (-38 * Math.PI) / 180, 1e-12);
eq('panel below root', Math.sin(iv.hStab!.rollRad!) < 0 ? 1 : 0, 1);

// ── 4. T-tail ──
const t = layoutFor('t_tail');
console.log('— T-tail —');
eq('stab on fin tip', t.hStab!.y, t.fin!.y + t.fin!.span, 1e-9);
eq('fin present', t.fin ? 1 : 0, 1);
eq('higher than conventional', t.hStab!.y > base.hStab!.y ? 1 : 0, 1);

// ── 5. Cruciform ──
const cr = layoutFor('cruciform');
console.log('— cruciform —');
eq('ventral length', cr.fin!.ventral ?? 0, dims.vStabSpan * 0.45, 1e-9);
eq('stab at conventional height', cr.hStab!.y, base.hStab!.y, 1e-9);

// ── 6. No crash for every recipe / any fuselage style ──
console.log('— smoke —');
const styles = ['trainer', 'sport', 'pod', 'slab', 'boom', 'box', 'egg', 'faceted', 'custom'] as const;
const types: TailType[] = ['conventional', 't_tail', 'v_tail', 'inverted_v', 'cruciform'];
let smoke = 0;
for (const s of styles) for (const tt of types) {
  const L = computeLayout(dims, 'conventional', controls, metricsFor(tt), 'cm', s, 'prop_9x47', true, tt);
  if (!L.hStab || !Number.isFinite(L.bounds.yMax) || !Number.isFinite(L.bounds.xMax)) { smoke++; console.log('FAIL', s, tt, L.bounds); }
}
eq('layout smoke failures', smoke, 0);

// Flying wing must stay untouched (no tail)
const fw = computeLayout(dims, 'flying_wing', controls, calculateMetrics(dims, 'flying_wing'), 'cm', 'trainer', 'prop_8x45P', true, 'v_tail');
eq('flying wing has no stab', fw.hStab === null ? 1 : 0, 1);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
