import { useEffect } from 'react';

const CURRENT_VERSION = __APP_VERSION__;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

export function useVersionCheck() {
  useEffect(() => {
    // Don't run in development
    if (import.meta.env.DEV) return;

    const check = async () => {
      try {
        const res = await fetch(
          `/version.json?t=${Date.now()}`, // cache-bust the fetch itself
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const data: { version: string } = await res.json();

        if (data.version !== CURRENT_VERSION) {
          // New version deployed — force a hard reload
          window.location.reload();
        }
      } catch {
        // Network error — silently ignore, try again next interval
      }
    };

    // Check immediately on mount, then on interval
    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);

    // Also check when the user returns to the tab after being away
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        check();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);
}
