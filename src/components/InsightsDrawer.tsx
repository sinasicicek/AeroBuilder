import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Activity, Scale, Zap } from 'lucide-react';
import AnalysisPanel from './AnalysisPanel';
import MassBalancePanel from './MassBalancePanel';
import ElectricSystemAdvisor from './ElectricSystemAdvisor';
import type { AircraftDimensions, AircraftMetrics, AircraftType, ValidationCheck } from '../utils/calculations';
import type { BalanceResult, ComponentSettings } from '../utils/components';
import type { PowerCategory } from '../utils/electricSystem';
import type { Layout } from '../utils/geometry';

export type InsightsTab = 'analysis' | 'weight' | 'electric';

interface Props {
  tab: InsightsTab | null;
  onTab: (t: InsightsTab) => void;
  onClose: () => void;
  metrics: AircraftMetrics;
  checks: ValidationCheck[];
  unit: 'cm' | 'mm';
  isDarkMode: boolean;
  aircraftType: AircraftType;
  dimensions: AircraftDimensions;
  balance: BalanceResult | null;
  components: ComponentSettings;
  onComponentsChange: (c: ComponentSettings) => void;
  layout: Layout;
  powerCategory: PowerCategory;
}

const TABS: { id: InsightsTab; icon: typeof Activity; key: string }[] = [
  { id: 'analysis', icon: Activity, key: 'ins_analysis' },
  { id: 'weight', icon: Scale, key: 'mb_tab' },
  { id: 'electric', icon: Zap, key: 'ins_electric' },
];

/**
 * Details on demand: analysis, weight breakdown and electric system slide in
 * over the model view instead of occupying a permanent column.
 */
export default function InsightsDrawer(p: Props) {
  const { t } = useTranslation();
  const { tab, onClose } = p;

  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, onClose]);

  if (!tab) return null;
  const warnCount = p.checks.length;

  return (
    <aside
      role="dialog"
      aria-label={t('ins_title')}
      className="fixed inset-0 lg:absolute lg:inset-auto lg:top-3 lg:right-3 lg:bottom-3 lg:w-[380px] z-30 flex flex-col bg-white dark:bg-slate-900 lg:rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
    >
      <div className="flex items-center gap-1 px-2 pt-2 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
        {TABS.map(({ id, icon: Icon, key }) => (
          <button
            key={id}
            type="button"
            onClick={() => p.onTab(id)}
            aria-pressed={tab === id}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${tab === id
              ? 'border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
          >
            <Icon size={13} />
            {t(key)}
            {id === 'analysis' && warnCount > 0 && (
              <span className="ml-0.5 min-w-[16px] px-1 rounded-full text-[10px] leading-4 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">{warnCount}</span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="ml-auto mb-1 p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'analysis' && (
          <AnalysisPanel metrics={p.metrics} checks={p.checks} unit={p.unit} isDarkMode={p.isDarkMode} aircraftType={p.aircraftType} />
        )}
        {tab === 'weight' && (
          <MassBalancePanel balance={p.balance} settings={p.components} onChange={p.onComponentsChange} layout={p.layout} showChoices={false} />
        )}
        {tab === 'electric' && (
          <ElectricSystemAdvisor dimensions={p.dimensions} aircraftType={p.aircraftType} unit={p.unit} powerCategory={p.powerCategory} auw={p.balance?.auw} />
        )}
      </div>
    </aside>
  );
}
