// A widget takes many seconds to write, so Capcom holds a place for it in the chat while Claude does. This file decides what to hold
// and for how long. The page draws the place, and nothing here touches the page.

export const DEFAULT_TEXT = 'Drawing a widget';

// How long each phrase of the call shows before the next one.
export const ROTATE_MS = 2200;

// How long the place is kept once the call has left the live list, if the widget's own row has not reached the thread by then.
export const HOLD_MS = 10_000;

const WIDGET_CALL = /__show_widget$/;

const isWidgetCall = tool => typeof tool?.name === 'string' && WIDGET_CALL.test(tool.name) && typeof tool.id === 'string' && tool.id !== '';
const phrases = tool => (Array.isArray(tool.loading) ? tool.loading.filter(p => typeof p === 'string' && p !== '') : []);

// Whether the thread holds the row of this tool call. A new row sits at the end, so the search starts there.
export function hasRow(items, id) {
  if (!Array.isArray(items)) return false;
  for (let n = items.length - 1; n >= 0; n--) if (items[n]?.kind === 'tool' && items[n].id === id) return true;
  return false;
}

// What to hold now. `held` is what was held at the last look, `tools` is the live list the server sends, and `inThread(id)` says
// whether the thread has the row of that call yet. The newest widget call without a row is held while it is live. Once it has gone
// from the list the place stays until its row arrives, so there is no moment with neither, but no longer than HOLD_MS from the first
// look that found it gone. It returns { id, loading, since } or null, where `since` is that first look and null while the call is live.
export function nextHold({ held, tools, inThread, now }) {
  let latest = null;
  if (Array.isArray(tools)) for (const tool of tools) if (isWidgetCall(tool) && !inThread(tool.id)) latest = tool;
  if (latest) return { id: latest.id, loading: phrases(latest), since: null };
  if (!held || inThread(held.id)) return null;
  const since = held.since ?? now;
  return now - since >= HOLD_MS ? null : { ...held, since };
}

// The line to show at this step: the call's own phrases in turn, or the default until it has sent one.
export const waitText = (loading, step) => (loading.length ? loading[step % loading.length] : DEFAULT_TEXT);
