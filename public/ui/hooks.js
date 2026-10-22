import { tickIn } from './format.js';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from './html.js';
import { modifier, onAppChange } from './shortcuts.js';
import { local } from './storage.js';

// Re-renders when the selected slice of the store changes. A selector must return an existing value, not a new object.
export function useStore(store, select) {
  const [, rerender] = useReducer(n => n + 1, 0);
  const pick = useRef(select);
  pick.current = select;
  const value = select(store.get());
  const shown = useRef(value);
  shown.current = value;
  useLayoutEffect(() => {
    const check = () => { if (!Object.is(pick.current(store.get()), shown.current)) rerender(); };
    check();
    return store.subscribe(check);
  }, [store]);
  return value;
}

// State kept in localStorage under capcom.<key>.
export function useLocal(key, fallback) {
  const [value, setValue] = useState(() => local.get(key, fallback));
  const latest = useRef(value);
  const set = useCallback(next => {
    const v = typeof next === 'function' ? next(latest.current) : next;
    latest.current = v;
    local.set(key, v);
    setValue(v);
  }, [key]);
  return [value, set];
}

// The modifier a shortcut hint names, kept up to date as Capcom moves between a tab and the installed app.
export function useModifier() {
  const [mod, setMod] = useState(modifier);
  useEffect(() => onAppChange(() => setMod(modifier())), []);
  return mod;
}

// Whether the window is wide enough for the projects to sit in a column beside the list. app.css changes its grid at the same width.
const WIDE = '(min-width: 56rem)';

export function useWide() {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const query = matchMedia(WIDE);
    const sync = () => setWide(query.matches);
    query.addEventListener('change', sync);
    sync();
    return () => query.removeEventListener('change', sync);
  }, []);
  return wide;
}

export function useDocumentTitle(title) {
  useEffect(() => { document.title = title; }, [title]);
}

// Draws the component again every second while `on`, so a timer on screen keeps counting between events. Given the time it counts
// from, each draw falls just after a whole second of it, so timers counting from one start change together.
export function useClock(on, since) {
  const [, rerender] = useReducer(n => n + 1, 0);
  useEffect(() => {
    if (!on) return undefined;
    if (!Number.isFinite(since)) {
      const timer = setInterval(rerender, 1000);
      return () => clearInterval(timer);
    }
    let timer;
    const wait = () => {
      timer = setTimeout(() => { rerender(); wait(); }, tickIn(Date.now(), since));
    };
    wait();
    return () => clearTimeout(timer);
  }, [on, since]);
}

export const atBottom = el => el.scrollHeight - el.scrollTop - el.clientHeight < 80;

// Keeps a scroll box pinned to its bottom when it was within 80px of it before this render changed the page.
// The measure runs in the render body because the DOM still has its old size there.
export function useStick(box) {
  const was = useRef(false);
  if (box.current) was.current = atBottom(box.current);
  useLayoutEffect(() => {
    if (was.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  });
}

// Like useStore, for several plain fields at once. Returns the whole state, so read only the fields named here.
export function useFields(store, ...keys) {
  const [, rerender] = useReducer(n => n + 1, 0);
  const state = store.get();
  const shown = useRef(state);
  shown.current = state;
  useLayoutEffect(() => {
    const check = () => {
      const now = store.get();
      if (keys.some(k => !Object.is(now[k], shown.current[k]))) rerender();
    };
    check();
    return store.subscribe(check);
  }, [store]);
  return state;
}
