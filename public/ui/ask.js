// One question before an action that cannot be fully undone. It is shadcn's alert dialog over the whole page, because below 56rem the
// list is hidden while a chat is open, so a question asked inside the list could not be seen. Like the viewer, it sits beside the app.
import { Dialog } from './dialog.js';
import { useStore } from './hooks.js';
import { html, useRef } from './html.js';
import { createStore } from './store.js';

const asked = createStore({ queue: [] });

// Asks "<action> “<title>”?" with `detail` under it, and calls `run` if the owner confirms. Declining puts the focus on what `back()`
// gives, or else on what had it. A question asked while another is open waits its turn, and gives the focus back to the same place.
export function ask({ action, title, detail, run, back }) {
  const { queue } = asked.get();
  const from = queue[0]?.from ?? document.activeElement;
  asked.set({ queue: [...queue, { action, title, detail, run, back, from }] });
}

const answered = () => asked.set(({ queue }) => ({ queue: queue.slice(1) }));

function Ask({ open, action, title, detail, run, back, from }) {
  const cancel = useRef(null);
  const done = useRef(false);

  // An Esc and a click that both arrive answer the question once and leave the next one in the queue alone.
  const settle = () => {
    if (done.current) return false;
    done.current = true;
    answered();
    return true;
  };

  return html`<${Dialog} alert open=${open} labelledBy="ask-title" describedBy="ask-detail" initial=${cancel} restoreTo=${() => back?.() ?? from} onClose=${settle}>
    <div data-slot="alert-dialog-header">
      <h2 id="ask-title" data-slot="alert-dialog-title">${action} “${title}”?</h2>
      <p id="ask-detail" data-slot="alert-dialog-description">${detail}</p>
    </div>
    <div data-slot="alert-dialog-footer">
      <button class="btn" data-variant="outline" type="button" data-slot="alert-dialog-cancel" ref=${cancel} onClick=${settle}>Cancel</button>
      <button class="btn" data-variant="destructive" type="button" data-slot="alert-dialog-action" onClick=${() => { if (settle()) run(); }}>${action}</button>
    </div>
  <//>`;
}

// The last question stays until its exit animation has played, and the next one replaces it at once.
export function AskHost() {
  const head = useStore(asked, s => s.queue[0]);
  const last = useRef(null);
  if (head) last.current = head;
  const shown = head ?? last.current;
  return shown ? html`<${Ask} key=${shown} open=${!!head} ...${shown} />` : null;
}
