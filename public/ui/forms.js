import { html, useLayoutEffect, useRef, useState } from './html.js';

export const escapeCancels = cancel => e => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  cancel();
};

// A name typed into the list, up to `max` characters. `onSubmit` resolves true when the server took it, and the caller then closes
// the form. It resolves false when the server refused, and the form stays open to try again.
export function NameForm({ label, value = '', action, max = 80, onSubmit, onCancel }) {
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
      <input class="input" ref=${input} type="text" value=${text} maxlength=${max} autocomplete="off" enterkeyhint="done" onInput=${e => setText(e.currentTarget.value)} /></label>
    <button class="btn" data-variant="outline" type="button" onClick=${onCancel}>Cancel</button>
    <button class="btn" type="submit" disabled=${busy || !text.trim()}>${action}</button>
  </form>`;
}
