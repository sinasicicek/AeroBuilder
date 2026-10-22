import { useTranslation } from 'react-i18next';
import { PanelRightOpen } from 'lucide-react';
import type { InsightsTab } from './InsightsDrawer';
import type { AircraftMetrics, ValidationCheck } from '../utils/calculations';
import type { BalanceResult } from '../utils/components';
import type { Layout } from '../utils/geometry';

interface Props {
  metrics: AircraftMetrics;
  checks: ValidationCheck[];
  balance: BalanceResult | null;
  layout: Layout;
  unit: 'cm' | 'mm';
  onOpen: (tab: InsightsTab) => void;
}

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
const toneCls: Record<Tone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  neutral: 'text-slate-900 dark:text-white',
};
const dotCls: Record<Tone, string> = {
  ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', neutral: 'bg-slate-300 dark:bg-slate-600',
};

/** Project summary strip: the handful of numbers a modeller checks first. */
export default function KpiBar({ metrics, checks, balance, layout, unit, onOpen }: Props) {
  const { t } = useTranslation();
  const dec = unit === 'mm' ? 0 : 1;
  const areaDm2 = metrics.wingArea * (unit === 'mm' ? 1e-4 : 1e-2);
  const sm = metrics.staticMargin;
  const smTone: Tone = sm < 5 ? 'bad' : sm > 20 ? 'warn' : 'ok';
  const ar = metrics.aspectRatio;
  const arTone: Tone = ar < 4.5 || ar > 8 ? 'warn' : 'ok';
  const wl = balance?.wingLoading ?? 0;
  // Typical: park flyers / trainers 20–40 g/dm², sport 40–60
  const wlTone: Tone = !balance ? 'neutral' : wl > 60 ? 'bad' : wl > 45 ? 'warn' : 'ok';
  const status: Tone = checks.some(c => c.level === 'unstable') ? 'bad' : checks.some(c => c.level === 'warning') ? 'warn' : 'ok';

  const items: { label: string; value: string; sub?: string; tone: Tone; tab: InsightsTab }[] = [
    { label: t('wingspan'), value: `${(layout.wing.halfSpan * 2).toFixed(dec)} ${unit}`, tone: 'neutral', tab: 'analysis' },
    { label: t('wing_area'), value: `${areaDm2.toFixed(1)} dm²`, tone: 'neutral', tab: 'analysis' },
    { label: t('aspect_ratio_short'), value: ar.toFixed(2), tone: arTone, tab: 'analysis' },
    { label: t('mb_auw_short'), value: balance ? `${Math.round(balance.auw)} g` : '—', sub: balance ? `${balance.battery.label}` : undefined, tone: 'neutral', tab: 'weight' },
    { label: t('wing_loading'), value: balance ? `${wl.toFixed(1)} g/dm²` : '—', tone: wlTone, tab: 'weight' },
    { label: t('static_margin_short'), value: `${sm.toFixed(1)}%`, tone: smTone, tab: 'analysis' },
    { label: t('cg_short'), value: `${metrics.cgPosition.toFixed(dec)} ${unit}`, sub: t('kpi_cg_sub'), tone: 'neutral', tab: 'weight' },
  ];

  const warnCount = checks.length;
  const cardCls = 'min-w-[104px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-left hover:border-sky-300 dark:hover:border-sky-700 hover:shadow-sm transition';

  return (
    <div className="flex-shrink-0 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
      <div className="flex items-stretch gap-2 px-3 sm:px-4 py-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => onOpen('analysis')}
          title={t('ins_open_analysis')}
          className={`flex flex-col justify-center items-start pr-3 mr-1 border-r border-slate-200 dark:border-slate-700 text-xs font-semibold whitespace-nowrap hover:opacity-80 ${toneCls[status]}`}
        >
          <span className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${dotCls[status]}`} />
            {t(status === 'ok' ? 'status_stable' : status === 'warn' ? 'status_warning' : 'status_unstable')}
          </span>
          <span className="pl-[18px] text-[10.5px] font-normal text-slate-500 dark:text-slate-400">
            {warnCount > 0 ? t('ins_n_warnings', { count: warnCount }) : t('ins_no_warnings')}
          </span>
        </button>
        {items.map(it => (
          <button type="button" key={it.label} onClick={() => onOpen(it.tab)} className={cardCls}>
            <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">
              {it.tone !== 'neutral' && <span className={`w-1.5 h-1.5 rounded-full ${dotCls[it.tone]}`} />}
              {it.label}
            </div>
            <div className={`text-[15px] font-semibold tabular-nums whitespace-nowrap ${toneCls[it.tone]}`}>{it.value}</div>
            {it.sub && <div className="text-[10px] text-slate-400 whitespace-nowrap">{it.sub}</div>}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onOpen('analysis')}
          className="ml-auto self-center flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
        >
          <PanelRightOpen size={14} /> {t('ins_details')}
        </button>
      </div>
    </div>
  );
}
