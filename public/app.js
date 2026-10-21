import { api } from './ui/api.js';
import { AskHost } from './ui/ask.js';
import { ChatPane } from './ui/chat.js';
import { useModifier } from './ui/hooks.js';
import { Fragment, html, render, useCallback, useEffect, useMemo, useRef, useState } from './ui/html.js';
import { PasskeyOffer, PasskeysPane, usePasskeyOffer } from './ui/passkeys.js';
import { useProjects } from './ui/projects.js';
import { useRenewal } from './ui/renew.js';
import { findRow, newSession, placeRow, SessionList } from './ui/sessions-list.js';
import { shortcut } from './ui/shortcuts.js';
import { Spotlight } from './ui/spotlight.js';
import { withoutRow } from './ui/tree.js';
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
  const mod = useModifier();
  const flipKey = useRef(null);
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

  // A session's route waits for a list, so the session opens with its name already known, unless the first load fails.
  useEffect(() => { loadIndex().then(() => setReady(true)); }, []);

  // A drop shows at once and the server's list then replaces the guess. If the server refuses, the row goes back and the reason is returned.
  // The old list goes back only while none has been drawn since, or it would undo that one. The reload puts the row back then.
  // A row's menu can outlive the row when a reload takes it away, so a session that is no longer listed is refused here. It resolves
  // once the server's list is drawn, so the focus can go back to the row where that list puts it.
  const place = useCallback(async (id, section) => {
    const before = now.current.ix;
    const pin = section === 'pinned';
    if (!findRow(before, id)) return `${pin ? 'Not pinned' : 'Not moved'}: that session is no longer in the list.`;
    const guess = placeRow(before, id, section);
    if (guess === before) return '';
    const group = before.groups.some(g => g.id === section) ? section : null;
    const mark = ++latest.current;
    setIx(guess);
    shown.current = mark;
    writing.current++;
    try {
      await api(pin ? 'api/layout/pin' : 'api/layout/move', pin ? { id, pinned: true } : { id, group });
      return '';
    } catch (e) {
      if (shown.current === mark) setIx(before);
      return `${pin ? 'Not pinned' : 'Not moved'}: ${e.message}`;
    } finally {
      writing.current--;
      await loadIndex();
    }
  }, []);

  // Archiving takes the row out at once and puts it back if the server refuses, while no other list has been drawn since. Unarchiving
  // waits for the server's list, because the server says where the session lands. It resolves with { problem, stopped, running }: the
  // reason when the server refuses, whether it stopped a chat that was running, and whether it refused because the chat was running and
  // `stop` was false, which leaves it archived by no one. The server's list is drawn before it resolves.
  const archive = useCallback(async (id, archived, { stop = true } = {}) => {
    const before = now.current.ix;
    const mark = archived ? ++latest.current : 0;
    if (archived) {
      setIx(withoutRow(before, id));
      shown.current = mark;
    }
    writing.current++;
    try {
      const reply = await api('api/layout/archive', stop ? { id, archived } : { id, archived, stop: false });
      return { problem: '', stopped: !!reply.stopped, running: false };
    } catch (e) {
      if (archived && shown.current === mark) setIx(before);
      return { problem: `${archived ? 'Not archived' : 'Not unarchived'}: ${e.message}`, stopped: false, running: e.status === 409 };
    } finally {
      writing.current--;
      await loadIndex();
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

  // Ctrl+N starts a session, Ctrl+K finds one and Ctrl+B shows or hides the projects sidebar. Cmd+K and Cmd+B work too, and so does
  // Cmd+N in the installed app. The list takes Cmd+A, because it knows which row has the focus.
  useEffect(() => {
    const onKey = e => {
      const asked = shortcut(e);
      if (asked !== 'new' && asked !== 'find' && asked !== 'projects') return;
      e.preventDefault();
      if (asked === 'new') { setFinding(false); newSession(); }
      else if (asked === 'projects') flipKey.current();
      else setFinding(open => !open);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const route = useMemo(() => parseRoute(hash), [hash]);
  // A new session needs no list, so it opens at once.
  const view = route.name !== 'list' && (route.name === 'new' || ready || ix) ? 'chat' : 'list';
  const id = route.name === 'session' ? route.id : null;
  const row = findRow(ix, id);
  const current = view === 'chat' ? id : null;
  const projects = useProjects(ix, current, hash, view === 'list');
  useEffect(() => { if (view === 'list') document.title = 'Capcom'; }, [view]);

  // A view picked in the search. Where the list and a chat cannot sit side by side, a chat gives way to the list, and the route is
  // set in state at once so the list is on screen when the focus moves to it.
  const showView = viewId => {
    setFinding(false);
    if (!projects.wide && view !== 'list') { location.hash = '#/'; setHash(location.hash); }
    projects.show(viewId);
  };

  // Ctrl+B or Cmd+B. The search closes with the focus on the button that opens the sidebar. A chat gives way to the list as it does in
  // showView, and the level opens in the list's place.
  flipKey.current = () => {
    if (finding && projects.wide) projects.opener.current?.focus();
    setFinding(false);
    const away = !projects.wide && view !== 'list';
    if (away) { location.hash = '#/'; setHash(location.hash); }
    projects.flip(away);
  };

  return html`<${Fragment}>
  <div class="app" id="app" data-view=${view}>
    <${SessionList} ix=${ix} projects=${projects} error=${error} current=${current} place=${place} edit=${edit} archive=${archive} onFind=${() => setFinding(true)} passkeys=${route.name === 'passkeys'}
      banner=${offering ? html`<${PasskeyOffer} onDone=${stopOffering} />` : null} />
    <main class="chat" id="chat">
      <section class="empty" id="empty" hidden=${view !== 'list'}>
        <p>Pick a session, press ${mod}+K to find one, or ${mod}+N to start a new one.</p>
      </section>
      ${view === 'chat' && route.name === 'passkeys' ? html`<${PasskeysPane} />` : null}
      ${view === 'chat' && route.name !== 'passkeys' ? html`<${ChatPane} key=${id ?? 'new'} id=${id} row=${row} title=${row?.title} refreshIndex=${loadIndex} />` : null}
    </main>
    ${finding ? html`<${Spotlight} ix=${ix} archive=${archive} onShow=${showView} onClose=${() => setFinding(false)} />` : null}
  </div>
  <${ViewerHost} />
  <${AskHost} />
<//>`;
}

document.getElementById('boot').remove();
document.getElementById('unsupported').remove();
render(html`<${App} />`, document.getElementById('root'));
