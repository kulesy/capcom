import { api } from './ui/api.js';
import { ChatPane } from './ui/chat.js';
import { Fragment, html, render, useCallback, useEffect, useMemo, useRef, useState } from './ui/html.js';
import { PasskeyOffer, PasskeysPane, usePasskeyOffer } from './ui/passkeys.js';
import { useRenewal } from './ui/renew.js';
import { findRow, placeRow, SessionList } from './ui/sessions-list.js';
import { Spotlight } from './ui/spotlight.js';
import { ViewerHost } from './ui/viewer.js';

// #/ is the list, #/s/<id> a session, #/new an empty chat for a session not started yet and #/passkeys the passkeys.
function parseRoute(hash) {
  try {
    if (hash.startsWith('#/s/')) return { name: 'session', id: decodeURIComponent(hash.slice(4)) };
  } catch {}
  return { name: hash === '#/new' ? 'new' : hash === '#/passkeys' ? 'passkeys' : 'list' };
}

function App() {
  const [hash, setHash] = useState(location.hash);
  const [ix, setIx] = useState(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [finding, setFinding] = useState(false);
  const now = useRef({});
  now.current = { ix };
  const latest = useRef(0);
  const shown = useRef(0);
  const writing = useRef(0);
  const [offering, stopOffering] = usePasskeyOffer();
  useRenewal();

  // A list is drawn only if it is newer than the one on screen, so a slow answer cannot put an older list back, and once a load
  // finishes the screen shows its list or a newer one.
  const loadIndex = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const next = await api('api/sessions');
      if (mine > shown.current) { shown.current = mine; setIx(next); setError(''); }
    } catch (e) {
      if (!now.current.ix) setError(e.message);
    }
  }, []);

  // The first load comes before the route is acted on, so a session opens with its name already known.
  useEffect(() => { loadIndex().then(() => setReady(true)); }, []);

  // A drop shows at once and the server's list then replaces the guess. If the server refuses, the row goes back and the reason is returned.
  const place = useCallback(async (id, section) => {
    const before = now.current.ix;
    const guess = placeRow(before, id, section);
    if (guess === before) return '';
    const pin = section === 'pinned';
    const group = before.groups.some(g => g.id === section) ? section : null;
    setIx(guess);
    shown.current = ++latest.current;
    writing.current++;
    try {
      await api(pin ? 'api/layout/pin' : 'api/layout/move', pin ? { id, pinned: true } : { id, group });
      return '';
    } catch (e) {
      setIx(before);
      return `${pin ? 'Not pinned' : 'Not moved'}: ${e.message}`;
    } finally {
      writing.current--;
      loadIndex();
    }
  }, []);

  // A change to a project or group. It resolves with { problem, made }: the reason when the server refuses, or an empty string and
  // the project or group the server made, changed or removed. Either way the list is loaded again before it resolves.
  const edit = useCallback(async (path, body) => {
    writing.current++;
    try {
      return { problem: '', made: await api(path, body) };
    } catch (e) {
      return { problem: e.message, made: null };
    } finally {
      writing.current--;
      await loadIndex();
    }
  }, []);

  useEffect(() => {
    const refresh = () => { if (!document.hidden && !writing.current) loadIndex(); };
    const timer = setInterval(refresh, 15_000);
    const onHash = () => setHash(location.hash);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('hashchange', onHash);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  // Ctrl+N starts a session and Ctrl+K finds one. Browsers keep Cmd+N for a new window, so N has no Cmd form.
  useEffect(() => {
    const onKey = e => {
      if (e.altKey || e.shiftKey || e.isComposing) return;
      const key = e.key.toLowerCase();
      if (key === 'n' && e.ctrlKey && !e.metaKey) { e.preventDefault(); setFinding(false); location.hash = '#/new'; }
      else if (key === 'k' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setFinding(open => !open); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const route = useMemo(() => parseRoute(hash), [hash]);
  const view = ready && route.name !== 'list' ? 'chat' : 'list';
  const id = route.name === 'session' ? route.id : null;
  useEffect(() => { if (view === 'list') document.title = 'Capcom'; }, [view]);

  return html`<${Fragment}>
  <div class="app" id="app" data-view=${view}>
    <${SessionList} ix=${ix} error=${error} current=${view === 'chat' ? id : null} place=${place} edit=${edit} onFind=${() => setFinding(true)} passkeys=${route.name === 'passkeys'}
      banner=${offering ? html`<${PasskeyOffer} onDone=${stopOffering} />` : null} />
    <main class="chat" id="chat">
      <section class="empty" id="empty" hidden=${view !== 'list'}>
        <p>Pick a session, press Ctrl+K to find one, or Ctrl+N to start a new one.</p>
      </section>
      ${view === 'chat' && route.name === 'passkeys' ? html`<${PasskeysPane} />` : null}
      ${view === 'chat' && route.name !== 'passkeys' ? html`<${ChatPane} key=${id ?? 'new'} id=${id} row=${findRow(ix, id)} refreshIndex=${loadIndex} />` : null}
    </main>
    ${finding ? html`<${Spotlight} ix=${ix} onClose=${() => setFinding(false)} />` : null}
  </div>
  <${ViewerHost} />
<//>`;
}

document.getElementById('boot').remove();
document.getElementById('unsupported').remove();
render(html`<${App} />`, document.getElementById('root'));
