// Capcom's own keys. Chrome runs Cmd+N as New Window before a tab's page sees it, but hands an installed app's page every
// key first, so Cmd+N starts a session only in the app. Chrome reserves Cmd+A nowhere, so on a Mac it archives in a tab too.
// See docs/adr/20261014-desktop-like-prompt-box-flow.md.
const APP = '(display-mode: standalone)';
const FIELD = 'input, textarea, select, [contenteditable]';

// A full-screen app window reports full screen rather than standalone, so it counts as a tab.
export const inApp = () => matchMedia(APP).matches;

export const onMac = () => navigator.platform.startsWith('Mac');

// The modifier the hints name, so they show the key that works where Capcom is running. Only a Mac has a Cmd key, and Ctrl
// works everywhere.
export const modifier = () => (inApp() && onMac() ? 'Cmd' : 'Ctrl');

// What a key press asks for: 'new' to start a session, 'find' to open the search, 'projects' to show or hide the projects sidebar,
// 'terminal' to show or hide the chat's terminal, 'archive' to archive one, or null. Chrome reserves neither Cmd+K nor Cmd+B, so
// each works in a tab as well as in the app, as Desktop's Cmd+K and Cmd+B do. A text field keeps Cmd+A for Select All, and Ctrl+A
// is left to the browser everywhere.
export function shortcut(e) {
  if (e.altKey || e.shiftKey || e.isComposing) return null;
  // Chrome's autofill sends keydown events with no key.
  const key = e.key?.toLowerCase();
  if (key === 'k' && (e.ctrlKey || e.metaKey)) return 'find';
  if (key === 'b' && (e.ctrlKey || e.metaKey)) return 'projects';
  // Ctrl+` as in Desktop and VS Code. On a Mac that is the Control key, as Cmd+` already cycles an app's windows.
  if ((key === '`' || e.code === 'Backquote') && e.ctrlKey && !e.metaKey) return 'terminal';
  if (key === 'n' && (e.ctrlKey ? !e.metaKey : e.metaKey && inApp())) return 'new';
  if (key === 'a' && e.metaKey && !e.ctrlKey && onMac() && !e.target?.closest?.(FIELD)) return 'archive';
  return null;
}

const SYMBOLS = { Cmd: '⌘', Ctrl: '⌃' };

// How every hint writes a key, so a menu and the page agree. A Mac writes the modifier as its symbol, as in ⌘K and ⌃N, and any
// other system writes Ctrl+K. `mod` is the modifier the hint names, Cmd or Ctrl.
export const keyHint = (mod, key) => (onMac() ? `${SYMBOLS[mod]}${key}` : `${mod}+${key}`);

// The hint a menu shows beside its archive item, or null where the key does nothing.
export const archiveHint = () => (onMac() ? keyHint('Cmd', 'A') : null);

// Calls fn when Capcom moves between a tab and the app's window, as Open in Chrome and full screen do. Returns the undo.
export function onAppChange(fn) {
  const query = matchMedia(APP);
  query.addEventListener('change', fn);
  return () => query.removeEventListener('change', fn);
}
