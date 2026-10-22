// The prompt box: the text, the images attached to it, the settings under it, and the folder picker for a session that is not started yet.
import { hintFor, matching, pick, typedCommand } from './command-rules.js';
import { SlashMenu, useCommands } from './commands.js';
import { attach, attached, detach, draftText, setDraftText } from './draft.js';
import { HOME } from './env.js';
import { modelLabel, tilde } from './format.js';
import { draftImages, imageKey } from './gallery.js';
import { useFields, useStore } from './hooks.js';
import { html, useLayoutEffect, useMemo, useRef, useState } from './html.js';
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

const CONTROLS = 'button, textarea, input, select, a';

function Attachments({ images, preparing }) {
  return html`<ul class="attached" aria-label="Attached images">
    ${images.map((img, n) => html`<li class="attachment" key=${img.id}>
      <button class="thumb" type="button" data-image=${imageKey(img)} aria-label=${`View ${img.name}`} aria-haspopup="dialog" onClick=${e => openViewer(draftImages(images), n, e.currentTarget)}><img src=${img.src} alt=${img.name} /></button>
      <button class="btn thumb-remove" data-variant="secondary" data-size="icon-xs" type="button" aria-label=${`Remove ${img.name}`} onClick=${() => detach(img.id)}><svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></li>`)}
    ${Array.from({ length: preparing }, (_, n) => html`<li class="thumb preparing" key=${`preparing${n}`} aria-hidden="true"></li>`)}
  </ul>`;
}

const Plus = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 4.25v11.5M4.25 10h11.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
const Arrow = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 16V4.5M5 9.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const Ring = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="30 11"/></svg>`;
const Square = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="2.5" fill="currentColor"/></svg>`;

// A model or effort the list does not hold, such as one Desktop recorded, gets an option of its own so the box shows the truth.
// The choice shows as plain text, as in Desktop, with the native picker laid invisibly over it so a tap still opens it.
function Pick({ id, label, value, options, placeholder, labelOf = v => v, quiet, disabled, onChange }) {
  const extra = value && !options.some(([v]) => v === value) ? [[value, labelOf(value)]] : [];
  const all = [...options, ...extra];
  const shown = all.find(([v]) => v === value)?.[1] || placeholder;
  return html`<label class=${`btn pick${quiet ? ' quiet' : ''}`} data-variant="ghost" data-size="sm" data-disabled=${disabled || null}><span class="sr">${label}</span><span aria-hidden="true">${shown}</span>
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
    <label class="folder-field">Folder <input class="input" id="folder" type="text" autocomplete="off" spellcheck=${false} value=${folder} onInput=${e => ctrl.setFolder(e.target.value)} onChange=${ctrl.loadDefaults} /></label>
    <details class="recent" open=${recentOpen} onToggle=${e => { recentOpen = e.currentTarget.open; }}><summary>Recent folders</summary><div class="folders" id="folders">
      ${folders.map((f, i) => html`<label class="folder" key=${f}><input type="radio" name="folder" value=${f} defaultChecked=${i === 0} onChange=${choose} /> ${tilde(f, HOME) || '~'}</label>`)}
    </div></details></div>`;
}

// Starting a session replaces this box with the new session's, so focus is handed on to the box that mounts next.
let keepFocus = false;

// The search opens a chat from the keyboard, and the chat's box mounts a moment later. Only a box that mounts soon after takes the
// focus, and only where there is a keyboard, so a later chat opened by a tap is left alone.
let focusNext = false;

export function focusNextComposer() {
  focusNext = true;
  setTimeout(() => { focusNext = false; }, 2000);
}

export function Composer({ ctrl }) {
  const { status, starting, folder } = useFields(ctrl.store, 'status', 'starting', 'folder');
  const images = useStore(attached, a => a.images);
  const preparing = useStore(attached, a => a.preparing);
  const [text, setLocal] = useState(draftText);
  const [over, setOver] = useState(false);
  const setText = value => { setDraftText(value); setLocal(value); };
  const draft = !!ctrl.draft;
  const area = useRef(null);
  const form = useRef(null);
  const picker = useRef(null);
  const follow = useRef(false);
  const caretAt = useRef(null);
  const [caret, setCaret] = useState(null);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState(null);
  const [choice, setChoice] = useState({ query: null, at: 0 });
  const s = status || { state: 'idle', pending: [], mode: 'manual' };
  // Images alone are a message too.
  const ready = !!text.trim() || images.length > 0;
  // While Claude works and the box is empty, the Send button is the Stop button. Typing or attaching turns it back into Send.
  const stop = isBusy(status) && !draft && !ready;

  // The / list opens while the first word of the message is being typed, with the caret in it.
  const typed = caret === null ? null : typedCommand(text, caret);
  const query = typed ? typed.query : null;
  const { commands, error } = useCommands(draft ? { cwd: folder.trim() } : { id: ctrl.id }, query !== null && focused);
  const matches = useMemo(() => (commands && query !== null ? matching(commands, query) : []), [commands, query]);
  const open = query !== null && focused && !composing && dismissed !== query && (!commands || matches.length > 0);
  const at = open && commands ? (choice.query === query ? Math.min(choice.at, matches.length - 1) : 0) : -1;
  const hint = hintFor(commands, text);
  useLayoutEffect(() => { if (dismissed !== null && dismissed !== query) setDismissed(null); }, [dismissed, query]);

  // Sizing an untouched empty box would round its natural height down, so it waits for the first text.
  const typedOnce = useRef(false);
  const fit = () => {
    const el = area.current;
    if (!el.value && !typedOnce.current) return;
    typedOnce.current = true;
    el.style.height = 'auto';
    const max = window.innerHeight * 0.4;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  };
  useLayoutEffect(fit, [text]);
  useLayoutEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // The box is controlled, so a caret placed by choosing a command has to wait for the render that writes the new text.
  useLayoutEffect(() => {
    const to = caretAt.current;
    if (to === null) return;
    caretAt.current = null;
    area.current.setSelectionRange(to, to);
  }, [text]);

  useLayoutEffect(() => {
    if (draft || keepFocus || (focusNext && matchMedia('(pointer: fine)').matches)) area.current.focus({ preventScroll: true });
    keepFocus = false;
    focusNext = false;
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
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
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

  const track = () => {
    const el = area.current;
    setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
  };
  const onInput = e => {
    if (open) follow.current = true;
    setText(e.target.value);
    track();
  };
  const onFocus = () => { setFocused(true); track(); };
  const onCompositionEnd = () => { setComposing(false); track(); };

  const choose = command => {
    const el = area.current;
    const next = pick(el.value, command.name);
    if (next.text === el.value) el.setSelectionRange(next.caret, next.caret);
    else { caretAt.current = next.caret; setText(next.text); }
    setCaret(next.caret);
    el.focus({ preventScroll: true });
  };

  // With the / list open the arrows move through it, Enter and Tab choose, and Esc closes it. Any other key is typed as usual.
  const slashKey = e => {
    if (!open || e.isComposing || e.keyCode === 229) return false;
    if (e.key === 'Escape') { setDismissed(query); return true; }
    if (!commands) return false;
    const by = e.altKey || e.ctrlKey || e.metaKey || e.shiftKey ? 0 : { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (by) {
      const next = Math.max(0, Math.min(at + by, matches.length - 1));
      if (next !== at) { follow.current = true; setChoice({ query, at: next }); }
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) { choose(matches[at]); return true; }
    return false;
  };

  // Enter sends where there is a keyboard. On a touch screen it makes a new line, as does Shift+Enter anywhere.
  const onKeyDown = e => {
    if (slashKey(e)) { e.preventDefault(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      if (e.currentTarget.value.trim() || images.length) form.current.requestSubmit();
    }
  };

  // Like shadcn's InputGroupAddon, a press on the box outside its controls keeps or puts the cursor in the text.
  const onBoxMouseDown = e => { if (!e.target.closest(CONTROLS)) e.preventDefault(); };
  const onBoxClick = e => { if (!e.target.closest(CONTROLS)) area.current.focus({ preventScroll: true }); };

  const sendLabel = starting ? 'Starting' : stop ? 'Stop' : 'Send';
  return html`<form class="composer" id="composer" ref=${form} data-over=${over || null} onSubmit=${submit}>
    <div class="composer-box input-group" onMouseDown=${onBoxMouseDown} onClick=${onBoxClick}>
      ${images.length || preparing ? html`<${Attachments} images=${images} preparing=${preparing} />` : null}
      ${open ? html`<${SlashMenu} matches=${commands ? matches : null} error=${error} at=${at} follow=${follow} onPick=${choose} onSelect=${n => { if (n !== at) setChoice({ query, at: n }); }} />` : null}
      <div class="composer-row">
        <button class="btn attach" data-variant="ghost" data-size="icon-sm" id="attach" type="button" aria-label="Attach images" data-tip="Attach images" onClick=${() => picker.current.click()}><${Plus} /></button>
        <input type="file" ref=${picker} accept=${TYPES.join(',')} multiple hidden onChange=${pickFiles} />
        <div class="composer-field">
          <textarea class="input-group-control" id="text" ...${NO_GRAMMARLY} ref=${area} rows="1" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded=${open}
            aria-controls=${open ? 'slash-list' : undefined} aria-activedescendant=${at >= 0 ? `slash-${at}` : undefined} aria-describedby=${hint ? 'slash-hint' : undefined}
            placeholder="Type / for commands" aria-label="Message" value=${text}
            onInput=${onInput} onKeyDown=${onKeyDown} onKeyUp=${track} onClick=${track} onFocus=${onFocus} onBlur=${() => setFocused(false)}
            oncompositionstart=${() => setComposing(true)} oncompositionend=${onCompositionEnd}></textarea>
          ${hint ? html`<div class="composer-hint" aria-hidden="true"><span>${text}</span>${hint}</div><span class="sr" id="slash-hint">Arguments: ${hint}</span>` : null}
        </div>
        <button class="btn send" data-size="icon-sm" id="send" type=${stop ? 'button' : 'submit'} data-act=${starting ? 'starting' : stop ? 'stop' : 'send'} aria-label=${sendLabel} data-tip=${sendLabel} disabled=${!stop && (!ready || starting || preparing > 0)} onClick=${stop ? ctrl.stop : undefined}>${starting ? html`<${Ring} />` : stop ? html`<${Square} />` : html`<${Arrow} />`}</button>
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
