import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, Save, Plus, Upload, Download, Copy, Pencil, Trash2, History, RotateCcw, FolderOpen, AlertTriangle, Layers } from 'lucide-react';
import {
  listModels, deleteModel, renameModel, duplicateModel, restoreVersion, saveModel,
  modelToJson, parseModelJson, uniqueName, modelSizeText, setActiveModelId,
  type ModelRecord,
} from '../utils/modelLibrary';
import { downloadBlob } from '../utils/stlArchive';

interface Props {
  open: boolean;
  onClose: () => void;
  currentId: string | null;
  currentName: string;
  dirty: boolean;
  /** loads a snapshot into the editor */
  onLoad: (rec: ModelRecord) => void;
  /** saves the live design; asNew forces a new record */
  onSaveCurrent: (name: string, asNew: boolean) => Promise<ModelRecord | null>;
  /** called after a delete so the parent can drop the active id */
  onDeleted?: (id: string) => void;
}

type Sort = 'updated' | 'name' | 'created';

const slug = (s: string) => s.toLowerCase()
  .replace(/[çğıöşü]/g, c => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }[c] ?? c))
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';

export default function ModelLibraryDialog({ open, onClose, currentId, currentName, dirty, onLoad, onSaveCurrent, onDeleted }: Props) {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<ModelRecord[] | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setList(await listModels());
    } catch (e) {
      console.error('Model list failed', e);
      setError(t('archive_error', { msg: (e as Error).message }));
      setList([]);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    (async () => { await refresh(); })();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  );

  const shown = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    const filtered = needle ? list.filter(m => m.name.toLowerCase().includes(needle)) : [...list];
    if (sort === 'name') return filtered.sort((a, b) => a.name.localeCompare(b.name, i18n.language));
    if (sort === 'created') return filtered.sort((a, b) => b.createdAt - a.createdAt);
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [list, q, sort, i18n.language]);

  const taken = useMemo(() => (list ?? []).map(m => m.name), [list]);

  const askName = (suggested: string) => {
    const v = window.prompt(t('model_name'), suggested);
    return v === null ? null : v.trim() || suggested;
  };

  const saveCurrent = async (asNew: boolean) => {
    const suggested = asNew ? uniqueName(currentName || t('model_default_name'), taken) : (currentName || t('model_default_name'));
    const name = askName(suggested);
    if (name === null) return;
    setBusy(true);
    setError(null);
    try {
      const rec = await onSaveCurrent(name, asNew);
      if (rec) setActiveModelId(rec.id);
      setNotice(t('model_saved'));
      await refresh();
    } catch (e) {
      setError(t('archive_error', { msg: (e as Error).message }));
    }
    setBusy(false);
  };

  const load = (rec: ModelRecord) => {
    if (dirty && !window.confirm(t('model_load_confirm', { name: rec.name }))) return;
    onLoad(rec);
    setActiveModelId(rec.id);
    onClose();
  };

  const duplicate = async (rec: ModelRecord) => {
    const name = askName(uniqueName(`${rec.name} (2)`, taken));
    if (name === null) return;
    await duplicateModel(rec.id, name);
    await refresh();
  };

  const rename = async (rec: ModelRecord) => {
    const name = askName(rec.name);
    if (name === null) return;
    await renameModel(rec.id, name);
    await refresh();
  };

  const remove = async (rec: ModelRecord) => {
    if (!window.confirm(t('model_delete_confirm', { name: rec.name }))) return;
    await deleteModel(rec.id);
    onDeleted?.(rec.id);
    if (currentId === rec.id) setActiveModelId(null);
    await refresh();
  };

  const restore = async (rec: ModelRecord, at: number) => {
    if (!window.confirm(t('model_restore_confirm', { when: dateFmt.format(at) }))) return;
    await restoreVersion(rec.id, at);
    await refresh();
  };

  const exportJson = (rec: ModelRecord) => {
    downloadBlob(new Blob([modelToJson(rec)], { type: 'application/json' }), `${slug(rec.name)}.json`);
  };

  const importJson = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const parsed = parseModelJson(await file.text());
      if (!parsed) {
        setError(t('model_import_error'));
      } else {
        const rec = await saveModel({ name: uniqueName(parsed.name, taken), snapshot: parsed.snapshot });
        setActiveModelId(rec.id);
        setNotice(t('model_saved'));
        await refresh();
      }
    } catch (e) {
      setError(t('archive_error', { msg: (e as Error).message }));
    }
    setBusy(false);
  };

  if (!open) return null;

  const meta = (rec: ModelRecord) => {
    const d = rec.snapshot.dimensions;
    const stations = d.fuseStations?.length ?? 0;
    return { span: d.wingspan, unit: rec.snapshot.unit, stations };
  };

  const chip = 'px-1.5 py-0.5 rounded-full text-[10px]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-3 bg-black/40" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="models-title">
      <div className="w-full max-w-4xl h-[92vh] sm:h-[88vh] flex flex-col rounded-xl bg-white dark:bg-slate-800 shadow-2xl text-slate-800 dark:text-slate-100" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-200 dark:border-slate-700">
          <h2 id="models-title" className="text-base sm:text-lg font-semibold flex items-center gap-2">
            <Layers size={20} className="text-sky-600 dark:text-sky-400" /> {t('model_library')}
          </h2>
          {dirty && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[10px] font-medium">
              {t('model_unsaved')}
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
            >
              <Upload size={14} /><span className="hidden sm:inline">{t('model_import')}</span>
            </button>
            <button
              onClick={() => void saveCurrent(false)}
              disabled={busy}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
            >
              <Save size={14} /><span className="hidden sm:inline">{t('model_save')}</span>
            </button>
            <button
              onClick={() => void saveCurrent(true)}
              disabled={busy}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-60"
            >
              <Plus size={14} />{t('model_save_new')}
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700" aria-label={t('archive_close')}><X size={20} /></button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ''; }}
          />
        </div>

        <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
          {t('model_save_hint')}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 text-xs">
          <div className="relative flex-1 min-w-[140px]">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('archive_search')}
              className="w-full pl-7 pr-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as Sort)}
            aria-label={t('archive_sort')}
            className="px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
          >
            <option value="updated">{t('model_sort_updated')}</option>
            <option value="created">{t('archive_sort_new')}</option>
            <option value="name">{t('archive_sort_name')}</option>
          </select>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3">
          {list === null && <p className="text-sm text-slate-500 p-4">{t('archive_busy')}</p>}
          {list && list.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center text-sm text-slate-500 dark:text-slate-400 px-6">
              <FolderOpen size={40} className="opacity-40" />
              <p className="max-w-sm leading-relaxed">{t('model_empty')}</p>
              <button onClick={() => void saveCurrent(true)} className="mt-2 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium">
                {t('model_save_new')}
              </button>
            </div>
          )}
          {list && list.length > 0 && shown.length === 0 && <p className="text-sm text-slate-500 p-4">{t('archive_none_match', { q })}</p>}

          <ul className="grid gap-2 sm:grid-cols-2">
            {shown.map(rec => {
              const m = meta(rec);
              const isCurrent = rec.id === currentId;
              return (
                <li
                  key={rec.id}
                  className={`rounded-lg border overflow-hidden flex flex-col ${isCurrent ? 'border-sky-500 ring-1 ring-sky-200 dark:ring-sky-900' : 'border-slate-200 dark:border-slate-700'}`}
                >
                  <div className="flex gap-2 p-2">
                    <button onClick={() => load(rec)} className="w-24 h-16 shrink-0 rounded-md bg-slate-100 dark:bg-slate-900 overflow-hidden flex items-center justify-center" title={t('model_load')}>
                      {rec.thumb ? <img src={rec.thumb} alt="" className="w-full h-full object-contain" /> : <FolderOpen size={22} className="text-slate-400" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate flex items-center gap-1" title={rec.name}>
                        {rec.name}
                        {isCurrent && <span className="px-1 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 text-[9px] uppercase">{t('archive_model')}</span>}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('model_updated', { when: dateFmt.format(rec.updatedAt) })}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className={`${chip} bg-slate-100 dark:bg-slate-700`}>{t('model_span', { v: Math.round(m.span), unit: m.unit })}</span>
                        {m.stations > 0 && <span className={`${chip} bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300`}>{t('model_stations', { count: m.stations })}</span>}
                        {rec.history.length > 0 && <span className={`${chip} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`}>{t('model_history_count', { count: rec.history.length })}</span>}
                        <span className={`${chip} bg-slate-100 dark:bg-slate-700`}>{modelSizeText(rec)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center gap-0.5 px-1.5 py-1 border-t border-slate-100 dark:border-slate-700/60 text-slate-500 dark:text-slate-400">
                    <button onClick={() => load(rec)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700" title={t('model_load')} aria-label={t('model_load')}><RotateCcw size={15} /></button>
                    <button onClick={() => void duplicate(rec)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700" title={t('model_duplicate')} aria-label={t('model_duplicate')}><Copy size={15} /></button>
                    <button onClick={() => void rename(rec)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700" title={t('model_rename')} aria-label={t('model_rename')}><Pencil size={15} /></button>
                    <button onClick={() => exportJson(rec)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700" title={t('model_export')} aria-label={t('model_export')}><Download size={15} /></button>
                    <button
                      onClick={() => setExpanded(expanded === rec.id ? null : rec.id)}
                      className={`p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 ${expanded === rec.id ? 'text-sky-600 dark:text-sky-400' : ''}`}
                      title={t('model_versions')}
                      aria-label={t('model_versions')}
                    >
                      <History size={15} />
                    </button>
                    <button onClick={() => void remove(rec)} className="p-1.5 rounded ml-auto text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30" title={t('archive_delete')} aria-label={t('archive_delete')}><Trash2 size={15} /></button>
                  </div>

                  {expanded === rec.id && (
                    <div className="px-2 pb-2 text-[11px] border-t border-slate-100 dark:border-slate-700/60 pt-1.5">
                      {rec.history.length === 0 ? (
                        <p className="text-slate-500 dark:text-slate-400 py-1">{t('model_versions_empty')}</p>
                      ) : (
                        <ul className="space-y-1">
                          {rec.history.map(h => (
                            <li key={h.at} className="flex items-center gap-2">
                              <span className="text-slate-600 dark:text-slate-300 flex-1">{dateFmt.format(h.at)}</span>
                              <button onClick={() => void restore(rec, h.at)} className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">
                                {t('model_restore')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {(error || notice) && (
          <div className={`px-3 py-2 text-xs border-t flex items-center gap-1.5 ${error ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'}`}>
            {error ? <AlertTriangle size={13} /> : null}
            {error ?? notice}
          </div>
        )}
      </div>
    </div>
  );
}
