// Ctrl+K searches from anywhere, laid out like Desktop's search. Chips pick what to look through, and the left and right
// arrows move between them. Archived sessions are only found here, under their own chip, most recently archived first.
import { api } from './api.js';
import { HOME } from './env.js';
import { folderName, STATE_LABEL, when } from './format.js';
import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from './html.js';
import { everyRow } from './sessions-list.js';

const CHIPS = [['all', 'All'], ['sessions', 'Sessions'], ['routines', 'Routines'], ['archived', 'Archived']];
const RECENT = 8;
const SHOWN = 50;

const matcher = words => r => {
  const text = `${r.title} ${r.cwd} ${r.branch} ${r.routine || ''}`.toLowerCase();
  return words.every(w => text.includes(w));
};

function newestFirst(ix) {
  const seen = new Set();
  return everyRow(ix).filter(r => !seen.has(r.id) && seen.add(r.id)).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

const item = r => ({ key: r.id, r });

// What the spotlight shows for a chip and a query: titled sections of items, each a session or an action.
function sectionsFor(chip, ix, archived, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const keep = words.length ? matcher(words) : () => true;
  const live = newestFirst(ix);
  if (chip === 'archived') return [{ title: 'Archived', items: archived.filter(keep).map(item) }];
  if (chip === 'routines') return [{ title: 'Routines', items: ix.routines.map(g => ({ ...g.latest, runs: g.earlier.length + 1 })).filter(keep).map(item) }];
  if (chip === 'sessions') return [{ title: 'Sessions', items: live.filter(r => !r.routine).filter(keep).slice(0, SHOWN).map(item) }];
  if (!words.length) {
    return [
      { title: 'Recents', items: live.slice(0, RECENT).map(item) },
      { title: 'Actions', items: [{ key: 'new', action: 'New session', hint: 'Ctrl N', hash: '#/new' }] },
    ];
  }
  return [
    { title: 'Sessions', items: live.filter(keep).slice(0, SHOWN).map(item) },
    { title: 'Archived', items: archived.filter(keep).slice(0, SHOWN).map(item) },
  ];
}

function Hit({ it, selected, onPick, onHover }) {
  const pick = e => { e.preventDefault(); onPick(it); };
  if (it.action) {
    return html`<li role="option" aria-selected=${selected}>
      <a class="row action" href=${it.hash} aria-selected=${selected} onMouseMove=${onHover} onClick=${pick}>
        <span class="action-icon" aria-hidden="true">+</span>
        <span class="row-title">${it.action}</span>
        <kbd class="row-time">${it.hint}</kbd>
      </a></li>`;
  }
  const { r } = it;
  const meta = r.runs ? `${r.runs} run${r.runs > 1 ? 's' : ''}` : [folderName(r.cwd, HOME), r.branch, r.archived ? 'archived' : STATE_LABEL[r.state]].filter(Boolean).join('  ');
  return html`<li role="option" aria-selected=${selected}>
    <a class="row" href=${`#/s/${encodeURIComponent(r.id)}`} aria-selected=${selected} onMouseMove=${onHover} onClick=${pick}>
      <span class="lamp" data-state=${r.state} aria-hidden="true"></span>
      <span class="row-title">${r.title || 'Untitled session'}</span>
      <time class="row-time">${when(r.archived ? r.archivedAt : r.lastActivityAt)}</time>
      ${meta ? html`<span class="row-meta">${meta}</span>` : null}
    </a></li>`;
}

export function Spotlight({ ix, onClose }) {
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('all');
  const [active, setActive] = useState(0);
  const [archived, setArchived] = useState([]);
  const input = useRef(null);
  const list = useRef(null);

  useEffect(() => {
    let live = true;
    api('api/archived').then(d => { if (live) setArchived(d.archived || []); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const sections = useMemo(() => (ix ? sectionsFor(chip, ix, archived, query).filter(s => s.items.length) : []), [ix, archived, chip, query]);
  const flat = sections.flatMap(s => s.items);
  const pick = Math.min(active, Math.max(flat.length - 1, 0));

  useLayoutEffect(() => { input.current.focus(); }, []);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [pick, sections]);

  const open = it => { onClose(); location.hash = it.hash || `#/s/${encodeURIComponent(it.r.id)}`; };
  const choose = key => { setChip(key); setActive(0); input.current.focus(); };
  const step = by => {
    setChip(now => CHIPS[Math.max(0, Math.min(CHIPS.length - 1, CHIPS.findIndex(([key]) => key === now) + by))][0]);
    setActive(0);
  };

  // The arrows change chips only from the edge of the text, so they still move the caret through a query.
  // Esc stops here, so it closes the spotlight without also stopping a chat that is running behind it.
  const onKeyDown = e => {
    const box = e.currentTarget;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowRight' && box.selectionStart === box.value.length) { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' && box.selectionEnd === 0) { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(pick + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(pick - 1, 0)); }
    else if (e.key === 'Enter' && !e.isComposing && flat[pick]) { e.preventDefault(); open(flat[pick]); }
  };

  const index = new Map(flat.map((it, i) => [it, i]));
  return html`<div class="spotlight-backdrop" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="spotlight" role="dialog" aria-modal="true" aria-label="Search">
      <div class="spotlight-top">
        <input class="spotlight-input" ref=${input} type="search" placeholder="Search" autocomplete="off" spellcheck=${false}
          aria-label="Search" aria-controls="spotlightResults" value=${query}
          onInput=${e => { setQuery(e.target.value); setActive(0); }} onKeyDown=${onKeyDown} />
        <button class="icon-btn spotlight-close" type="button" aria-label="Close" onClick=${onClose}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        </button>
      </div>
      <div class="chips" role="tablist" aria-label="What to search">
        ${CHIPS.map(([key, label]) => html`<button key=${key} class="chip" type="button" role="tab" aria-selected=${chip === key} onClick=${() => choose(key)}>${label}</button>`)}
      </div>
      <div class="spotlight-results" id="spotlightResults" role="listbox" ref=${list}>
        ${sections.length
          ? sections.map(s => html`<section key=${s.title}><h3 class="spotlight-head">${s.title}</h3><ul>
              ${s.items.map(it => html`<${Hit} key=${it.key} it=${it} selected=${index.get(it) === pick} onPick=${open} onHover=${() => index.get(it) !== pick && setActive(index.get(it))} />`)}
            </ul></section>`)
          : html`<p class="quiet pad">${ix ? 'Nothing matches.' : 'Loading sessions'}</p>`}
      </div>
      <footer class="spotlight-foot">
        <span>Close <kbd>Esc</kbd></span><span>Change type <kbd>←</kbd><kbd>→</kbd></span><span>Open <kbd>↵</kbd></span>
      </footer>
    </div>
  </div>`;
}
