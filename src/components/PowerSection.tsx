import { useTranslation } from 'react-i18next';
import { BatteryCharging, CheckCircle2, AlertTriangle, ChevronRight } from 'lucide-react';
import Section from './ui/Section';
import { BATTERIES, SERVOS, type BalanceResult, type ComponentSettings, type ServoKey } from '../utils/components';
import { recommendMotorAndProp, type PowerCategory } from '../utils/electricSystem';
import type { AircraftDimensions, AircraftType } from '../utils/calculations';
import type { Layout } from '../utils/geometry';

interface Props {
  balance: BalanceResult | null;
  settings: ComponentSettings;
  onChange: (s: ComponentSettings) => void;
  layout: Layout;
  dimensions: AircraftDimensions;
  aircraftType: AircraftType;
  unit: 'cm' | 'mm';
  powerCategory: PowerCategory;
  onPowerCategory: (c: PowerCategory) => void;
  onOpenDetails: () => void;
}

const CATS: PowerCategory[] = ['trainer', 'sport', 'aerobatic'];
const selectCls = 'w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-white';

/** A single "choice → consequence" line under a selector. */
function Impact({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'ok' | 'bad' }) {
  const cls = tone === 'ok'
    ? 'text-emerald-700 dark:text-emerald-400'
    : tone === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400';
  return <p className={`mt-1 text-[11px] leading-snug ${cls}`}>{children}</p>;
}

/**
 * Sidebar section for the choices that change weight and balance: flight
 * category, battery and servos. Each choice shows its effect right below it,
 * so the full breakdown can live in the details drawer.
 */
export default function PowerSection({ balance, settings, onChange, layout, dimensions, aircraftType, unit, powerCategory, onPowerCategory, onOpenDetails }: Props) {
  const { t } = useTranslation();
  const rec = recommendMotorAndProp(dimensions, aircraftType, powerCategory, unit, balance?.auw);
  const b = balance;
  const bat = b?.items.find(i => i.id === 'battery');
  const servoCount = b ? b.items.filter(i => i.kind === 'servo').length : 0;
  const cgOk = b ? Math.abs(b.cgAchieved - b.cgTarget) < 2 && !b.ballast : true;
  const refLabel = layout.isFW ? t('mb_from_root_le') : t('mb_from_firewall');
  const ballastWarn = b?.warnings.find(w => w.key.endsWith('_ballast'));
  const powerOk = rec.powerRequired_W <= rec.motor.maxPower_W;

  return (
    <Section title={t('pw_title')} icon={<BatteryCharging size={16} />}>
      {/* Flight category */}
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t('pw_category')}</label>
      <div className="grid grid-cols-3 gap-1 p-0.5 mb-1 rounded-md bg-slate-100 dark:bg-slate-800">
        {CATS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => onPowerCategory(c)}
            aria-pressed={powerCategory === c}
            className={`py-1.5 rounded text-xs font-medium transition-colors ${powerCategory === c
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
          >
            {t(`pw_cat_${c}`)}
          </button>
        ))}
      </div>
      <Impact tone={powerOk ? 'muted' : 'bad'}>
        {t('pw_suggested', { motor: `${rec.motor.size} ${rec.motor.kv} KV`, esc: rec.esc_A, cells: rec.batteryCell, w: rec.powerRequired_W })}
      </Impact>

      {/* Battery */}
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 mt-3">{t('mb_battery')}</label>
      <select className={selectCls} value={settings.battery} onChange={e => onChange({ ...settings, battery: e.target.value })}>
        <option value="auto">{t('mb_auto')}{b && settings.battery === 'auto' ? ` (${b.battery.label} · ${b.battery.mass} g)` : ''}</option>
        {BATTERIES.map(bt => <option key={bt.key} value={bt.key}>{bt.label} · {bt.mass} g</option>)}
      </select>
      {b && bat && (
        <>
          <Impact>
            {t('pw_battery_share', { mass: Math.round(bat.mass), pct: Math.round((bat.mass / b.auw) * 100) })}
            {b.batteryAcross && <> · {t('pw_battery_across')}</>}
            {b.battery.cells !== rec.batteryCell && <> · <span className="text-amber-600 dark:text-amber-400">{t('pw_cells_mismatch', { cells: rec.batteryCell })}</span></>}
          </Impact>
          <Impact tone={cgOk ? 'ok' : 'bad'}>
            <span className="inline-flex items-start gap-1">
              {cgOk ? <CheckCircle2 size={12} className="shrink-0 mt-px" /> : <AlertTriangle size={12} className="shrink-0 mt-px" />}
              <span>
                {cgOk
                  ? t('pw_battery_pos', { mm: Math.round(bat.s - bat.size![2] / 2), ref: refLabel })
                  : ballastWarn
                    ? t(ballastWarn.key, ballastWarn.params)
                    : t('pw_cg_miss')}
              </span>
            </span>
          </Impact>
        </>
      )}

      {/* Servos */}
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 mt-3">{t('mb_servos')}</label>
      <select className={selectCls} value={settings.servo} onChange={e => onChange({ ...settings, servo: e.target.value as ServoKey })}>
        {SERVOS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      {b && servoCount > 0 && (
        <Impact>{t('pw_servos', { n: servoCount, mass: Math.round(b.servo.mass * servoCount) })}</Impact>
      )}

      {b && b.warnings.filter(w => w !== ballastWarn).map(w => (
        <p key={w.key} className="mt-2 flex gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          <AlertTriangle size={12} className="shrink-0 mt-px" /> <span>{t(w.key, w.params)}</span>
        </p>
      ))}

      <button
        type="button"
        onClick={onOpenDetails}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
      >
        {t('pw_details')} <ChevronRight size={13} />
      </button>
    </Section>
  );
}
