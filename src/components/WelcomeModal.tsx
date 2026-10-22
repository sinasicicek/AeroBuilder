import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, ShieldCheck, Printer, X } from 'lucide-react';

interface Props { open: boolean; onClose: () => void; onExamples: () => void }

export default function WelcomeModal({ open, onClose, onExamples }: Props) {
  const { t } = useTranslation();
  if (!open) return null;
  const steps = [
    { icon: <SlidersHorizontal size={20} />, title: t('welcome_1_t'), text: t('welcome_1') },
    { icon: <ShieldCheck size={20} />, title: t('welcome_2_t'), text: t('welcome_2') },
    { icon: <Printer size={20} />, title: t('welcome_3_t'), text: t('welcome_3') },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="w-full max-w-xl rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-sky-600 via-sky-700 to-indigo-700 text-white">
          <button onClick={onClose} className="absolute top-3 right-3 p-1 rounded-md hover:bg-white/15" aria-label={t('close')}><X size={18} /></button>
          <h2 id="welcome-title" className="text-xl font-bold">{t('welcome_title')}</h2>
          <p className="mt-1 text-sm text-sky-100 leading-relaxed">{t('welcome_sub')}</p>
        </div>
        <ol className="p-6 space-y-4">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid place-items-center w-10 h-10 shrink-0 rounded-xl bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">{s.icon}</span>
              <div>
                <div className="font-semibold text-slate-900 dark:text-white text-sm">{i + 1}. {s.title}</div>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="px-6 pb-6 flex flex-wrap justify-end gap-2">
          <button onClick={onExamples} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium">{t('examples_cta')}</button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold">{t('welcome_cta')}</button>
        </div>
      </div>
    </div>
  );
}
