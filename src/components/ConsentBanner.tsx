import { useTranslation } from 'react-i18next';
import { Cookie } from 'lucide-react';

interface Props { onAccept: () => void; onReject: () => void; onMore: () => void }

/**
 * First-visit cookie question (LGPD). Accept and Reject have the same weight;
 * nothing is tracked until the visitor accepts.
 */
export default function ConsentBanner({ onAccept, onReject, onMore }: Props) {
  const { t } = useTranslation();
  const btn = 'px-4 py-2 rounded-lg text-sm font-semibold min-w-[7.5rem]';
  return (
    <div role="region" aria-label={t('privacy_title')} className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-3xl flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl">
        <Cookie size={22} className="hidden sm:block shrink-0 text-sky-600 dark:text-sky-400" />
        <p className="flex-1 text-sm leading-snug text-slate-700 dark:text-slate-200">
          {t('consent_text')}{' '}
          <button type="button" onClick={onMore} className="underline text-sky-700 dark:text-sky-400 hover:no-underline">{t('consent_more')}</button>
        </p>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={onReject} className={`${btn} border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800`}>{t('consent_reject')}</button>
          <button type="button" onClick={onAccept} className={`${btn} border border-sky-600 bg-sky-600 hover:bg-sky-700 text-white`}>{t('consent_accept')}</button>
        </div>
      </div>
    </div>
  );
}
