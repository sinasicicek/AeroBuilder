import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plane } from 'lucide-react';
import { EXAMPLES, type ExampleProject } from '../utils/examples';
import { calculateMetrics } from '../utils/calculations';
import { computeLayout } from '../utils/geometry';
import { computeBalance } from '../utils/components';

interface Props {
  open: boolean;
  onClose: () => void;
  onLoad: (ex: ExampleProject) => void;
}

/** Planform thumbnail drawn from the example's own dimensions. */
function Thumb({ ex }: { ex: ExampleProject }) {
  const d = ex.state.dimensions;
  const isFW = ex.state.aircraftType === 'flying_wing';
  const hs = d.wingspan / 2;
  const len = isFW ? d.sweepOffset + Math.max(d.rootChord, d.tipChord) : d.fuselageLength;
  const W = 120, H = 70, pad = 6;
  const k = Math.min((W - 2 * pad) / d.wingspan, (H - 2 * pad) / len);
  const x = (v: number) => W / 2 + v * k;
  const y = (v: number) => pad + v * k;
  const nl = isFW ? 0 : d.noseLength;
  const wing = `M${x(0)},${y(nl)} L${x(hs)},${y(nl + d.sweepOffset)} L${x(hs)},${y(nl + d.sweepOffset + d.tipChord)} L${x(0)},${y(nl + d.rootChord)} L${x(-hs)},${y(nl + d.sweepOffset + d.tipChord)} L${x(-hs)},${y(nl + d.sweepOffset)} Z`;
  const tailLe = nl + d.rootChord + d.wingToTailDistance;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" aria-hidden="true">
      {!isFW && <rect x={x(-(d.fuselageWidth || 7) / 2)} y={y(0)} width={(d.fuselageWidth || 7) * k} height={d.fuselageLength * k} rx={2} className="fill-slate-300 dark:fill-slate-600" />}
      <path d={wing} className="fill-sky-200 stroke-sky-600 dark:fill-sky-800 dark:stroke-sky-400" strokeWidth={1} />
      {!isFW && <rect x={x(-d.hStabSpan / 2)} y={y(tailLe)} width={d.hStabSpan * k} height={d.hStabChord * k} className="fill-pink-200 stroke-pink-600 dark:fill-pink-900 dark:stroke-pink-400" strokeWidth={1} />}
    </svg>
  );
}

export default function ExamplesDialog({ open, onClose, onLoad }: Props) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    if (!open) return {};
    const out: Record<string, { auw: number; sm: number }> = {};
    EXAMPLES.forEach(ex => {
      try {
        const st = ex.state;
        const m = calculateMetrics(st.dimensions, st.aircraftType, st.controls, st.tailType ?? 'conventional');
        const L = computeLayout(st.dimensions, st.aircraftType, st.controls, m, 'cm', st.fuselageStyle, st.propeller, st.propCutout, st.tailType ?? 'conventional');
        const b = computeBalance(L, st.airfoil, st.components);
        out[ex.id] = { auw: b.auw, sm: m.staticMargin };
      } catch { /* ignore */ }
    });
    return out;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="examples-title">
      <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur">
          <div>
            <h2 id="examples-title" className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2"><Plane size={18} className="text-sky-600" /> {t('examples_title')}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('examples_sub')}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t('close')}><X size={18} /></button>
        </div>
        <div className="p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {EXAMPLES.map(ex => {
            const st = stats[ex.id];
            return (
              <button
                key={ex.id}
                onClick={() => onLoad(ex)}
                className="text-left rounded-xl border border-slate-200 dark:border-slate-700 hover:border-sky-400 dark:hover:border-sky-500 hover:shadow-md transition-all bg-slate-50/60 dark:bg-slate-800/50 overflow-hidden group"
              >
                <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-3 pt-2"><Thumb ex={ex} /></div>
                <div className="p-3">
                  <div className="font-semibold text-sm text-slate-900 dark:text-white group-hover:text-sky-700 dark:group-hover:text-sky-300">{t(`ex_${ex.id}_name`)}</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-snug">{t(`ex_${ex.id}_desc`)}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ex.tags.map(tg => <span key={tg} className="px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-300 text-[10.5px] font-medium">{tg.startsWith('tag_') ? t(tg) : tg}</span>)}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-[10.5px] text-slate-500 dark:text-slate-400">
                    <span><b className="block text-slate-800 dark:text-slate-100 text-xs tabular-nums">{ex.state.dimensions.wingspan} cm</b>{t('wingspan')}</span>
                    <span><b className="block text-slate-800 dark:text-slate-100 text-xs tabular-nums">{st ? `${Math.round(st.auw)} g` : '—'}</b>{t('mb_auw_short')}</span>
                    <span><b className="block text-slate-800 dark:text-slate-100 text-xs tabular-nums">{st ? `${st.sm.toFixed(0)}%` : '—'}</b>{t('static_margin_short')}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <p className="px-5 pb-5 text-[11px] text-slate-400">{t('examples_note')}</p>
      </div>
    </div>
  );
}
