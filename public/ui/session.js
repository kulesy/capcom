// One open chat: the transcript, the live event stream and every action on them. It is plain data and functions, so
// the components only draw what is in its store and call what it returns.
import { api } from './api.js';
import { HOME } from './env.js';
import { payload } from './images.js';
import { createStore } from './store.js';
import { absorb, prepend } from './thread.js';

const enc = encodeURIComponent;

// The first message of a session started here shows as a bubble until its transcript has it.
let startedHere = null;

// A bubble that is still being sent and the transcript's copy of it are one message when the words and the number of images match.
const sameMessage = (item, m) => item.kind === 'user' && item.text.trim() === m.text.trim() && (item.images?.length || 0) === m.images.length;

// When the turn began by this page's clock. A later report can only move it earlier, so a slow one never steps the timer back.
const began = work => (work ? Date.now() - work.turnMs : 0);

// A finished block is kept until the transcript has it, so the text does not vanish before its saved row arrives.
const thought = (shown, d) => (d.done
  ? (shown?.id === d.id ? { ...shown, done: true } : shown)
  : { id: d.id, done: false, text: (shown?.id === d.id ? shown.text : '') + d.text });

// The CLI holds at most 100 messages at once, so keeping that many counts a burst that ended together in full.
const ENDED_KEPT = 100;

// A chat's pane is built again each time the owner opens another chat, so the holds that ended undelivered wait here by chat id.
const endedByChat = new Map();

export function createChat({ id = null, draft = false, row = null, refreshIndex }) {
  const first = !draft && startedHere?.id === id ? startedHere : null;
  if (first) startedHere = null;
  // Until a new session starts, the box holds its settings here; the ones left alone follow the folder's defaults.
  const touched = draft ? new Set() : null;
  const store = createStore({
    items: [], orphans: new Map(), chips: new Map(), start: 0, end: 0, hasEarlier: false, loaded: false,
    status: draft ? { state: 'idle', pending: [], mode: 'manual', model: null, shownModel: null, effort: null } : null,
    live: '', think: null, work: null, turnStart: 0, holdsEnded: endedByChat.get(id) || [],
    sending: first ? [{ text: first.text, images: first.images }] : [], notice: '', starting: false, loadingEarlier: false,
    session: row && { title: row.title, cwd: row.cwd, branch: row.branch, routine: row.routine },
    folder: HOME, folders: [], jump: 0, earlierSeq: 0,
  });
  const state = store.get;
  let closed = false;
  let es = null;
  let fetching = false;
  let again = false;
  // Once a turn ends the streamed text stays up until the transcript has the real message, so it never blinks out.
  let ended = false;
  let earlier = null;

  const keepEnded = holdsEnded => { endedByChat.set(id, holdsEnded); return { holdsEnded }; };
  const notice = text => store.set({ notice: text || '' });
  const patchStatus = patch => store.set(s => ({ status: { ...s.status, ...patch } }));
  const onVisible = () => { if (!document.hidden) fetchNew(); };

  async function loadChips() {
    try {
      const { chips } = await api(`api/sessions/${enc(id)}/chips`);
      return new Map(chips.map(ch => [ch.toolUseId, ch]));
    } catch { return null; }
  }

  async function open() {
    document.addEventListener('visibilitychange', onVisible);
    if (draft) {
      loadDefaults();
      try {
        const { folders } = await api('api/folders');
        if (!closed) store.set({ folders });
      } catch (e) { notice(e.message); }
      return;
    }
    try {
      const r = await api(`api/sessions/${enc(id)}/messages`);
      if (closed) return;
      store.set(s => ({ session: r.session || s.session }));
      const thread = absorb({ items: [], orphans: new Map() }, r.items);
      const chips = await loadChips();
      if (closed) return;
      store.set(s => ({
        ...thread, ...(chips && { chips }), start: r.start, end: r.end, hasEarlier: r.hasEarlier, loaded: true,
        sending: s.sending.filter(m => !thread.items.some(i => sameMessage(i, m))),
      }));
    } catch (e) {
      notice(`Could not open this session: ${e.message}`);
    }
    if (!closed) connect();
  }

  function close() {
    closed = true;
    es?.close();
    document.removeEventListener('visibilitychange', onVisible);
  }

  // ---- the live event stream ---------------------------------------------------------------------------

  function connect() {
    es = new EventSource(`api/sessions/${enc(id)}/events`);
    const on = (type, fn) => es.addEventListener(type, e => { if (!closed) fn(JSON.parse(e.data || '{}')); });
    on('status', s => { ended = false; store.set({ status: s, live: s.live || '', think: s.think || null, work: s.work || null, turnStart: began(s.work), notice: '' }); fetchNew(); });
    on('state', d => { patchStatus({ state: d.state }); if (d.state === 'idle') store.set({ work: null, turnStart: 0 }); });
    on('delta', d => { const fresh = ended; ended = false; store.set(s => ({ live: (fresh ? '' : s.live) + d.text })); });
    on('think', d => store.set(s => ({ think: thought(s.think, d) })));
    on('work', d => store.set(s => ({ work: d, turnStart: s.work ? Math.min(s.turnStart, began(d)) : began(d) })));
    on('changed', () => fetchNew());
    on('approval', p => store.set(s => ({ status: { ...s.status, pending: [...(s.status?.pending || []).filter(x => x.requestId !== p.requestId), p] } })));
    on('approval-resolved', d => store.set(s => ({ status: { ...s.status, pending: (s.status?.pending || []).filter(x => x.requestId !== d.requestId) } })));
    on('hold', h => store.set(s => ({ status: { ...s.status, holds: [...(s.status?.holds || []).filter(x => x.id !== h.id), h] } })));
    on('hold-ended', d => store.set(s => ({
      status: { ...s.status, holds: (s.status?.holds || []).filter(x => x.id !== d.id) },
      ...(d.state === 'dropped' && keepEnded([...s.holdsEnded.filter(x => x.id !== d.id), d].slice(-ENDED_KEPT))),
    })));
    on('mode', d => patchStatus({ mode: d.mode }));
    on('model', d => patchStatus({ model: d.model, shownModel: d.model }));
    on('effort', d => patchStatus({ effort: d.effort }));
    on('turn-end', d => { ended = true; if (d.error) notice(d.message || 'The last turn ended with an error.'); fetchNew(); refreshIndex(); });
    on('error', d => notice(d.message));
    on('exit', () => { patchStatus({ running: false, state: 'idle', pending: [], holds: [] }); store.set({ work: null, turnStart: 0 }); });
    es.onerror = () => { if (!closed) notice(es.readyState === EventSource.CLOSED ? 'Lost contact with the Mac.' : ''); };
  }

  // ---- reading the transcript --------------------------------------------------------------------------

  // One fetch at a time: an event that arrives meanwhile asks for another once this one is done.
  async function fetchNew() {
    if (!state().loaded) return;
    if (fetching) { again = true; return; }
    fetching = true;
    try {
      const r = await api(`api/sessions/${enc(id)}/messages?after=${state().end}`);
      if (closed) return;
      // Chips are loaded first so a new chip never shows as open for a moment when it is already settled.
      const chips = r.items.some(i => /__(spawn|dismiss)_task$/.test(i.name || '')) ? await loadChips() : null;
      if (closed) return;
      const over = ended;
      const clearLive = over || r.items.some(i => i.kind === 'assistant');
      ended = false;
      store.set(s => {
        const thread = absorb(r.reset ? { items: [], orphans: new Map() } : s, r.items);
        const saved = s.think?.done && r.items.some(i => i.kind === 'thinking' && i.msgId === s.think.id);
        return {
          ...thread, ...(chips && { chips }), end: r.end,
          ...(r.reset && { start: r.start, hasEarlier: r.hasEarlier }),
          sending: s.sending.filter(m => !r.items.some(i => sameMessage(i, m))),
          ...(clearLive && { live: '' }),
          ...((over || saved) && { think: null }),
        };
      });
    } catch (e) {
      notice(e.message);
    } finally {
      fetching = false;
      if (again) { again = false; fetchNew(); }
    }
  }

  async function loadEarlier() {
    store.set({ loadingEarlier: true });
    try {
      const r = await api(`api/sessions/${enc(id)}/messages?before=${state().start}`);
      if (closed) return;
      store.set(s => ({ ...prepend(s, r.items), start: r.start, hasEarlier: r.hasEarlier, earlierSeq: s.earlierSeq + 1 }));
    } catch (e) {
      notice(e.message);
    } finally {
      if (!closed) store.set({ loadingEarlier: false });
    }
  }

  // The viewer's pictures from before the loaded messages. The answer is kept for this `start`, so the viewer opens at once the
  // next time, and dropped when it fails so the next open asks again.
  function earlierImages() {
    const { start } = state();
    if (earlier?.start !== start) {
      const asked = api(`api/sessions/${enc(id)}/images?before=${start}`).then(r => r.items, err => {
        if (earlier?.asked === asked) earlier = null;
        throw err;
      });
      earlier = { start, asked };
    }
    return earlier.asked;
  }

  // ---- talking to Claude -------------------------------------------------------------------------------

  // Sent while Claude works, a message redirects it without stopping: Claude reads it before its next step.
  async function send(text, images, mode) {
    const message = { text, images };
    store.set(s => ({ sending: [...s.sending, message], notice: '', jump: s.jump + 1 }));
    try {
      const { unarchived, ...status } = await api(`api/sessions/${enc(id)}/send`, { text, mode, ...(images.length && { images: payload(images) }) });
      if (!closed) store.set({ status });
      if (unarchived) refreshIndex();
      return true;
    } catch (err) {
      if (!closed) store.set(s => ({ sending: s.sending.filter(m => m !== message), notice: `Not sent: ${err.message}` }));
      return false;
    }
  }

  async function stop() {
    try { await api(`api/sessions/${enc(id)}/stop`, {}); } catch (e) { notice(e.message); }
  }

  // Resolves true once the server has the answer, so a card can leave its buttons off and wait for the event that clears it.
  async function decide(requestId, decision, answers) {
    try {
      await api(`api/sessions/${enc(id)}/approve`, { requestId, decision, ...(decision === 'answer' && { answers }) });
      return true;
    } catch (err) {
      notice(err.message);
      return false;
    }
  }

  const dismissHold = ids => store.set(s => keepEnded(s.holdsEnded.filter(d => !ids.includes(d.id))));

  // A 409 means the chip was settled somewhere else, and the error carries its current state for the card to show.
  async function chip(action, tool, folder) {
    const keep = c => store.set(s => ({ chips: new Map(s.chips).set(tool.id, c) }));
    try {
      const r = await api(`api/chips/${action}`, {
        sessionId: id, toolUseId: tool.id, title: tool.input?.title, tldr: tool.input?.tldr,
        prompt: tool.input?.prompt, cwd: tool.input?.cwd, confirmCwd: folder,
      });
      keep(r.chip);
      refreshIndex();
      return true;
    } catch (err) {
      if (err.data?.chip) { keep(err.data.chip); return true; }
      notice(err.message);
      return false;
    }
  }

  // ---- the settings under the prompt box ---------------------------------------------------------------

  function setDraft(patch) {
    for (const k of Object.keys(patch)) touched.add(k === 'shownModel' ? 'model' : k);
    patchStatus(patch);
  }

  // Claude can refuse a switch, so a failed one puts the picker back where it was.
  async function setMode(mode) {
    if (draft) return setDraft({ mode });
    const before = state().status?.mode;
    patchStatus({ mode });
    try {
      await api(`api/sessions/${enc(id)}/mode`, { mode });
    } catch (err) {
      if (closed) return;
      patchStatus({ mode: before });
      notice(err.message);
    }
  }

  // The change shows at once and is put back if Claude refuses it. It applies from Claude's next request, even mid-turn.
  async function pick(kind, value) {
    const patch = kind === 'model' ? { model: value, shownModel: value } : { effort: value };
    if (draft) return setDraft(patch);
    const before = state().status || {};
    patchStatus(patch);
    try {
      const status = await api(`api/sessions/${enc(id)}/${kind}`, { [kind]: value });
      if (!closed) store.set({ status });
    } catch (err) {
      if (closed) return;
      patchStatus(Object.fromEntries(Object.keys(patch).map(k => [k, before[k]])));
      notice(err.message);
    }
  }

  // ---- starting a session ------------------------------------------------------------------------------

  const setFolder = folder => store.set({ folder });

  // A new session starts the way Desktop would start one in that folder: its mode for the folder, and its effort.
  async function loadDefaults() {
    try {
      const d = await api(`api/defaults?cwd=${enc(state().folder.trim())}`);
      if (closed) return;
      patchStatus({ ...(!touched.has('mode') && { mode: d.mode }), ...(!touched.has('model') && { model: d.model, shownModel: d.shownModel }), ...(!touched.has('effort') && { effort: d.effort }) });
    } catch {}
  }

  // The first message goes to the new session; the page follows once the list knows about it.
  async function startNew(text, images, onCreated) {
    if (state().starting) return;
    const s = state().status;
    store.set({ starting: true, notice: '' });
    try {
      const { id: created } = await api('api/new', {
        cwd: state().folder.trim(), text, mode: s.mode, ...(images.length && { images: payload(images) }),
        ...(touched.has('model') && { model: s.shownModel }), ...(touched.has('effort') && { effort: s.effort }),
      });
      onCreated();
      startedHere = { id: created, text, images };
      await refreshIndex();
      location.hash = `#/s/${enc(created)}`;
    } catch (err) {
      notice(err.message);
    } finally {
      if (!closed) store.set({ starting: false });
    }
  }

  // Where the page loads an image from, given the ref the transcript put on it.
  const imageUrl = ref => `api/sessions/${enc(id)}/images/${enc(ref)}`;

  return {
    id, draft: draft ? { touched } : null, store, open, close, fetchNew, loadEarlier, earlierImages,
    send, stop, decide, dismissHold, chip, setMode, pick, setFolder, loadDefaults, startNew, notice, imageUrl,
  };
}
