/**
 * Runtime smoke test for the whole tail pipeline (mesh + STL plan + balance).
 * Any exception here would break the 3D view or the STL export for that tail.
 *
 * Run: tsc -> node (see scripts/README in PROJE-DOKUMAN).
 */
import { AIRCRAFT_PRESETS, DEFAULT_CONTROL_SURFACES, calculateMetrics, type TailType } from '../src/utils/calculations';
import { computeLayout } from '../src/utils/geometry';
import { buildAircraftParts } from '../src/utils/mesh';
import { buildPrintPlan, DEFAULT_PRINT_SETTINGS } from '../src/utils/printParts';
import { computeBalance, DEFAULT_COMPONENTS } from '../src/utils/components';

const dims = { ...AIRCRAFT_PRESETS[0].defaults };
const controls = DEFAULT_CONTROL_SURFACES.conventional;
const types: TailType[] = ['conventional', 't_tail', 'v_tail', 'inverted_v', 'cruciform'];

let fails = 0;
for (const tt of types) {
  try {
    const m = calculateMetrics(dims, 'conventional', controls, tt);
    const L = computeLayout(dims, 'conventional', controls, m, 'cm', 'trainer', 'prop_9x47', true, tt);
    const parts = buildAircraftParts(L, 'clarky');
    const plan = buildPrintPlan(L, 'clarky', DEFAULT_PRINT_SETTINGS, []);
    const bal = computeBalance(L, 'clarky', DEFAULT_COMPONENTS);
    // V-tail must not emit a vertical fin part, conventional/T/cruciform must
    const ids = [...parts.center, ...parts.right].map(p => p.id);
    const hasFin = ids.some(id => id === 'fin' || id === 'fin_ventral');
    const expectFin = tt !== 'v_tail' && tt !== 'inverted_v';
    const stabTris = parts.right.find(p => p.id === 'hstab')?.geometry.getAttribute('position').count ?? 0;
    const ok = hasFin === expectFin && stabTris > 0 && Number.isFinite(plan.sections.length) && bal.auw > 0;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${tt}: parts=${ids.length} fin=${hasFin} hstabVertices=${stabTris} sections=${plan.sections.length} auw=${bal.auw.toFixed(0)}g`);
  } catch (e) {
    fails++;
    console.log(`FAIL  ${tt}: ${(e as Error).message}`);
  }
}
console.log(fails === 0 ? '\nRUNTIME SMOKE PASSED' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
