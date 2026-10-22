import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface SectionProps {
  title: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Collapsible sidebar section. */
export default function Section({ title, icon, badge, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-slate-200 dark:border-slate-700/70 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
      >
        {icon && <span className="text-sky-600 dark:text-sky-400 shrink-0">{icon}</span>}
        <span className="flex-1 text-[13px] font-semibold uppercase tracking-wide text-slate-800 dark:text-slate-100">{title}</span>
        {badge}
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </section>
  );
}
