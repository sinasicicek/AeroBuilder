import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { AircraftMetrics, ValidationCheck, AircraftType } from '../utils/calculations';
import PerformanceChart from './PerformanceChart';

interface AnalysisPanelProps {
  metrics: AircraftMetrics;
  checks: ValidationCheck[];
  unit: 'cm' | 'mm';
  isDarkMode: boolean;
  aircraftType: AircraftType;
}

/** Aerodynamic analysis: warnings (with fixes) first, then the numbers. */
export default function AnalysisPanel({ metrics, checks, unit, isDarkMode, aircraftType }: AnalysisPanelProps) {
  const { t } = useTranslation();
  const [openFixId, setOpenFixId] = useState<string | null>(null);

  const formatNumber = (num: number, isArea = false) => {
    return `${num.toFixed(1)} ${unit}${isArea ? '²' : ''}`;
  };

  return (
    <div className="p-4 space-y-6 text-slate-800 dark:text-slate-200">
      {checks.length === 0 && (
        <div className="flex gap-2 p-3 rounded border text-sm bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          <p>{t('analysis_all_ok')}</p>
        </div>
      )}
          {/* Warnings Section */}
          {checks.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-3 pb-1 border-b border-slate-200 dark:border-slate-700">
                {t('analysis')}
              </h3>
              <div className="space-y-3">
                {checks.map(check => (
                  <div
                    key={check.id}
                    className={`p-3 rounded border text-sm ${
                      check.level === 'unstable'
                        ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                        : 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300'
                    }`}
                  >
                    <div className="flex gap-2">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                      <div className="flex flex-col w-full">
                        <p>{t(check.messageKey)}</p>
                        {check.fixKey && (
                          <>
                            <div
                              className="text-xs underline opacity-70 hover:opacity-100 mt-1 cursor-pointer flex items-center gap-1"
                              onClick={() => setOpenFixId(openFixId === check.id ? null : check.id)}
                            >
                              {openFixId === check.id ? t('hide_fix') : t('how_to_fix')}
                            </div>
                            {openFixId === check.id && (
                              <div className="mt-2 pt-2 border-t border-current opacity-70 text-xs leading-relaxed">
                                {t(check.fixKey)}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metrics Section */}
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-3 pb-1 border-b border-slate-200 dark:border-slate-700">
              {t('metrics')}
            </h3>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">{t('wing_area')}:</span>
                <span className="font-medium">{formatNumber(metrics.wingArea, true)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">{t('half_wing_area')}:</span>
                <span className="font-medium">{formatNumber(metrics.halfWingArea, true)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">{t('mac')}:</span>
                <span className="font-medium">{formatNumber(metrics.mac)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">{aircraftType === 'flying_wing' ? t('cg_position_fw', { sm: metrics.staticMargin.toFixed(0) }) : t('cg_position', { pct: (metrics.cgFraction * 100).toFixed(0) })}:</span>
                <span className="font-medium">{formatNumber(metrics.cgPosition)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">{t('neutral_point')}:</span>
                <span className="font-medium">{formatNumber(metrics.neutralPoint)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">{t('static_margin')}:</span>
                <span className="font-medium">{metrics.staticMargin.toFixed(1)}%</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">{t('aspect_ratio')}:</span>
                <span className="font-medium">{metrics.aspectRatio.toFixed(2)}</span>
              </li>
              {aircraftType !== 'flying_wing' && (
                <>
                  <li className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">{t('tail_moment_arm')}:</span>
                    <span className="font-medium">{formatNumber(metrics.tailMomentArm)}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">{t('hstab_area')}:</span>
                    <span className="font-medium">{formatNumber(metrics.hStabArea, true)}</span>
                  </li>
                </>
              )}
              <li className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">{t(aircraftType === 'flying_wing' ? 'winglet_area' : 'vstab_area')}:</span>
                <span className="font-medium">{formatNumber(metrics.vStabArea, true)}</span>
              </li>
            </ul>
          </div>

          {/* Performance Chart */}
          <div className="mb-6">
            <PerformanceChart metrics={metrics} unit={unit} isDarkMode={isDarkMode} aircraftType={aircraftType} />
          </div>

          {/* Control surfaces guidelines */}
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-3 pb-1 border-b border-slate-200 dark:border-slate-700">
              {t('control_surfaces')}
            </h3>
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded p-3 text-sm text-blue-800 dark:text-blue-300 space-y-2">
              <div className="flex gap-2">
                <Info size={16} className="shrink-0 mt-0.5 text-blue-500 dark:text-blue-400" />
                <p>{t(aircraftType === 'flying_wing' ? 'ailerons_rec_fw' : 'ailerons_rec')} — <b>{(metrics.aileronAreaRatio * 100).toFixed(1)}%</b></p>
              </div>
              {aircraftType !== 'flying_wing' && (
                <>
                  <div className="flex gap-2">
                    <Info size={16} className="shrink-0 mt-0.5 text-blue-500 dark:text-blue-400" />
                    <p>{t('elevator_rec')} — <b>{(metrics.elevatorAreaRatio * 100).toFixed(0)}%</b></p>
                  </div>
                  <div className="flex gap-2">
                    <Info size={16} className="shrink-0 mt-0.5 text-blue-500 dark:text-blue-400" />
                    <p>{t('rudder_rec')} — <b>{(metrics.rudderAreaRatio * 100).toFixed(0)}%</b></p>
                  </div>
                </>
              )}
            </div>
          </div>
            </div>
  );
}
