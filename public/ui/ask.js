// One question before an action that cannot be fully undone. It is a modal dialog over the whole page, because below 56rem the list is
// hidden while a chat is open, so a question asked inside the list could not be seen. Like the viewer, it sits beside the app.
import { useStore } from './hooks.js';
import { html, useLayoutEffect, useRef } from './html.js';
import { shortcut } from './shortcuts.js';
import { createStore } from './store.js';

const asked = createStore({ queue: [] });

// Asks "<action> <title>?" with `detail` under it, and calls `run` if the owner confirms. Declining puts the focus on what `back()`
// gives, or else on what had it. A question asked while another is open waits its turn, and gives the focus back to the same place.
export function ask({ action, title, detail, run, back }) {
  const { queue } = asked.get();
  const from = queue[0]?.from ?? document.activeElement;
  asked.set({ queue: [...queue, { action, title, detail, run, back, from }] });
}

const answered = () => asked.set(({ queue }) => ({ queue: queue.slice(1) }));

function Ask({ action, title, detail, run, back, from }) {
  const box = useRef(null);
  const cancel = useRef(null);

  // The dialog closes before the focus moves, because while it is modal the rest of the page cannot take the focus. It says whether it
  // was open, so an Esc and a cancel that both arrive answer the question once and leave the next one in the queue alone.
  const leave = () => {
    if (!box.current?.open) return false;
    box.current.close();
    answered();
    return true;
  };
  const decline = () => {
    if (!leave()) return;
    const to = back?.() ?? from;
    if (to?.isConnected) to.focus({ preventScroll: true });
  };
  const confirm = () => { if (leave()) run(); };

  // Cancel has the focus, so Enter does no harm. The document hears every key first, because a click on the dialog's text or backdrop
  // can leave the focus on the body. So Esc cannot also stop a running chat, and Cmd+A cannot select the page.
  useLayoutEffect(() => {
    box.current.showModal();
    cancel.current.focus({ preventScroll: true });
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); decline(); }
      else if (shortcut(e)) e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  return html`<dialog class="ask-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ask-text" aria-describedby="ask-detail" ref=${box}
    onCancel=${e => { e.preventDefault(); decline(); }}>
    <p id="ask-text">${action} <strong>${title}</strong>?</p>
    <p id="ask-detail">${detail}</p>
    <div class="ask-actions">
      <button class="btn" data-variant="destructive" type="button" onClick=${confirm}>${action}</button>
      <button class="btn" data-variant="outline" type="button" ref=${cancel} onClick=${decline}>Cancel</button>
    </div>
  </dialog>`;
}

export function AskHost() {
  const open = useStore(asked, s => s.queue[0]);
  return open ? html`<${Ask} key=${open} ...${open} />` : null;
}
