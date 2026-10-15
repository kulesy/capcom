// Ctrl+K finds a session from anywhere: the newest first while the box is empty, then whatever matches what is typed.
// Archived sessions are only found here. They join any search, and typing "archived" lists them all, newest first.
import { api } from './api.js';
import { HOME } from './env.js';
import { folderName, STATE_LABEL, when } from './format.js';
import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from './html.js';
import { everyRow } from './sessions-list.js';

const SHOWN = 50;

const matches = (r, words) => {
  const text = `${r.title} ${r.cwd} ${r.branch} ${r.routine || ''}`.toLowerCase();
  return words.every(w => text.includes(w));
};

function hits(ix, archived, query) {
  if (query.trim().toLowerCase() === 'archived') return archived;
  const seen = new Set();
  const rows = everyRow(ix).filter(r => !seen.has(r.id) && seen.add(r.id)).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows.slice(0, SHOWN);
  return [...rows.filter(r => matches(r, words)), ...archived.filter(r => matches(r, words))].slice(0, SHOWN);
}

export function Spotlight({ ix, onClose }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const list = useRef(null);
  const [archived, setArchived] = useState([]);
  const found = useMemo(() => (ix ? hits(ix, archived, query) : []), [ix, archived, query]);

  useEffect(() => {
    let live = true;
    api('api/archived').then(d => { if (live) setArchived(d.archived || []); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const pick = Math.min(active, Math.max(found.length - 1, 0));

  useLayoutEffect(() => { input.current.focus(); }, []);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [pick, found]);

  const open = r => { onClose(); location.hash = `#/s/${encodeURIComponent(r.id)}`; };

  // Esc stops here, so it closes the spotlight without also stopping a chat that is running behind it.
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(pick + 1, found.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(pick - 1, 0)); }
    else if (e.key === 'Enter' && !e.isComposing && found[pick]) { e.preventDefault(); open(found[pick]); }
  };

  return html`<div class="spotlight-backdrop" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="spotlight" role="dialog" aria-modal="true" aria-label="Find a session">
      <input class="spotlight-input" ref=${input} type="search" placeholder='Find a session, or type "archived"' autocomplete="off" spellcheck=${false}
        aria-label="Find a session" aria-controls="spotlightResults" value=${query}
        onInput=${e => { setQuery(e.target.value); setActive(0); }} onKeyDown=${onKeyDown} />
      ${found.length
        ? html`<ul class="spotlight-results" id="spotlightResults" role="listbox" ref=${list}>
            ${found.map((r, i) => {
              const meta = [folderName(r.cwd, HOME), r.branch, r.archived ? 'archived' : STATE_LABEL[r.state]].filter(Boolean).join('  ');
              return html`<li key=${r.id} role="option" aria-selected=${i === pick}>
                <a class="row" href=${`#/s/${encodeURIComponent(r.id)}`} aria-selected=${i === pick} onMouseMove=${() => i !== pick && setActive(i)}
                  onClick=${e => { e.preventDefault(); open(r); }}>
                  <span class="lamp" data-state=${r.state} aria-hidden="true"></span>
                  <span class="row-title">${r.title || 'Untitled session'}</span>
                  <time class="row-time">${when(r.archived ? r.archivedAt : r.lastActivityAt)}</time>
                  ${meta ? html`<span class="row-meta">${meta}</span>` : null}
                </a></li>`;
            })}</ul>`
        : html`<p class="quiet pad">${ix ? 'No sessions match.' : 'Loading sessions'}</p>`}
    </div>
  </div>`;
}
