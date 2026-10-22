import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { BATTERIES, SERVOS, COMPONENT_COLORS, type BalanceResult, type ComponentSettings, type ServoKey } from '../utils/components';
import type { Layout } from '../utils/geometry';

interface Props {
  balance: BalanceResult | null;
  settings: ComponentSettings;
  onChange: (s: ComponentSettings) => void;
  layout: Layout;
  /** Hide the servo/battery selectors when they are already shown elsewhere. */
  showChoices?: boolean;
}

const selectCls = 'w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-md text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white';

export default function MassBalancePanel({ balance, settings, onChange, layout, showChoices = true }: Props) {
  const { t } = useTranslation();
  if (!balance) return <div className="p-4 text-sm text-slate-500">—</div>;
  const b = balance;
  const mm = layout.toCm * 10;
  const refLabel = layout.isFW ? t('mb_from_root_le') : t('mb_from_firewall');
  const bat = b.items.find(i => i.id === 'battery')!;
  const cgOk = Math.abs(b.cgAchieved - b.cgTarget) < 2;
  const fromWingLe = (sMm: number) => sMm - layout.wing.leS * mm;

  // Group airframe rows to keep the table short
  const rows = [
    { key: 'airframe', label: t('mb_airframe'), mass: b.items.filter(i => i.kind === 'airframe').reduce((a, i) => a + i.mass, 0), detail: 'LW-PLA' },
    { key: 'spar', label: t('mb_spars'), mass: b.items.filter(i => i.kind === 'spar').reduce((a, i) => a + i.mass, 0), detail: t('mb_carbon') },
    ...b.items.filter(i => !['airframe', 'spar'].includes(i.kind)).map(i => ({
      key: i.id, label: t(i.labelKey), mass: i.mass, detail: i.detail ?? '', color: COMPONENT_COLORS[i.kind],
    })),
  ];

  return (
    <div className="p-4 space-y-4 text-slate-800 dark:text-slate-200 text-sm">

      {/* Component choices */}
      {showChoices && <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          <span className="block text-slate-500 dark:text-slate-400 mb-1">{t('mb_servos')}</span>
          <select className={selectCls} value={settings.servo} onChange={e => onChange({ ...settings, servo: e.target.value as ServoKey })}>
            {SERVOS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-slate-500 dark:text-slate-400 mb-1">{t('mb_battery')}</span>
          <select className={selectCls} value={settings.battery} onChange={e => onChange({ ...settings, battery: e.target.value })}>
            <option value="auto">{t('mb_auto')} ({b.battery.label})</option>
            {BATTERIES.map(bt => <option key={bt.key} value={bt.key}>{bt.label} · {bt.mass} g</option>)}
          </select>
        </label>
      </div>}

      {/* Key figures */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-2">
          <p className="text-slate-500 dark:text-slate-400">{t('mb_auw')}</p>
          <p className="text-lg font-semibold text-slate-900 dark:text-white">{Math.round(b.auw)} g</p>
          <p className="text-slate-400">{b.wingLoading.toFixed(1)} g/dm²</p>
        </div>
        <div className="rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-2">
          <p className="text-emerald-700 dark:text-emerald-400">{t('mb_battery_pos')}</p>
          <p className="text-lg font-semibold text-slate-900 dark:text-white">{Math.round(bat.s - bat.size![2] / 2)} mm</p>
          <p className="text-slate-500 dark:text-slate-400 leading-tight">{t('mb_battery_front')} {refLabel}</p>
        </div>
      </div>

      <div className={`flex gap-2 p-2 rounded-md text-xs border ${cgOk
        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
        : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'}`}>
        {cgOk ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
        <span>
          {t('mb_cg_line', { target: Math.round(fromWingLe(b.cgTarget)), achieved: Math.round(fromWingLe(b.cgAchieved)) })}
        </span>
      </div>

      {b.warnings.map(w => (
        <div key={w.key} className="flex gap-2 p-2 rounded-md text-xs border bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{t(w.key, w.params)}</span>
        </div>
      ))}

      {/* Mass table */}
      <div>
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t('mb_breakdown')}</div>
        <table className="w-full text-xs">
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-slate-100 dark:border-slate-700/60">
                <td className="py-1 pr-1">
                  <span className="inline-flex items-center gap-1.5">
                    {'color' in r && r.color && <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: r.color }} />}
                    {r.label}
                  </span>
                  {r.detail && <span className="block text-[10px] text-slate-400">{r.detail}</span>}
                </td>
                <td className="py-1 text-right tabular-nums">{r.mass.toFixed(0)} g</td>
                <td className="py-1 pl-2 text-right tabular-nums text-slate-400 w-10">{((r.mass / b.auw) * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Linkages */}
      {b.linkages.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t('mb_pushrods')}</div>
          <ul className="text-xs space-y-0.5">
            {b.linkages.map(l => <li key={l.id}>{t(`mb_${l.id}`)}: <b>{l.length} mm</b></li>)}
          </ul>
        </div>
      )}

      <p className="text-[11px] leading-snug text-slate-400">{t('mb_note')}</p>
    </div>
  );
}
