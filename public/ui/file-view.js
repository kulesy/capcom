// The file viewer: a file that a reply links to, read in a dialog over the page. A picture opens in the image viewer instead.
import { md } from '../md.mjs';
import { api } from './api.js';
import { Dialog } from './dialog.js';
import { fileSize, grouped, lf } from './format.js';
import { useStore } from './hooks.js';
import { html, useLayoutEffect, useMemo, useRef, useState } from './html.js';
import { createStore } from './store.js';
import { NewTab, openViewer } from './viewer.js';

const shown = createStore({ open: null });

// A file that arrives faster than this opens with no loading dialog flashing in front of it.
const WAIT_MS = 300;

let count = 0;

const route = (chat, what, path) => `api/sessions/${encodeURIComponent(chat)}/${what}?path=${encodeURIComponent(path)}`;

// Opens the file at `path` that chat `id` links to, at `line` if given. `from` is the link, which gets the focus back.
export function openFile({ id, path, line, from }) {
  const n = ++count;
  const mine = () => shown.get().open?.n === n;
  const patch = change => { if (mine()) shown.set(s => ({ open: { ...s.open, ...change } })); };
  shown.set({ open: { n, chat: id, path, line, from, late: false, preview: null, error: '' } });
  setTimeout(() => patch({ late: true }), WAIT_MS);
  api(route(id, 'preview', path)).then(preview => {
    if (!mine()) return;
    if (preview.kind === 'image' && !preview.tooLarge) {
      const src = route(id, 'file', path);
      shown.set({ open: null });
      openViewer([{ key: src, src, alt: preview.name }], 0, from);
    } else patch({ preview });
  }, e => patch({ error: e.message }));
}

export const closeFile = () => shown.set({ open: null });

const Download = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 3.5v9M6 8.5l4 4 4-4M4 15.5h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const Code = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M7.5 6 3.5 10l4 4M12.5 6l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const Page = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 3.5h5.5L15 7v9a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5ZM11 3.5V7h4M8 10.5h4M8 13h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

const linesOf = text => {
  const lines = lf(text).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

// What a file is called in the card for one that cannot be shown: its extension in capitals, or just "File".
const kindName = name => {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1];
  return ext ? `${ext.toUpperCase()} file` : 'File';
};

// One element a line, each text a text node. The numbers are drawn apart from the text and hidden from copying and from a screen reader.
function Lines({ text, line }) {
  const lines = useMemo(() => linesOf(text), [text]);
  if (!lines.length) return html`<p class="file-note">This file is empty.</p>`;
  return html`<div class="file-lines" style=${{ '--digits': String(String(lines.length).length) }}>${lines.map((l, n) => html`<div class="file-line" data-hit=${n + 1 === line ? '' : undefined}><span class="file-no" aria-hidden="true">${n + 1}</span><span class="file-text">${l}</span></div>`)}</div>`;
}

function Document({ text }) {
  const markup = useMemo(() => md(text), [text]);
  return html`<div class="msg claude file-doc" dangerouslySetInnerHTML=${{ __html: markup }}></div>`;
}

// Where the focus goes when the dialog closes: the link clicked, or that link drawn again if its reply has been redrawn since.
const backTo = (from, path) => (from?.isConnected ? from : [...document.querySelectorAll('a[data-file]')].find(a => a.dataset.file === path));

function FileView({ open, chat, path, line, from, preview, error }) {
  const body = useRef(null);
  const [source, setSource] = useState(line != null);
  const name = preview?.name ?? path.split('/').pop();
  const kind = preview?.kind;
  const url = route(chat, 'file', path);
  const text = kind === 'text' || kind === 'markdown';
  const tall = !error && (!preview || kind === 'pdf' || (text && !preview.tooLarge));
  const openable = !!preview && !preview.tooLarge && kind !== 'binary' && kind !== 'image';
  const lines = preview?.truncated ? linesOf(preview.text).length : 0;

  // The line asked for goes to the middle of the body, and anything else starts at the top.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const hit = el.querySelector('[data-hit]');
    el.scrollTop = hit ? hit.offsetTop - (el.clientHeight - hit.offsetHeight) / 2 : 0;
  }, [preview, source]);

  let content;
  if (error) content = html`<p class="file-note" role="alert">${error}</p>`;
  else if (!preview) content = html`<p class="file-note" role="status">Loading</p>`;
  else if (preview.tooLarge || !(text || kind === 'pdf')) {
    content = html`<div class="file-meta">
      <p class="file-kind">${kindName(name)}</p>
      <p class="file-sub">${fileSize(preview.size)}${preview.tooLarge ? '. This file is too large to open here.' : ''}</p>
      ${preview.tooLarge ? null : html`<a class="btn" data-variant="outline" href=${`${url}&download=1`} download=${name}><${Download} />Download</a>`}
    </div>`;
  } else if (kind === 'pdf') content = html`<iframe class="file-pdf" src=${url} title=${name}></iframe>`;
  else {
    content = html`${kind === 'markdown' && !source ? html`<${Document} text=${preview.text} />` : html`<${Lines} text=${preview.text} line=${line} />`}
      ${preview.truncated ? html`<p class="file-end">Showing the first ${grouped(lines)} lines of ${fileSize(preview.size)}. <a href=${url} target="_blank" rel="noopener">Open in new tab</a></p>` : null}`;
  }

  return html`<${Dialog} part="file-view" open=${open} labelledBy="file-title" initial=${body} restoreTo=${() => backTo(from, path)} onClose=${closeFile}>
    <div class="file-head">
      <div class="file-title">
        <h2 id="file-title" class="file-name">${name}</h2>
        <p class="file-path">${path}</p>
        ${preview ? html`<p class="file-size">${fileSize(preview.size)}</p>` : null}
      </div>
      ${openable ? html`<div class="file-actions">
        ${kind === 'markdown' ? html`<button class="btn" data-variant="outline" data-size="icon-sm" type="button" aria-label=${source ? 'Show rendered' : 'Show source'} data-tip=${source ? 'Show rendered' : 'Show source'} onClick=${() => setSource(s => !s)}>${source ? html`<${Page} />` : html`<${Code} />`}</button>` : null}
        <a class="btn" data-variant="outline" data-size="icon-sm" href=${url} target="_blank" rel="noopener" aria-label="Open in new tab" data-tip="Open in new tab"><${NewTab} /></a>
        <a class="btn" data-variant="outline" data-size="icon-sm" href=${`${url}&download=1`} download=${name} aria-label="Download" data-tip="Download"><${Download} /></a>
      </div>` : null}
    </div>
    <div class="file-body" ref=${body} data-tall=${tall ? '' : undefined} data-kind=${kind} tabindex=${tall && kind !== 'pdf' ? 0 : -1} role=${tall && kind !== 'pdf' ? 'region' : undefined} aria-label=${tall && kind !== 'pdf' ? `Contents of ${name}` : undefined}>${content}</div>
  <//>`;
}

// The dialog stays until its exit animation has played, and the next file replaces it at once. It opens only once the file has
// answered or been waited for, and the waiting shows as "Loading".
export function FileViewHost() {
  const head = useStore(shown, s => s.open);
  const visible = head && (head.late || head.preview || head.error) ? head : null;
  const last = useRef(null);
  if (visible) last.current = visible;
  const view = visible ?? last.current;
  return view ? html`<${FileView} key=${view.n} open=${!!visible} ...${view} />` : null;
}
