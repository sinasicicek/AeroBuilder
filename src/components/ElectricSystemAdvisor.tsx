import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Wind, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { recommendMotorAndProp, propNote } from '../utils/electricSystem';
import type { PowerCategory } from '../utils/electricSystem';
import type { AircraftDimensions, AircraftType } from '../utils/calculations';

interface ElectricSystemAdvisorProps {
  dimensions: AircraftDimensions;
  aircraftType: AircraftType;
  unit: 'cm' | 'mm';
  powerCategory: PowerCategory;
  /** All-up weight from the weight & balance model (g). */
  auw?: number;
}

export default function ElectricSystemAdvisor({ dimensions, aircraftType, unit, powerCategory, auw }: ElectricSystemAdvisorProps) {
  const { t, i18n } = useTranslation();
  const nf = new Intl.NumberFormat(i18n.language);

  const [notesOpen, setNotesOpen] = useState(false);

  const rec = recommendMotorAndProp(dimensions, aircraftType, powerCategory, unit, auw);

  const cellColor = rec.batteryCell === 2
    ? 'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-900/30 border-green-200 dark:border-green-800'
    : rec.batteryCell === 3
    ? 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'
    : 'text-orange-700 bg-orange-50 dark:text-orange-300 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800';

  const powerOk = rec.powerRequired_W <= rec.motor.maxPower_W;

  return (
    <div className="p-4 space-y-4 text-slate-800 dark:text-slate-200">

      {/* Category (chosen in the sidebar) */}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('el_category')}: <b className="text-slate-800 dark:text-slate-200">{t(`pw_cat_${powerCategory}`)}</b> · {t(`el_cat_desc_${powerCategory}`)}
      </p>

      {/* AUW estimate */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-50 dark:bg-slate-900/40 rounded border border-slate-200 dark:border-slate-700 p-2">
          <p className="text-slate-500 dark:text-slate-400">
            {auw ? t('el_auw_balance') : t('el_auw_est')}
          </p>
          <p className="text-lg font-semibold text-slate-900 dark:text-white mt-0.5">
            {rec.estimatedAUW_g} g
          </p>
          <p className="text-slate-400 mt-0.5">{rec.wingLoading_g_dm2} g/dm²</p>
        </div>
        <div className={`rounded border p-2 ${powerOk
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
          <p className={`${powerOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {t('el_power_req')}
          </p>
          <p className="text-lg font-semibold text-slate-900 dark:text-white mt-0.5">
            {rec.powerRequired_W} W
          </p>
          <p className="text-slate-400 mt-0.5">{rec.powerLoading_W_kg} W/kg</p>
        </div>
      </div>

      {/* Motor card */}
      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Zap size={14} className="text-amber-600 dark:text-amber-400" />
          <span className="text-xs font-bold uppercase text-amber-700 dark:text-amber-400 tracking-wider">
            {t('el_motor')}
          </span>
        </div>

        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-2xl font-bold text-slate-900 dark:text-white">
            {rec.motor.size}
          </span>
          <span className="text-base font-semibold text-amber-700 dark:text-amber-300">
            {rec.motor.kv} KV
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs mb-2">
          <div>
            <p className="text-slate-500 dark:text-slate-400">{t('el_max_power')}</p>
            <p className="font-semibold text-slate-800 dark:text-slate-100">{rec.motor.maxPower_W} W</p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">{t('el_max_current')}</p>
            <p className="font-semibold text-slate-800 dark:text-slate-100">{rec.motor.maxCurrent_A} A</p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">{t('el_weight')}</p>
            <p className="font-semibold text-slate-800 dark:text-slate-100">{rec.motor.weight_g} g</p>
          </div>
        </div>

        <div className="text-xs mb-2">
          <p className="text-slate-500 dark:text-slate-400 mb-0.5">
            {t('el_mount')}
          </p>
          <span className="font-mono bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded text-xs">
            {rec.motor.mountPattern_mm} mm
          </span>
        </div>

        <div className="text-xs">
          <p className="text-slate-500 dark:text-slate-400 mb-1">
            {t('el_examples')}
          </p>
          <div className="space-y-0.5">
            {rec.motor.examples.map(ex => (
              <p key={ex} className="text-slate-700 dark:text-slate-300">• {ex}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Propeller card */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Wind size={14} className="text-blue-600 dark:text-blue-400" />
          <span className="text-xs font-bold uppercase text-blue-700 dark:text-blue-400 tracking-wider">
            {t('el_prop')}
            <span className="ml-1 normal-case font-normal">
              ({rec.prop.type === 'pusher'
                ? t('el_pusher')
                : t('el_puller')})
            </span>
          </span>
        </div>

        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-2xl font-bold text-slate-900 dark:text-white">{rec.prop.label}</span>
          <span className="text-sm text-blue-600 dark:text-blue-300">
            {t('el_inch')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-slate-500 dark:text-slate-400">{t('el_diameter')}</p>
            <p className="font-semibold">{rec.prop.diameter_inch}"</p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">{t('el_pitch')}</p>
            <p className="font-semibold">{rec.prop.pitch_inch}"</p>
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{propNote(t, rec.prop)}</p>
      </div>

      {/* ESC + Battery cell */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-xs">
          <p className="text-slate-500 dark:text-slate-400 mb-1">{t('el_esc_min')}</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{rec.esc_A} A</p>
          <p className="text-slate-400 mt-0.5">
            {t('el_esc_margin')}
          </p>
        </div>
        <div className={`rounded border p-2.5 text-xs ${cellColor}`}>
          <p className="mb-1 opacity-70">
            {t('el_battery_rec')}
          </p>
          <p className="text-xl font-bold">{rec.batteryCell}S LiPo</p>
          <p className="mt-0.5 opacity-70">
            {t('el_nominal', { v: nf.format(+(rec.batteryCell * 3.7).toFixed(1)) })}
          </p>
        </div>
      </div>

      {/* Notes collapsible */}
      {rec.notes.length > 0 && (
        <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            onClick={() => setNotesOpen(o => !o)}
          >
            <span className="flex items-center gap-1.5">
              <Info size={13} />
              {t('el_notes')}
            </span>
            {notesOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {notesOpen && (
            <div className="px-3 py-2 space-y-1.5 bg-slate-50 dark:bg-slate-900/30 border-t border-slate-200 dark:border-slate-700">
              {rec.notes.map((note, i) => (
                <p key={i} className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  • {t(note.key, { ...note.params, rpm: typeof note.params?.rpm === 'number' ? nf.format(note.params.rpm) : note.params?.rpm })}
                </p>
              ))}
            </div>
          )}
        </div>
      )}


    </div>
  );
}
