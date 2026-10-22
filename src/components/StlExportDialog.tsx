import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../utils/analytics';
import { X, Download, Printer, AlertTriangle, Info } from 'lucide-react';
import type { TailType, AirfoilSpec } from '../utils/calculations';
import type { Layout } from '../utils/geometry';
import type { PrintSettings, Pocket } from '../utils/printParts';
import type { BalanceResult } from '../utils/components';
import type { OrientedSection } from '../utils/stlExport';
import type { PrintPlan } from '../utils/printParts';
import { defaultName, saveSet, type ArchivedProject } from '../utils/stlArchive';

interface Props {
  open: boolean;
  onClose: () => void;
  layout: Layout;
  airfoil: AirfoilSpec;
  tailType: TailType;
  settings: PrintSettings;
  onSettingsChange: (s: PrintSettings) => void;
  pockets: Pocket[];
  balance: BalanceResult | null;
  /** full project snapshot stored alongside the STL set */
  project: ArchivedProject;
  /** design-library model this set belongs to (optional) */
  modelId?: string | null;
  modelName?: string;
}

const BED_PRESETS: { label: string; x: number; y: number; z: number }[] = [
  { label: 'Ender 3 / Kobra / Neptune — 220×220×250', x: 220, y: 220, z: 250 },
  { label: 'Bambu Lab P1S / X1C / A1 — 256×256×256', x: 256, y: 256, z: 256 },
  { label: 'Prusa MK4 — 250×210×220', x: 250, y: 210, z: 220 },
  { label: 'Bambu A1 mini / Prusa MINI — 180×180×180', x: 180, y: 180, z: 180 },
  { label: 'Voron 350 / Ender 5 Plus — 350×350×350', x: 350, y: 350, z: 350 },
];

const KIND_KEYS: Record<string, string> = {
  fuselage: 'fuselage', wing: 'wing', aileron: 'ailerons', hstab: 'hstab_short',
  elevator: 'elevator', fin: 'fin_short', rudder: 'rudder', winglet: 'winglets',
  mount: 'stl_mounts', hatch: 'stl_hatches', joint: 'stl_joints',
};

export default function StlExportDialog({ open, onClose, layout, airfoil, tailType, settings, onSettingsChange, pockets, balance, project, modelId, modelName }: Props) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ plan: PrintPlan; oriented: OrientedSection[] } | null>(null);
  // Fit-test kit is a one-off choice in this dialog (not saved with the project)
  const [kit, setKit] = useState(false);
  const eff = useMemo(() => ({ ...settings, kit }), [settings, kit]);

  // Clear the archive status line whenever the dialog is reopened
  useEffect(() => { if (open) { setSaveMsg(null); setSaving(false); } }, [open]);

  // Compute the plan (lazy-loaded exporter) whenever the dialog is open and inputs change
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    import('../utils/stlExport').then(m => {
      if (cancelled) return;
      const r = m.planAndOrient(layout, airfoil, eff, pockets, balance);
      setResult(r);
    });
    return () => { cancelled = true; };
  }, [open, layout, airfoil, eff, pockets, balance]);

  // Free the geometries built for the summary
  useEffect(() => () => {
    result?.oriented.forEach(o => o.geometry.dispose());
    result?.plan.sections.forEach(s => s.geometry.dispose());
  }, [result]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const byKind = useMemo(() => {
    const m: Record<string, number> = {};
    result?.oriented.forEach(o => { m[o.section.kind] = (m[o.section.kind] ?? 0) + 1; });
    return m;
  }, [result]);
  const notFit = result?.oriented.filter(o => !o.fits) ?? [];
  const tallest = result ? Math.max(...result.oriented.map(o => o.size[2])) : 0;

  if (!open) return null;

  const download = async () => {
    setBusy(true);
    try {
      const m = await import('../utils/stlExport');
      const r = m.exportSTLZip(layout, airfoil, eff, i18n.language, (k, o) => t(k, o), pockets, balance);
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement('a');
      a.href = url;
      const pt = i18n.language.startsWith('pt');
      a.download = `aerobuilder-${layout.isFW ? (pt ? 'asa-voadora' : 'flying-wing') : (pt ? 'convencional' : 'conventional')}-${kit ? (pt ? 'kit-teste' : 'fit-test-kit') : 'stl'}.zip`;
      track('export_stl', { aircraft_type: layout.isFW ? 'flying_wing' : 'conventional', parts: r.oriented.length, kit });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      r.oriented.forEach(o => o.geometry.dispose());
      r.plan.sections.forEach(s => s.geometry.dispose());
    } catch (e) {
      console.error('STL export failed', e);
    }
    setBusy(false);
  };

  /**
   * Stores the exact same STL set in the on-device archive (IndexedDB), together
   * with the project snapshot so the design can be restored later.
   */
  const saveToArchive = async () => {
    if (!result) return;
    const kind: 'full' | 'kit' = kit ? 'kit' : 'full';
    const suggested = defaultName({ aircraftType: layout.isFW ? 'flying_wing' : 'conventional', kind });
    const name = window.prompt(t('stl_save_name'), suggested);
    if (name === null) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const m = await import('../utils/stlExport');
      const { files } = m.buildStlFiles(result.plan, result.oriented, layout, i18n.language, (k, o) => t(k, o), pockets, balance);
      const previewPath = Object.keys(files).find(k => /(^|\/)00_/.test(k));
      const bytesReadme = files[Object.keys(files).find(k => k.toLowerCase().endsWith('.txt')) ?? '']?.byteLength ?? 0;
      const bytes = Object.values(files).reduce((n, f) => n + f.byteLength, 0) - bytesReadme;
      await saveSet({
        name,
        files,
        previewPath,
        project,
        meta: {
          kind,
          aircraftType: layout.isFW ? 'flying_wing' : 'conventional',
          tailType,
          airfoil,
          parts: result.oriented.length,
          bytes,
          bed: { x: eff.bedX, y: eff.bedY, z: eff.bedZ },
          warnings: result.plan.warnings.length,
          notFit: notFit.length,
          modelId: modelId ?? undefined,
          modelName: modelId ? modelName : undefined,
        },
      });
      track('archive_stl_save', { aircraft_type: layout.isFW ? 'flying_wing' : 'conventional', parts: result.oriented.length, kit });
      setSaveMsg(t('stl_saved_archive'));
    } catch (e) {
      console.error('Archive save failed', e);
      setSaveMsg(t('archive_error', { msg: (e as Error).message }));
    }
    setSaving(false);
  };

  const num = (key: 'bedX' | 'bedY' | 'bedZ') => (
    <input
      type="number"
      min={100}
      max={1000}
      value={settings[key]}
      onChange={e => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v) && v >= 100 && v <= 1000) onSettingsChange({ ...settings, [key]: v });
      }}
      className="w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
    />
  );
  const presetIdx = BED_PRESETS.findIndex(p => p.x === settings.bedX && p.y === settings.bedY && p.z === settings.bedZ);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/40" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="stl-title">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 shadow-2xl text-slate-800 dark:text-slate-100" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 id="stl-title" className="text-lg font-semibold flex items-center gap-2"><Printer size={20} /> {t('stl_title')}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700" aria-label={t('close')}><X size={20} /></button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{t('stl_intro')}</p>

          {/* What to export: the whole aircraft or the fit-test kit */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">{t('stl_mode')}</label>
            <div role="radiogroup" aria-label={t('stl_mode')} className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-700/60">
              {([false, true] as const).map(k => (
                <button
                  key={String(k)}
                  type="button"
                  role="radio"
                  aria-checked={kit === k}
                  onClick={() => setKit(k)}
                  className={`py-1.5 rounded-md text-sm font-medium transition-colors ${kit === k
                    ? 'bg-white dark:bg-slate-600 text-sky-700 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'}`}
                >
                  {t(k ? 'stl_mode_kit' : 'stl_mode_full')}
                </button>
              ))}
            </div>
            {kit && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-snug">{t('stl_kit_hint')}</p>}
          </div>

          {/* Bed */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">{t('stl_bed')}</label>
            <select
              value={presetIdx}
              onChange={e => {
                const p = BED_PRESETS[Number(e.target.value)];
                if (p) onSettingsChange({ ...settings, bedX: p.x, bedY: p.y, bedZ: p.z });
              }}
              className="w-full mb-2 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-800"
            >
              {presetIdx < 0 && <option value={-1}>{t('stl_bed_custom')}</option>}
              {BED_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2 items-center">
              <div><span className="text-xs text-slate-500">X (mm)</span>{num('bedX')}</div>
              <div><span className="text-xs text-slate-500">Y (mm)</span>{num('bedY')}</div>
              <div><span className="text-xs text-slate-500">Z (mm)</span>{num('bedZ')}</div>
            </div>
          </div>

          {/* Fit clearance: tune it after printing the test kit */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1" htmlFor="stl-clearance">{t('stl_clearance')}</label>
            <div className="flex items-center gap-2">
              <input
                id="stl-clearance"
                type="number"
                min={0.1}
                max={0.8}
                step={0.05}
                value={settings.clearance}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v >= 0.1 && v <= 0.8) onSettingsChange({ ...settings, clearance: Math.round(v * 100) / 100 });
                }}
                className="w-24 px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400 leading-snug">{t('stl_clearance_hint', { seat: (settings.clearance * 0.8).toFixed(2) })}</span>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            {!result ? (
              <p className="text-slate-500">{t('stl_computing')}</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-semibold">{t('stl_parts_total', { count: result.oriented.length })}</span>
                  <span className="text-xs text-slate-500">{t('stl_tallest', { h: Math.round(tallest) })}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {Object.entries(byKind).map(([k, n]) => (
                    <span key={k} className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-xs">{t(KIND_KEYS[k] ?? k)}: {n}</span>
                  ))}
                </div>
                {pockets.length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t('stl_cutouts')}</div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {pockets.map(p => (
                        <span key={p.id} className="px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 text-xs">{t('cut_' + p.id)}</span>
                      ))}
                    </div>
                  </>
                )}
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t('stl_spars')}</div>
                {result.plan.spars.length === 0 ? (
                  <p className="text-xs text-slate-500">—</p>
                ) : (
                  <ul className="text-xs space-y-0.5">
                    {result.plan.spars.map(sp => (
                      <li key={sp.id}>{t(sp.part)}: <b>{sp.count} × Ø{sp.diameter} mm × {sp.length} mm</b></li>
                    ))}
                  </ul>
                )}
                {balance?.assembly.bands && balance.assembly.sleeve && (
                  <>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 mt-3">{t('stl_hardware')}</div>
                    <ul className="text-xs space-y-0.5">
                      <li>{t('asm_dowels')}: <b>2 × Ø{balance.assembly.dowels[0].d} mm × {Math.round(balance.assembly.dowels[0].len)} mm</b> ({t('stl_drill', { d: balance.assembly.sleeve.od.toFixed(1) })})</li>
                      <li>{t('asm_bands')}: <b>{balance.assembly.bands.count} × ~{balance.assembly.bands.flatLen} mm</b></li>
                    </ul>
                  </>
                )}
              </>
            )}
          </div>

          {result && (result.plan.warnings.length > 0 || notFit.length > 0) && (
            <div className="space-y-2">
              {result.plan.warnings.map(w => (
                <div key={w.key} className="flex gap-2 p-2 rounded-md bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-xs">
                  <Info size={14} className="shrink-0 mt-0.5" /> {t(w.key, w.params)}
                </div>
              ))}
              {notFit.length > 0 && (
                <div className="flex gap-2 p-2 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 text-xs">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  {t('stl_not_fit', { parts: notFit.map(o => o.section.name).join(', ') })}
                </div>
              )}
            </div>
          )}

          <details className="text-xs text-slate-600 dark:text-slate-300">
            <summary className="cursor-pointer font-semibold">{t('stl_how_title')}</summary>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>{t('stl_how_1')}</li>
              <li>{t('stl_how_2')}</li>
              <li>{t('stl_how_3')}</li>
              <li>{t('stl_how_4')}</li>
            </ul>
          </details>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 p-4 border-t border-slate-200 dark:border-slate-700">
          {saveMsg && <span className="mr-auto text-xs text-emerald-700 dark:text-emerald-400">{saveMsg}</span>}
          <button
            onClick={saveToArchive}
            disabled={saving || busy || !result}
            className="px-3 py-1.5 rounded-md text-sm font-medium border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
          >
            {saving ? t('archive_busy') : t('stl_save_archive')}
          </button>
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-sm border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">{t('close')}</button>
          <button
            onClick={download}
            disabled={busy || !result}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white flex items-center gap-1.5"
          >
            <Download size={16} /> {busy ? t('stl_generating') : t('stl_download')}
          </button>
        </div>
      </div>
    </div>
  );
}
