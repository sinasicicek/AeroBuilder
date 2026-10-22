import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, X, Search, Download, Trash2, Pencil, Upload, HardDrive, ShieldCheck, Box, Eye, RotateCcw, AlertTriangle, Info, Layers } from 'lucide-react';
import { zipSync } from 'fflate';
import {
  listSets, getFiles, deleteSet, renameSet, clearArchive, storageInfo, requestPersist,
  downloadBlob, previewEntry,
  type ArchiveSummary,
} from '../utils/stlArchive';
import type { ArchivedProject } from '../utils/stlArchive';
import { formatBytes } from '../utils/db';
import type { ViewerFile } from './StlViewer';

interface Props {
  open: boolean;
  onClose: () => void;
  /** restore a whole project snapshot into the editor */
  onLoadProject: (project: ArchivedProject, name: string) => void;
  /** open the viewer with a set of STL documents */
  onView: (files: ViewerFile[], subtitle?: string) => void;
}

type Sort = 'new' | 'old' | 'name';

const slug = (s: string) => s.toLowerCase().replace(/[çğıöşü]/g, c => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }[c] ?? c)).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stl';

export default function StlArchiveDialog({ open, onClose, onLoadProject, onView }: Props) {
  const { t, i18n } = useTranslation();
  const [sets, setSets] = useState<ArchiveSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('new');
  const [usage, setUsage] = useState<{ used: number; quota: number | null }>({ used: 0, quota: null });
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSets(await listSets());
      setUsage(await storageInfo());
    } catch (e) {
      console.error('Archive read failed', e);
      setError(t('archive_error', { msg: (e as Error).message }));
      setSets([]);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    requestPersist().then(ok => { if (!cancelled) setPersisted(ok); }).catch(() => { if (!cancelled) setPersisted(false); });
    // Loaded asynchronously so nothing is set during the effect body itself
    (async () => {
      try {
        const [list, info] = await Promise.all([listSets(), storageInfo()]);
        if (cancelled) return;
        setSets(list);
        setUsage(info);
      } catch (e) {
        if (cancelled) return;
        console.error('Archive read failed', e);
        setError(t('archive_error', { msg: (e as Error).message }));
        setSets([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const shown = useMemo(() => {
    if (!sets) return [];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? sets.filter(s =>
          s.name.toLowerCase().includes(needle) ||
          s.meta.aircraftType.includes(needle) ||
          (s.meta.modelName ?? '').toLowerCase().includes(needle))
      : [...sets];
    if (sort === 'old') return filtered.sort((a, b) => a.createdAt - b.createdAt);
    if (sort === 'name') return filtered.sort((a, b) => a.name.localeCompare(b.name, i18n.language));
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }, [sets, q, sort, i18n.language]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  );

  const view = async (s: ArchiveSummary) => {
    setBusyId(s.id);
    try {
      const files = await getFiles(s.id);
      if (!files) return;
      const list: ViewerFile[] = Object.entries(files)
        .filter(([p]) => /\.stl$/i.test(p))
        .map(([path, bytes], i) => ({
          id: `${s.id}-${i}`,
          name: path.split('/').pop()!.replace(/\.stl$/i, ''),
          path,
          bytes,
        }));
      onView(list, s.name);
    } catch (e) {
      setError(t('archive_error', { msg: (e as Error).message }));
    }
    setBusyId(null);
  };

  const download = async (s: ArchiveSummary) => {
    setBusyId(s.id);
    try {
      const files = await getFiles(s.id);
      if (!files) return;
      const zip = zipSync(files, { level: 6 });
      downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `${slug(s.name)}.zip`);
    } catch (e) {
      setError(t('archive_error', { msg: (e as Error).message }));
    }
    setBusyId(null);
  };

  const rename = async (s: ArchiveSummary) => {
    const next = window.prompt(t('stl_save_name'), s.name);
    if (next === null) return;
    await renameSet(s.id, next);
    await refresh();
  };

  const remove = async (s: ArchiveSummary) => {
    if (!window.confirm(t('archive_delete_confirm', { name: s.name }))) return;
    await deleteSet(s.id);
    setNotice(t('archive_deleted'));
    await refresh();
  };

  const removeAll = async () => {
    if (!window.confirm(t('archive_clear_confirm'))) return;
    await clearArchive();
    setNotice(t('archive_deleted'));
    await refresh();
  };

  const loadProject = (s: ArchiveSummary) => {
    if (!window.confirm(t('archive_load_confirm', { name: s.name }))) return;
    onLoadProject(s.project, s.name);
    setNotice(t('archive_loaded'));
    onClose();
  };

  const quickView = async (s: ArchiveSummary) => {
    // Single assembled/merged preview for a quick look
    setBusyId(s.id);
    try {
      const files = await getFiles(s.id);
      const pv = files ? previewEntry(files) : null;
      if (pv) onView([{ id: `${s.id}-preview`, name: pv.path.split('/').pop()!.replace(/\.stl$/i, ''), path: pv.path, bytes: pv.bytes }], s.name);
      else await view(s);
    } catch (e) {
      setError(t('archive_error', { msg: (e as Error).message }));
    }
    setBusyId(null);
  };

  if (!open) return null;

  const totalParts = sets?.reduce((n, s) => n + s.meta.parts, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-3 bg-black/40" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="archive-title">
      <div className="w-full max-w-4xl h-[92vh] sm:h-[88vh] flex flex-col rounded-xl bg-white dark:bg-slate-800 shadow-2xl text-slate-800 dark:text-slate-100" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 p-3 border-b border-slate-200 dark:border-slate-700">
          <h2 id="archive-title" className="text-base sm:text-lg font-semibold flex items-center gap-2">
            <Archive size={20} className="text-sky-600 dark:text-sky-400" /> {t('archive_title')}
          </h2>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => onView([], undefined)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
              title={t('archive_import')}
            >
              <Upload size={15} /> <span className="hidden sm:inline">{t('archive_import')}</span>
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700" aria-label={t('archive_close')}><X size={20} /></button>
          </div>
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
            <option value="new">{t('archive_sort_new')}</option>
            <option value="old">{t('archive_sort_old')}</option>
            <option value="name">{t('archive_sort_name')}</option>
          </select>
          {sets && sets.length > 0 && (
            <button onClick={removeAll} className="px-2 py-1.5 rounded-md border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 text-sm flex items-center gap-1.5">
              <Trash2 size={14} /> {t('archive_clear')}
            </button>
          )}
        </div>

        {/* Storage strip */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
          <span className="flex items-center gap-1"><HardDrive size={12} />{t('archive_storage', { used: formatBytes(usage.used) })}</span>
          {usage.quota && <span className="opacity-70">{t('archive_storage_quota', { used: formatBytes(usage.used), quota: formatBytes(usage.quota) })}</span>}
          {sets && <span className="opacity-70">· {t('archive_parts', { count: totalParts })}</span>}
          {persisted && <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ShieldCheck size={12} />{t('archive_persisted')}</span>}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3">
          {sets === null && <p className="text-sm text-slate-500 p-4">{t('archive_busy')}</p>}

          {sets && sets.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center text-sm text-slate-500 dark:text-slate-400 px-6">
              <Archive size={40} className="opacity-40" />
              <p className="max-w-sm leading-relaxed">{t('archive_empty')}</p>
            </div>
          )}

          {sets && sets.length > 0 && shown.length === 0 && (
            <p className="text-sm text-slate-500 p-4">{t('archive_none_match', { q })}</p>
          )}

          <ul className="grid gap-2 sm:grid-cols-2">
            {shown.map(s => (
              <li key={s.id} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
                <div className="flex gap-2 p-2">
                  <button
                    onClick={() => void quickView(s)}
                    className="w-24 h-16 shrink-0 rounded-md bg-slate-100 dark:bg-slate-900 overflow-hidden flex items-center justify-center group relative"
                    title={t('archive_view')}
                  >
                    {s.thumb
                      ? <img src={s.thumb} alt="" className="w-full h-full object-contain" />
                      : <Box size={22} className="text-slate-400" />}
                    <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/40 text-white"><Eye size={16} /></span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate" title={s.name}>{s.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('archive_saved_at', { when: dateFmt.format(s.createdAt) })}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${s.meta.kind === 'kit' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'}`}>
                        {s.meta.kind === 'kit' ? t('archive_kit') : t('archive_full')}
                      </span>
                      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-[10px]">{t('archive_parts', { count: s.meta.parts })}</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-[10px]">{formatBytes(s.meta.bytes)}</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-[10px]">{t('archive_bed', { x: s.meta.bed.x, y: s.meta.bed.y, z: s.meta.bed.z })}</span>
                      {s.meta.modelName && (
                        <button
                          onClick={() => setQ(s.meta.modelName!)}
                          className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 text-[10px] flex items-center gap-0.5"
                          title={t('archive_model')}
                        >
                          <Layers size={9} />{s.meta.modelName}
                        </button>
                      )}
                      {s.meta.notFit > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 text-[10px] flex items-center gap-0.5">
                          <AlertTriangle size={9} />{t('archive_notfit', { count: s.meta.notFit })}
                        </span>
                      )}
                      {s.meta.warnings > 0 && s.meta.notFit === 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 text-[10px] flex items-center gap-0.5">
                          <Info size={9} />{t('archive_warn', { count: s.meta.warnings })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-0.5 px-1.5 py-1 border-t border-slate-100 dark:border-slate-700/60 text-slate-500 dark:text-slate-400">
                  <button onClick={() => void view(s)} disabled={busyId === s.id} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700" title={t('archive_view')} aria-label={t('archive_view')}><Eye size={15} /></button>
                  <button onClick={() => void download(s)} disabled={busyId === s.id} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700" title={t('archive_download')} aria-label={t('archive_download')}><Download size={15} /></button>
                  <button onClick={() => loadProject(s)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700" title={t('archive_load')} aria-label={t('archive_load')}><RotateCcw size={15} /></button>
                  <button onClick={() => void rename(s)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700" title={t('archive_rename')} aria-label={t('archive_rename')}><Pencil size={15} /></button>
                  <button onClick={() => void remove(s)} className="p-1.5 rounded ml-auto text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30" title={t('archive_delete')} aria-label={t('archive_delete')}><Trash2 size={15} /></button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {(error || notice) && (
          <div className={`px-3 py-2 text-xs border-t ${error ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'}`}>
            {error ?? notice}
          </div>
        )}
      </div>
    </div>
  );
}
