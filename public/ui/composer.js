// The prompt box: the text, the settings under it, and the folder picker for a session that is not started yet.
import { HOME } from './env.js';
import { modelLabel, tilde } from './format.js';
import { useFields } from './hooks.js';
import { html, useLayoutEffect, useRef, useState } from './html.js';

const MODES = [['manual', 'Manual'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['auto', 'Auto'], ['bypassPermissions', 'Bypass permissions']];
const MODELS = [['claude-opus-5-5', 'Opus 5.5'], ['claude-opus-5-5[1m]', 'Opus 5.5 (1M)'], ['claude-fable-5-1', 'Fable 5.1'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5']];
const EFFORTS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];

const isBusy = s => s?.state === 'working' || s?.state === 'waiting';

// A model or effort the list does not hold, such as one Desktop recorded, gets an option of its own so the box shows the truth.
function Pick({ id, label, value, options, placeholder, labelOf, disabled, onChange }) {
  const extra = value && !options.some(([v]) => v === value) ? [[value, labelOf(value)]] : [];
  return html`<label class="pick"><span class="sr">${label}</span>
    <select id=${id} disabled=${disabled} value=${value || ''} onChange=${e => onChange(e.target.value)}>
      ${placeholder ? html`<option value="" hidden>${placeholder}</option>` : null}
      ${[...options, ...extra].map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
    </select></label>`;
}

export function FolderBar({ ctrl }) {
  const { folder, folders } = useFields(ctrl.store, 'folder', 'folders');
  const choose = e => { ctrl.setFolder(e.target.value); ctrl.loadDefaults(); };
  return html`<div class="folderbar" id="folderBar">
    <label class="folder-field">Folder <input id="folder" type="text" autocomplete="off" spellcheck=${false} value=${folder} onInput=${e => ctrl.setFolder(e.target.value)} onChange=${ctrl.loadDefaults} /></label>
    <details class="recent"><summary>Recent folders</summary><div class="folders" id="folders">
      ${folders.map((f, i) => html`<label class="folder" key=${f}><input type="radio" name="folder" value=${f} defaultChecked=${i === 0} onChange=${choose} /> ${tilde(f, HOME) || '~'}</label>`)}
    </div></details></div>`;
}

export function Composer({ ctrl, text, setText }) {
  const { status, starting } = useFields(ctrl.store, 'status', 'starting');
  const draft = !!ctrl.draft;
  const [menu, setMenu] = useState(false);
  const area = useRef(null);
  const form = useRef(null);
  const s = status || { state: 'idle', pending: [], mode: 'manual', chrome: true };
  const busy = isBusy(s);
  const typed = !!text.trim();
  // While Claude works and the box is empty, the Send button is the Stop button. Typing turns it back into Send.
  const stop = isBusy(status) && !draft && !typed;

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

  useLayoutEffect(() => { if (draft) area.current.focus({ preventScroll: true }); }, []);

  const now = useRef({});
  now.current = { menu, busy: isBusy(status), draft, ctrl };
  // A layout effect, so Esc cannot reach a chat that has just closed.
  useLayoutEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || e.isComposing) return;
      const c = now.current;
      if (c.menu) setMenu(false);
      else if (!c.draft && c.busy) c.ctrl.stop();
    };
    const onClick = e => { if (!e.target.closest('.plus')) setMenu(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, []);

  const submit = async e => {
    e.preventDefault();
    const t = area.current.value.trim();
    if (!t) return;
    if (draft) { ctrl.startNew(t, () => setText('')); return; }
    setText('');
    if (!(await ctrl.send(t, s.mode))) setText(t);
  };

  // Enter sends where there is a keyboard. On a touch screen it makes a new line, as does Shift+Enter anywhere.
  const onKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      if (e.currentTarget.value.trim()) form.current.requestSubmit();
    }
  };

  const toggleChrome = on => { setMenu(false); ctrl.setChrome(on); };

  return html`<form class="composer" id="composer" ref=${form} onSubmit=${submit}>
    <textarea id="text" ref=${area} rows="1" placeholder=${draft ? 'What should Claude do?' : 'Reply'} aria-label="Message" value=${text} onInput=${e => setText(e.target.value)} onKeyDown=${onKeyDown}></textarea>
    <div class="composer-bar">
      <div class="composer-left">
        <div class="plus">
          <button class="plus-btn" id="plus" type="button" aria-haspopup="menu" aria-expanded=${menu} aria-controls="plusMenu" aria-label="More options" onClick=${() => setMenu(!menu)}>+</button>
          <div class="menu" id="plusMenu" role="menu" hidden=${!menu}>
            <button class="menu-item" id="chrome" type="button" role="menuitemcheckbox" aria-checked=${!!s.chrome} disabled=${!status || (busy && !draft)} onClick=${() => toggleChrome(!s.chrome)}>
              <strong>Claude in Chrome</strong><span id="chromeHint">${busy && !draft ? 'Wait for Claude to finish this turn' : 'Asks before each action, except in Bypass'}</span>
            </button>
          </div>
        </div>
        <button class="tag" id="chromeTag" type="button" aria-label="Claude in Chrome is on. Turn it off." hidden=${!s.chrome} onClick=${() => toggleChrome(false)}>Chrome</button>
        <${Pick} id="mode" label="Permission mode" value=${s.mode || 'manual'} options=${MODES} disabled=${!status} onChange=${ctrl.setMode} />
      </div>
      <div class="composer-right">
        <${Pick} id="model" label="Model" value=${s.shownModel || s.model} options=${MODELS} placeholder="Model" labelOf=${modelLabel} disabled=${!status} onChange=${v => ctrl.pick('model', v)} />
        <${Pick} id="effort" label="Effort" value=${s.effort} options=${EFFORTS} placeholder="Effort" labelOf=${e => e} disabled=${!status} onChange=${v => ctrl.pick('effort', v)} />
        <button class="button send" id="send" type=${stop ? 'button' : 'submit'} data-act=${stop ? 'stop' : 'send'} disabled=${!stop && (!typed || starting)} onClick=${stop ? ctrl.stop : undefined}>${starting ? 'Starting' : stop ? 'Stop' : 'Send'}</button>
      </div>
    </div>
  </form>`;
}
