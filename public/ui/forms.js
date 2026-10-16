import { html, useLayoutEffect, useRef, useState } from './html.js';

const escapeCancels = cancel => e => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  cancel();
};

// A name typed into the list. `onSubmit` resolves true when the server took it, and the caller then closes the form.
// It resolves false when the server refused, and the form stays open to try again.
export function NameForm({ label, value = '', action, onSubmit, onCancel }) {
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const form = useRef(null);
  useLayoutEffect(() => {
    input.current.focus({ preventScroll: true });
    input.current.select();
    form.current.scrollIntoView({ block: 'nearest' });
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    if (!(await onSubmit(text))) setBusy(false);
  }

  return html`<form class="name-form" ref=${form} onSubmit=${submit} onKeyDown=${escapeCancels(onCancel)}>
    <label class="name-field"><span>${label}</span>
      <input ref=${input} type="text" value=${text} maxlength="80" autocomplete="off" enterkeyhint="done" onInput=${e => setText(e.currentTarget.value)} /></label>
    <button class="button" type="submit" disabled=${busy || !text.trim()}>${action}</button>
    <button class="button" type="button" onClick=${onCancel}>Cancel</button>
  </form>`;
}

// Asks before a project goes, and says what happens to its groups. Cancel has the focus, so Enter does no harm.
export function DeleteProject({ name, groups, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const cancel = useRef(null);
  useLayoutEffect(() => cancel.current.focus(), []);

  async function confirm() {
    setBusy(true);
    if (!(await onConfirm())) setBusy(false);
  }

  const result = groups ? `Its ${groups === 1 ? 'group moves' : `${groups} groups move`} to the top level. No group or session is deleted.` : 'It has no groups.';
  return html`<div class="confirm" role="group" aria-label="Delete project" onKeyDown=${escapeCancels(onCancel)}>
    <p>Delete <strong>${name}</strong>? ${result}</p>
    <div class="confirm-actions">
      <button class="button danger" type="button" disabled=${busy} onClick=${confirm}>Delete project</button>
      <button class="button" type="button" ref=${cancel} onClick=${onCancel}>Cancel</button>
    </div>
  </div>`;
}
