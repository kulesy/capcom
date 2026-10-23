// Which side panel each chat has open and on which tab, how wide the panels are, and what the panel is asked to focus. The open state
// and tab are kept for the 100 newest chats, the width is one for all of them, and both are kept in localStorage.
import { local } from './storage.js';
import { createStore } from './store.js';
import { PANEL } from './terminal-rules.js';

const KEPT = 100;

export const CLOSED = Object.freeze({ open: false, tab: 'terminal' });

const valid = saved => Object.fromEntries(Object.entries(saved && typeof saved === 'object' ? saved : {})
  .filter(([, v]) => v && typeof v.open === 'boolean' && (v.tab === 'terminal' || v.tab === 'file'))
  .map(([id, v]) => [id, { open: v.open, tab: v.tab }])
  .slice(-KEPT));

export const panels = createStore({ byId: valid(local.get('panels', {})), width: Number(local.get('panelWidth', PANEL.fallback)) || PANEL.fallback, want: null, goto: null });

export const panelOf = (state, id) => state.byId[id] ?? CLOSED;

// Where the focus goes back to when a chat's panel closes, which is whatever opened it. Kept apart from the store, as an element is not data.
const origins = new Map();
let asks = 0;

function put(id, patch) {
  panels.set(s => {
    const byId = { ...s.byId };
    const was = byId[id] ?? CLOSED;
    delete byId[id];
    byId[id] = { ...was, ...patch };
    const ids = Object.keys(byId);
    for (const old of ids.slice(0, Math.max(0, ids.length - KEPT))) delete byId[old];
    local.set('panels', byId);
    return { byId };
  });
}

// Opens the chat's panel on `tab`. `from` is the control that asked, which gets the focus back when the panel closes, and the panel
// takes the focus when it opens.
export function showPanel(id, tab, from) {
  if (from) origins.set(id, from);
  else origins.delete(id);
  put(id, { open: true, tab });
  panels.set({ want: { id, tab, n: ++asks } });
}

export const hidePanel = id => put(id, { open: false });

export function togglePanel(id, from, shown) {
  if (shown) hidePanel(id);
  else showPanel(id, panels.get().byId[id]?.tab ?? 'terminal', from);
}

export const selectTab = (id, tab) => put(id, { tab });

export const takeWant = id => {
  const { want } = panels.get();
  if (want?.id !== id) return null;
  panels.set({ want: null });
  return want;
};

export const takeOrigin = id => {
  const from = origins.get(id);
  origins.delete(id);
  return from ?? null;
};

// The width follows a drag as it moves, and is kept once it lets go.
export function setPanelWidth(width, keep = true) {
  const next = Math.round(width);
  if (keep) local.set('panelWidth', next);
  if (next !== panels.get().width) panels.set({ width: next });
}

// Asks the terminal tab to scroll to a run and focus it, as "Open in terminal" does.
export const goToRun = key => panels.set({ goto: { key, n: ++asks } });
