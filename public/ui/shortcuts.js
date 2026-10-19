// Capcom's own keys. Chrome runs Cmd+N as New Window before a tab's page sees it, but hands an installed app's page every
// key first, so Cmd+N starts a session only in the app. See docs/adr/20261014-desktop-like-prompt-box-flow.md.
const APP = '(display-mode: standalone)';

// A full-screen app window reports full screen rather than standalone, so it counts as a tab.
export const inApp = () => matchMedia(APP).matches;

// The modifier the hints name, so they show the key that works where Capcom is running. Only a Mac has a Cmd key, and Ctrl
// works everywhere.
export const modifier = () => (inApp() && navigator.platform.startsWith('Mac') ? 'Cmd' : 'Ctrl');

// What a key press asks for: 'new' to start a session, 'find' to open the search, or null.
export function shortcut(e) {
  if (e.altKey || e.shiftKey || e.isComposing) return null;
  // Chrome's autofill sends keydown events with no key.
  const key = e.key?.toLowerCase();
  if (key === 'k' && (e.ctrlKey || e.metaKey)) return 'find';
  if (key === 'n' && (e.ctrlKey ? !e.metaKey : e.metaKey && inApp())) return 'new';
  return null;
}

// Calls fn when Capcom moves between a tab and the app's window, as Open in Chrome and full screen do. Returns the undo.
export function onAppChange(fn) {
  const query = matchMedia(APP);
  query.addEventListener('change', fn);
  return () => query.removeEventListener('change', fn);
}
