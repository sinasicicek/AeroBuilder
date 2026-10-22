export default function AppLogo() {
  return (
    <a href="./" className="flex items-center gap-2.5 select-none" aria-label="AeroBuilder">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 shadow-sm shadow-sky-600/30">
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path d="M16 3.5c1.1 0 1.8 1.4 1.8 3.4v5.4l10.7 5.6v2.6l-10.7-2.9v5.2l3.3 2.4v2.1L16 26.2l-5.1 1.1v-2.1l3.3-2.4v-5.2L3.5 20.5v-2.6l10.7-5.6V6.9c0-2 .7-3.4 1.8-3.4z" fill="white" />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[17px] font-bold tracking-tight text-slate-900 dark:text-white">AeroBuilder</span>
        <span className="text-[10.5px] font-medium text-sky-700 dark:text-sky-400 tracking-wide mt-0.5">CG · STL · RC</span>
      </span>
    </a>
  );
}
