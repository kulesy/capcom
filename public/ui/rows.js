// The rows of the transcript. Each is memoised, so a row draws again only when its own item changes.
import { md } from '../md.mjs';
import { HOME } from './env.js';
import { clip, lf, modelLabel, pre, tilde, toolLabel } from './format.js';
import { html, memo, useState } from './html.js';
import { summarize } from './thread.js';
import { Widget } from './widget.js';

const STATUS_LABEL = { pending: 'running', ok: 'ok', failed: 'failed', denied: 'denied' };

const ToolRow = memo(function ToolRow({ t }) {
  const input = pre(t.name === 'Bash' ? t.input?.command || '' : JSON.stringify(t.input ?? {}, null, 2));
  return html`<li class="tool" data-status=${t.status}><details data-k=${t.id}><summary><span class="tool-name">${toolLabel(t.name)}</span><span class="tool-sum">${t.summary || ''}</span><span class="tool-status">${STATUS_LABEL[t.status] || t.status}</span></summary>
    <pre class="tool-io">${input}</pre>${t.output ? html`<pre class="tool-io">${pre(t.output)}</pre>` : null}</details></li>`;
});

const sameTools = (a, b) => a.length === b.length && a.every((t, n) => t === b[n]);

const ToolGroup = memo(function ToolGroup({ tools }) {
  const g = summarize(tools);
  return html`<li class="tool-group" data-status=${g.status}><details data-k=${`g:${tools[0].id}`}><summary><span class="group-sum">${g.title}</span>
    <span class="group-meta">${g.edited ? html`<span class="add">+${g.added}</span> <span class="del">-${g.removed}</span>` : null}<span class="tool-status">${g.note}</span></span></summary>
    <ul class="group-tools">${tools.map(t => html`<${ToolRow} key=${t.key} t=${t} />`)}</ul></details></li>`;
}, (a, b) => sameTools(a.tools, b.tools));

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

const sameRow = (a, b) => a.chip === b.chip && a.cwd === b.cwd && a.onChip === b.onChip
  && (a.item === b.item || (a.item.kind === 'group' && b.item.kind === 'group' && sameTools(a.item.tools, b.item.tools)));

export const isChip = i => i.kind === 'tool' && /__spawn_task$/.test(i.name);

export const Row = memo(function Row({ item: i, chip, cwd, onChip }) {
  if (i.kind === 'user') return html`<li class=${`msg user${i.sending ? ' sending' : ''}`}>${lf(i.text)}</li>`;
  if (i.kind === 'assistant') return html`<li class="msg claude" dangerouslySetInnerHTML=${{ __html: md(i.text) }}></li>`;
  if (i.kind === 'tool') {
    if (/__spawn_task$/.test(i.name)) return html`<${ChipCard} t=${i} chip=${chip} cwd=${cwd} onChip=${onChip} />`;
    if (/__mark_chapter$/.test(i.name)) return html`<li class="chapter"><span>${i.input?.title || 'Chapter'}</span></li>`;
    if (/__show_widget$/.test(i.name) && i.input?.widget_code) return html`<${Widget} t=${i} />`;
    if (/__dismiss_task$/.test(i.name)) return html`<li hidden></li>`;
    return html`<${ToolRow} t=${i} />`;
  }
  if (i.kind === 'group') return html`<${ToolGroup} tools=${i.tools} />`;
  if (i.kind === 'model') return html`<li class="divider">Model set to ${modelLabel(i.model)}</li>`;
  if (i.kind === 'routine') return html`<li class="divider">Started by the ${i.name} routine</li>`;
  if (i.kind === 'divider') return html`<li class="divider">${i.text}</li>`;
  return html`<li hidden></li>`;
}, sameRow);
