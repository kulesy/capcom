// The look this device wears, kept as capcom.look. The boot script in index.html sets the same root attribute and theme colours before
// the first paint, so a change to what applyLook sets goes there too.
import { useLocal } from './hooks.js';
import { html, useLayoutEffect } from './html.js';

const GHOST = 'ghost';

function applyLook(ghost) {
  const root = document.documentElement;
  if (ghost) root.dataset.look = GHOST;
  else delete root.dataset.look;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = (ghost ? meta.dataset.ghost : meta.dataset.standard) ?? meta.content;
}

// Anything stored but "ghost" is the standard look.
export function LookSwitch() {
  const [look, setLook] = useLocal('look', 'standard');
  const ghost = look === GHOST;
  useLayoutEffect(() => applyLook(ghost), [ghost]);
  return html`<button class="btn look" data-variant="ghost" data-size="sm" type="button" aria-pressed=${ghost} onClick=${() => setLook(ghost ? 'standard' : GHOST)}>Ghost</button>`;
}
