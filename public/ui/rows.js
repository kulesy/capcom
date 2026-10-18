// The rows of the transcript. Each is memoised, so a row draws again only when its own item changes.
import { md } from '../md.mjs';
import { HOME } from './env.js';
import { clip, lf, modelLabel, pre, preview, serverLabel, tilde, toolLabel } from './format.js';
import { fromTool, imageKey, overflow, TILES, tileLabel, toolShots } from './gallery.js';
import { Fragment, html, memo, useState } from './html.js';
import { summarize } from './thread.js';
import { Widget } from './widget.js';

const STATUS_LABEL = { pending: 'running', ok: 'ok', failed: 'failed', denied: 'denied' };

// A folded group shows its rows' pictures too, so they need no opening to see. CSS hides the group's copy while it is open,
// because the rows then show their own.
function ToolPictures({ shots, url, onOpen }) {
  if (!shots.length) return null;
  const more = overflow(shots.length);
  return html`<div class="shots">${shots.slice(0, TILES).map(({ img, source }, n) => {
    const key = imageKey(img);
    const last = more > 0 && n === TILES - 1;
    // NOTE: [17 Oct 2026] EK - Keep loading before src. Preact sets props in template order and WebKit fetches the moment src is set.
    return html`<button class=${last ? 'thumb more' : 'thumb'} type="button" key=${key} data-image=${key} aria-haspopup="dialog" aria-label=${tileLabel(n, shots.length, source)} onClick=${e => onOpen(key, e.currentTarget)}>
      <img loading="lazy" src=${url(img.ref)} alt=${fromTool(source)} />${last ? html`<span class="more-count" aria-hidden="true">+${more}</span>` : null}</button>`;
  })}</div>`;
}

const ToolRow = memo(function ToolRow({ t, imageUrl, onImage, connectors }) {
  const input = pre(t.name === 'Bash' ? t.input?.command || '' : JSON.stringify(t.input ?? {}, null, 2));
  const server = serverLabel(t.name, connectors);
  return html`<li class="tool" data-status=${t.status}><details data-k=${t.id}><summary><span class="tool-name">${server ? html`<span class="tool-server">${server}</span> ` : null}${toolLabel(t.name)}</span><span class="tool-sum">${t.summary || ''}</span><span class="tool-status">${STATUS_LABEL[t.status] || t.status}</span></summary>
    <pre class="tool-io">${input}</pre>${t.output ? html`<pre class="tool-io">${pre(t.output)}</pre>` : null}</details>
    <${ToolPictures} shots=${toolShots([t], connectors)} url=${imageUrl} onOpen=${onImage} /></li>`;
});

const SystemNotice = memo(function SystemNotice({ n }) {
  return html`<li class="system"><span class="lamp" data-state=${n.state || ''}></span>
    <div>
      <p class="system-title">${n.title}</p>
      ${n.text ? html`<p class="system-text">${lf(n.text)}</p>` : null}
      ${n.output ? html`<pre class="tool-io">${pre(n.output)}</pre>` : null}
      ${n.details.length ? html`<details><summary><span class="system-more">Details</span></summary>
        <dl class="system-details">${n.details.map((d, k) => html`<${Fragment} key=${k}><dt>${d.label}</dt><dd>${lf(d.value)}</dd><//>`)}</dl></details>` : null}
    </div></li>`;
});

const sameRows = (a, b) => a.length === b.length && a.every((t, n) => t === b[n]);

// One block of thinking: the start of it on the summary line, and all of it under that.
export function Thought({ text, name, open, bodyRef }) {
  return html`<details open=${open}><summary><span class="think-name">${name}</span><span class="think-sum">${preview(text)}</span></summary>
    <div class="think-text" ref=${bodyRef} dangerouslySetInnerHTML=${{ __html: md(text) }}></div></details>`;
}

const ThinkRow = memo(function ThinkRow({ t }) {
  return html`<li class="think"><${Thought} text=${t.text} name="Thought" /></li>`;
});

const ToolGroup = memo(function ToolGroup({ rows, imageUrl, onImage, connectors }) {
  const g = summarize(rows);
  return html`<li class="tool-group" data-status=${g.status}><details data-k=${`g:${rows[0].key}`}><summary><span class="group-sum">${g.title}</span>
    <span class="group-meta">${g.edited ? html`<span class="add">+${g.added}</span> <span class="del">-${g.removed}</span>` : null}<span class="tool-status">${g.note}</span></span></summary>
    <ul class="group-tools">${rows.map(r => (r.kind === 'thinking' ? html`<${ThinkRow} key=${r.key} t=${r} />` : html`<${ToolRow} key=${r.key} t=${r} imageUrl=${imageUrl} onImage=${onImage} connectors=${connectors} />`))}</ul></details>
    <${ToolPictures} shots=${toolShots(rows, connectors)} url=${imageUrl} onOpen=${onImage} /></li>`;
}, (a, b) => a.imageUrl === b.imageUrl && a.onImage === b.onImage && a.connectors === b.connectors && sameRows(a.rows, b.rows));

// A chip from Capcom's own tool or from Desktop's, so chips in resumed Desktop sessions can be started here too.
function ChipCard({ t, chip, cwd, onChip }) {
  const [busy, setBusy] = useState('');
  const i = t.input || {};
  const status = chip?.status || 'open';
  const folder = chip?.cwd || i.cwd || cwd || '';
  const act = async action => {
    setBusy(action);
    if (!(await onChip(action, t, folder))) setBusy('');
  };
  const actions = status === 'started'
    ? html`<a class="button" href=${`#/s/${encodeURIComponent(chip.startedId)}`}>Open the session</a>`
    : status === 'dismissed'
      ? html`<span class="quiet">Dismissed</span>`
      : html`<button class="button send" type="button" data-chip="start" data-tool=${t.id} data-folder=${folder} disabled=${busy === 'start'} onClick=${() => act('start')}>Start session</button>
         <button class="link" type="button" data-chip="dismiss" data-tool=${t.id} disabled=${busy === 'dismiss'} onClick=${() => act('dismiss')}>Dismiss</button>`;
  return html`<li class="chip-card" data-status=${status}>
    <p class="chip-kind">Suggested task${t.name.startsWith('mcp__capcom__') ? '' : ' from Desktop'}</p>
    <h4>${i.title || 'Untitled task'}</h4>
    ${i.tldr ? html`<p>${i.tldr}</p>` : null}
    <pre class="tool-io chip-prompt">${pre(clip(i.prompt || '', 8))}</pre>
    <p class="chip-folder">Starts in ${tilde(folder, HOME) || 'the session folder'}</p>
    <div class="chip-actions">${actions}</div></li>`;
}

// The pictures in a message. Each opens in the viewer. One from the transcript loads from its address, and one still being sent from the page's own copy.
function Thumbs({ images, url, onOpen }) {
  return html`<div class="thumbs">${images.map((img, n) => {
    const key = imageKey(img);
    const label = images.length > 1 ? `View attached image ${n + 1} of ${images.length}` : 'View attached image';
    // loading before src, as in ToolPictures.
    return html`<button class="thumb" type="button" key=${key} data-image=${key} aria-label=${label} aria-haspopup="dialog" onClick=${e => onOpen(key, e.currentTarget)}>
      <img loading=${img.src ? undefined : 'lazy'} src=${img.src ?? url(img.ref)} alt="Attached image" /></button>`;
  })}</div>`;
}

const sameRow = (a, b) => a.chip === b.chip && a.cwd === b.cwd && a.onChip === b.onChip && a.imageUrl === b.imageUrl && a.onImage === b.onImage && a.connectors === b.connectors
  && (a.item === b.item || (a.item.kind === 'group' && b.item.kind === 'group' && sameRows(a.item.rows, b.item.rows)));

export const isChip = i => i.kind === 'tool' && /__spawn_task$/.test(i.name);

export const Row = memo(function Row({ item: i, chip, cwd, onChip, imageUrl, onImage, connectors }) {
  if (i.kind === 'user') return html`<li class=${`msg user${i.sending ? ' sending' : ''}`}>${i.images?.length ? html`<${Thumbs} images=${i.images} url=${imageUrl} onOpen=${onImage} />` : null}${i.text ? lf(i.text) : null}</li>`;
  if (i.kind === 'assistant') return html`<li class="msg claude" dangerouslySetInnerHTML=${{ __html: md(i.text) }}></li>`;
  if (i.kind === 'tool') {
    if (/__spawn_task$/.test(i.name)) return html`<${ChipCard} t=${i} chip=${chip} cwd=${cwd} onChip=${onChip} />`;
    if (/__mark_chapter$/.test(i.name)) return html`<li class="chapter"><span>${i.input?.title || 'Chapter'}</span></li>`;
    if (/__show_widget$/.test(i.name) && i.input?.widget_code) return html`<${Widget} t=${i} />`;
    if (/__dismiss_task$/.test(i.name)) return html`<li hidden></li>`;
    return html`<${ToolRow} t=${i} imageUrl=${imageUrl} onImage=${onImage} connectors=${connectors} />`;
  }
  if (i.kind === 'thinking') return html`<${ThinkRow} t=${i} />`;
  if (i.kind === 'group') return html`<${ToolGroup} rows=${i.rows} imageUrl=${imageUrl} onImage=${onImage} connectors=${connectors} />`;
  if (i.kind === 'system') return html`<${SystemNotice} n=${i} />`;
  if (i.kind === 'model') return html`<li class="divider">Model set to ${modelLabel(i.model)}</li>`;
  if (i.kind === 'routine') return html`<li class="divider">Started by the ${i.name} routine</li>`;
  if (i.kind === 'divider') return html`<li class="divider">${i.text}</li>`;
  return html`<li hidden></li>`;
}, sameRow);
