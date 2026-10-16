// Asks the server to send the sign-in cookie again. It answers with one at most once a day, so a tab or an installed app
// that stays open for months stays signed in, up to the 365 day cap. The reply must come from a URL directly under the mount, never under /api.
import { api } from './api.js';
import { useEffect } from './html.js';

const EVERY = 6 * 3600_000;

export function useRenewal() {
  useEffect(() => {
    let last = 0;
    const renew = () => {
      if (document.hidden || Date.now() - last < EVERY / 2) return;
      last = Date.now();
      api('renew', {}).catch(() => {});
    };
    renew();
    const timer = setInterval(renew, EVERY);
    document.addEventListener('visibilitychange', renew);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', renew);
    };
  }, []);
}
