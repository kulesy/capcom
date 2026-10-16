// The prompt box: the text, the images attached to it, the settings under it, and the folder picker for a session that is not started yet.
import { attach, attached, detach, draftText, setDraftText } from './draft.js';
import { HOME } from './env.js';
import { modelLabel, tilde } from './format.js';
import { draftImages, imageKey } from './gallery.js';
import { useFields, useStore } from './hooks.js';
import { html, useLayoutEffect, useRef, useState } from './html.js';
import { TYPES } from './images.js';
import { openViewer } from './viewer.js';

const MODES = [['manual', 'Manual'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['auto', 'Auto'], ['bypassPermissions', 'Bypass permissions']];
const MODELS = [['claude-opus-5-5', 'Opus 5.5'], ['claude-opus-5-5[1m]', 'Opus 5.5 (1M)'], ['claude-fable-5-1', 'Fable 5.1'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5']];
const EFFORTS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];
// NOTE: [16 Oct 2026] EK - Grammarly's extension leaves a field alone when it carries these attributes.
// Without them it puts its own buttons inside the message box.
const NO_GRAMMARLY = { 'data-gramm': 'false', 'data-gramm_editor': 'false', 'data-enable-grammarly': 'false' };

const isBusy = s => s?.state === 'working' || s?.state === 'waiting';

const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');

function Attachments({ images, preparing }) {
  return html`<ul class="attached" aria-label="Attached images">
    ${images.map((img, n) => html`<li class="attachment" key=${img.id}>
      <button class="thumb" type="button" data-image=${imageKey(img)} aria-label=${`View ${img.name}`} aria-haspopup="dialog" onClick=${e => openViewer(draftImages(images), n, e.currentTarget)}><img src=${img.src} alt=${img.name} /></button>
      <button class="thumb-remove" type="button" aria-label=${`Remove ${img.name}`} onClick=${() => detach(img.id)}><svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></li>`)}
    ${Array.from({ length: preparing }, (_, n) => html`<li class="thumb preparing" key=${`preparing${n}`} aria-hidden="true"></li>`)}
  </ul>`;
}

const Plus = () => html`<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 4.25v11.5M4.25 10h11.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const Arrow = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 16V4.5M5 9.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const Ring = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="30 11"/></svg>`;
const Square = () => html`<svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2.5" fill="currentColor"/></svg>`;

// A model or effort the list does not hold, such as one Desktop recorded, gets an option of its own so the box shows the truth.
// The choice shows as plain text, as in Desktop, with the native picker laid invisibly over it so a tap still opens it.
function Pick({ id, label, value, options, placeholder, labelOf = v => v, quiet, disabled, onChange }) {
  const extra = value && !options.some(([v]) => v === value) ? [[value, labelOf(value)]] : [];
  const all = [...options, ...extra];
  const shown = all.find(([v]) => v === value)?.[1] || placeholder;
  return html`<label class=${`pick${quiet ? ' quiet' : ''}`} data-disabled=${disabled || null}><span class="sr">${label}</span><span aria-hidden="true">${shown}</span>
    <select id=${id} disabled=${disabled} value=${value || ''} onChange=${e => onChange(e.target.value)}>
      ${placeholder ? html`<option value="" hidden>${placeholder}</option>` : null}
      ${all.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
    </select></label>`;
}

let recentOpen = false;

export function FolderBar({ ctrl }) {
  const { folder, folders } = useFields(ctrl.store, 'folder', 'folders');
  const choose = e => { ctrl.setFolder(e.target.value); ctrl.loadDefaults(); };
  return html`<div class="folderbar" id="folderBar">
    <label class="folder-field">Folder <input id="folder" type="text" autocomplete="off" spellcheck=${false} value=${folder} onInput=${e => ctrl.setFolder(e.target.value)} onChange=${ctrl.loadDefaults} /></label>
    <details class="recent" open=${recentOpen} onToggle=${e => { recentOpen = e.currentTarget.open; }}><summary>Recent folders</summary><div class="folders" id="folders">
      ${folders.map((f, i) => html`<label class="folder" key=${f}><input type="radio" name="folder" value=${f} defaultChecked=${i === 0} onChange=${choose} /> ${tilde(f, HOME) || '~'}</label>`)}
    </div></details></div>`;
}

// Starting a session replaces this box with the new session's, so focus is handed on to the box that mounts next.
let keepFocus = false;

export function Composer({ ctrl }) {
  const { status, starting } = useFields(ctrl.store, 'status', 'starting');
  const images = useStore(attached, a => a.images);
  const preparing = useStore(attached, a => a.preparing);
  const [text, setLocal] = useState(draftText);
  const [over, setOver] = useState(false);
  const setText = value => { setDraftText(value); setLocal(value); };
  const draft = !!ctrl.draft;
  const area = useRef(null);
  const form = useRef(null);
  const picker = useRef(null);
  const s = status || { state: 'idle', pending: [], mode: 'manual' };
  // Images alone are a message too.
  const ready = !!text.trim() || images.length > 0;
  // While Claude works and the box is empty, the Send button is the Stop button. Typing or attaching turns it back into Send.
  const stop = isBusy(status) && !draft && !ready;

  // Sizing an untouched empty box would round its natural height down, so it waits for the first text.
  const typedOnce = useRef(false);
  useLayoutEffect(() => {
    if (!text && !typedOnce.current) return;
    typedOnce.current = true;
    const el = area.current;
    el.style.height = 'auto';
    const max = window.innerHeight * 0.4;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [text]);

  useLayoutEffect(() => {
    if (draft || keepFocus) area.current.focus({ preventScroll: true });
    keepFocus = false;
    return () => {
      keepFocus = document.activeElement === area.current;
      setTimeout(() => { keepFocus = false; });
    };
  }, []);

  const now = useRef({});
  now.current = { busy: isBusy(status), draft, ctrl };
  // A layout effect, so Esc cannot reach a chat that has just closed.
  useLayoutEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || e.isComposing) return;
      const c = now.current;
      if (!c.draft && c.busy) c.ctrl.stop();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Pasting or dropping image files anywhere on the page attaches them, even in a text field, which would lose them.
  // A paste that also holds text stays text if it has several lines, as a spreadsheet copy does, or is in another field.
  useLayoutEffect(() => {
    const note = text => now.current.ctrl.notice(text);
    let depth = 0;
    const onPaste = e => {
      const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!files.length || /[\n\t]/.test(text)) return;
      if (text && e.target !== area.current && e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      attach(files, note);
      if (matchMedia('(pointer: fine)').matches) area.current.focus({ preventScroll: true });
    };
    const onEnter = e => { if (hasFiles(e)) { depth++; setOver(true); } };
    const onOver = e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
    const onLeave = e => { if (hasFiles(e) && --depth <= 0) { depth = 0; setOver(false); } };
    const onDrop = e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      attach([...e.dataTransfer.files], note);
    };
    const on = { paste: onPaste, dragenter: onEnter, dragover: onOver, dragleave: onLeave, drop: onDrop };
    for (const [type, fn] of Object.entries(on)) document.addEventListener(type, fn);
    return () => { for (const [type, fn] of Object.entries(on)) document.removeEventListener(type, fn); };
  }, []);

  const submit = async e => {
    e.preventDefault();
    const t = area.current.value.trim();
    const sent = attached.get().images;
    if ((!t && !sent.length) || attached.get().preparing) return;
    const clear = () => { setText(''); attached.set({ images: [] }); };
    if (draft) { ctrl.startNew(t, sent, clear); return; }
    clear();
    if (!(await ctrl.send(t, sent, s.mode))) { setText(t); attached.set({ images: sent }); }
  };

  const pickFiles = e => {
    const files = [...e.currentTarget.files];
    e.currentTarget.value = '';
    if (files.length) attach(files, text => ctrl.notice(text));
    if (matchMedia('(pointer: fine)').matches) area.current.focus({ preventScroll: true });
  };

  // Enter sends where there is a keyboard. On a touch screen it makes a new line, as does Shift+Enter anywhere.
  const onKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      if (e.currentTarget.value.trim() || images.length) form.current.requestSubmit();
    }
  };

  const sendLabel = starting ? 'Starting' : stop ? 'Stop' : 'Send';
  return html`<form class="composer" id="composer" ref=${form} data-over=${over || null} onSubmit=${submit}>
    <div class="composer-box">
      ${images.length || preparing ? html`<${Attachments} images=${images} preparing=${preparing} />` : null}
      <div class="composer-row">
        <button class="icon-button attach" id="attach" type="button" aria-label="Attach images" title="Attach images" onClick=${() => picker.current.click()}><${Plus} /></button>
        <input type="file" ref=${picker} accept=${TYPES.join(',')} multiple hidden onChange=${pickFiles} />
        <textarea id="text" ...${NO_GRAMMARLY} ref=${area} rows="1" placeholder=${draft ? 'What should Claude do?' : 'Reply'} aria-label="Message" value=${text} onInput=${e => setText(e.target.value)} onKeyDown=${onKeyDown}></textarea>
        <button class="icon-button send" id="send" type=${stop ? 'button' : 'submit'} data-act=${starting ? 'starting' : stop ? 'stop' : 'send'} aria-label=${sendLabel} title=${sendLabel} disabled=${!stop && (!ready || starting || preparing > 0)} onClick=${stop ? ctrl.stop : undefined}>${starting ? html`<${Ring} />` : stop ? html`<${Square} />` : html`<${Arrow} />`}</button>
      </div>
    </div>
    <div class="composer-bar">
      <div class="composer-left">
        <${Pick} id="mode" label="Permission mode" value=${s.mode || 'manual'} options=${MODES} disabled=${!status} onChange=${ctrl.setMode} />
      </div>
      <div class="composer-right">
        <${Pick} id="model" label="Model" value=${s.shownModel || s.model} options=${MODELS} placeholder="Model" labelOf=${modelLabel} disabled=${!status} onChange=${v => ctrl.pick('model', v)} />
        <${Pick} id="effort" label="Effort" value=${s.effort} options=${EFFORTS} placeholder="Effort" quiet disabled=${!status} onChange=${v => ctrl.pick('effort', v)} />
      </div>
    </div>
  </form>`;
}
