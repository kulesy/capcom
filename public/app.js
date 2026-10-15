import { api } from './ui/api.js';
import { ChatPane } from './ui/chat.js';
import { useLocal } from './ui/hooks.js';
import { html, render, useCallback, useEffect, useMemo, useRef, useState } from './ui/html.js';
import { findRow, SessionList } from './ui/sessions-list.js';

// #/ is the list, #/s/<id> a session and #/new an empty chat for a session not started yet.
function parseRoute(hash) {
  try {
    if (hash.startsWith('#/s/')) return { name: 'session', id: decodeURIComponent(hash.slice(4)) };
  } catch {}
  return { name: hash === '#/new' ? 'new' : 'list' };
}

function App() {
  const [hash, setHash] = useState(location.hash);
  const [archived, setArchived] = useLocal('archived', false);
  const [verbose, setVerbose] = useLocal('verbose', false);
  const [ix, setIx] = useState(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const now = useRef({});
  now.current = { archived, ix };
  const latest = useRef(0);

  // Only the newest request counts, so a slow answer cannot put an older list back.
  const loadIndex = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const next = await api(`api/sessions${now.current.archived ? '?archived=1' : ''}`);
      if (mine === latest.current) { setIx(next); setError(''); }
    } catch (e) {
      if (!now.current.ix) setError(e.message);
    }
  }, []);

  // The first load comes before the route is acted on, so a session opens with its name already known.
  useEffect(() => { loadIndex().then(() => setReady(true)); }, [archived]);

  useEffect(() => {
    const refresh = () => { if (!document.hidden) loadIndex(); };
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

  const route = useMemo(() => parseRoute(hash), [hash]);
  const view = ready && route.name !== 'list' ? 'chat' : 'list';
  const id = route.name === 'session' ? route.id : null;
  useEffect(() => { if (view === 'list') document.title = 'Capcom'; }, [view]);

  return html`<div class="app" id="app" data-view=${view}>
    <${SessionList} ix=${ix} error=${error} current=${view === 'chat' ? id : null} archived=${archived} setArchived=${setArchived} />
    <main class="chat" id="chat">
      <section class="empty" id="empty" hidden=${view !== 'list'}>
        <p>Pick a session, or start a new one.</p>
      </section>
      ${view === 'chat' ? html`<${ChatPane} key=${id ?? 'new'} id=${id} row=${findRow(ix, id)} verbose=${verbose} setVerbose=${setVerbose} refreshIndex=${loadIndex} />` : null}
    </main>
  </div>`;
}

document.getElementById('boot').remove();
document.getElementById('unsupported').remove();
render(html`<${App} />`, document.getElementById('root'));
