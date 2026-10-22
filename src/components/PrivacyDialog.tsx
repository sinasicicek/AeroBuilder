import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, X } from 'lucide-react';
import type { Consent } from '../utils/consent';

interface Props {
  open: boolean;
  consent: Consent;
  consentAt: string | null;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
}

/** Privacy notice: what is stored, what Analytics collects, and the visitor's current choice. */
export default function PrivacyDialog({ open, consent, consentAt, onClose, onAccept, onReject }: Props) {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const when = consentAt ? new Date(consentAt).toLocaleDateString(i18n.language) : '';
  const status = consent === 'granted' ? t('privacy_status_granted', { date: when })
    : consent === 'denied' ? t('privacy_status_denied', { date: when }) : t('privacy_status_unset');
  const sec = (title: string, body: string) => (
    <section>
      <h3 className="font-semibold text-slate-900 dark:text-white text-sm">{title}</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{body}</p>
    </section>
  );
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="privacy-title">
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <ShieldCheck size={20} className="text-sky-600 dark:text-sky-400" />
          <h2 id="privacy-title" className="flex-1 text-lg font-bold text-slate-900 dark:text-white">{t('privacy_title')}</h2>
          <button onClick={onClose} className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t('close')}><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {sec(t('privacy_projects_t'), t('privacy_projects'))}
          {sec(t('privacy_analytics_t'), t('privacy_analytics'))}
          {sec(t('privacy_rights_t'), t('privacy_rights'))}
          <section>
            <h3 className="font-semibold text-slate-900 dark:text-white text-sm">{t('privacy_contact_t')}</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('privacy_contact')}{' '}
              <a className="text-sky-700 dark:text-sky-400 underline" href="https://www.linkedin.com/in/alvaromarcus/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
              {' · '}
              <a className="text-sky-700 dark:text-sky-400 underline" href="https://github.com/Alvaromarcus/Airplane_model/issues" target="_blank" rel="noopener noreferrer">GitHub</a>
            </p>
          </section>
          <p className="text-sm font-medium p-3 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100">{status}</p>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex flex-wrap justify-end gap-2">
          <button onClick={onReject} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold">
            {consent === 'granted' ? t('privacy_revoke') : t('consent_reject')}
          </button>
          <button onClick={onAccept} disabled={consent === 'granted'} className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-semibold">{t('consent_accept')}</button>
        </div>
      </div>
    </div>
  );
}
