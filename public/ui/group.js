// A group's own session: the normal chat with the status of the group's sessions above its transcript. The status is drawn from the
// list the page already loads, so it costs no tokens, and the archived part is read from the server only when that part is opened.
import { api } from './api.js';
import { Back, ChatPane } from './chat.js';
import { HOME } from './env.js';
import { DOT_LABEL, folderName, STATE_LABEL, when } from './format.js';
import { bucketsOf, flipped, groupById, membersOf, paneOf, summaryOf } from './group-rules.js';
import { useDocumentTitle, useLocal, useStore } from './hooks.js';
import { html, useEffect, useLayoutEffect, useMemo, useState } from './html.js';
import { draw, icons } from './menu.js';
import { UNTITLED } from './order.js';
import { createStore } from './store.js';

const enc = encodeURIComponent;

// The archived sessions drawn before Show more, since a group can hold hundreds.
const ARCHIVED_SHOWN = 100;

const chevron = () => draw(['m9 18 6-6-6-6'], 'chevron');

// A session of the group, as a sidebar row shows it: its mark, title, folder and branch, state and when it last ran. An archived
// session is listed with its state from when it was archived, which says nothing now.
function Member({ r }) {
  const label = r.archived ? '' : DOT_LABEL[r.dot] ?? STATE_LABEL[r.state];
  const where = [folderName(r.cwd, HOME), r.branch, label].filter(Boolean).join(' · ');
  return html`<li><a class="status-row" href=${`#/s/${enc(r.id)}`}>
    <span class="status-dot">${r.dot ? html`<span class="row-dot" data-dot=${r.dot} aria-hidden="true">${r.dot === 'error' ? draw(icons.triangleAlert) : null}</span>` : null}</span>
    <span class="status-title">${r.title || UNTITLED}</span>
    ${where ? html`<span class="status-meta">${where}</span>` : null}
    <time class="status-time">${when(r.lastActivityAt)}</time></a></li>`;
}

function Part({ label, rows, count = rows.length, children }) {
  return html`<section class="status-part">
    <h3 class="status-heading">${label} <span class="badge count">${count}</span></h3>
    <ul class="status-rows">${rows.map(r => html`<${Member} key=${r.id} r=${r} />`)}</ul>${children}
  </section>`;
}

// Mounted only while the part is open. It reads the group's archived sessions then, and again when the group's count of them changes.
function Archived({ group }) {
  const [got, setGot] = useState({ rows: null, error: '' });
  const [limit, setLimit] = useState(ARCHIVED_SHOWN);
  useEffect(() => {
    let stale = false;
    api(`api/archived?group=${enc(group.id)}`).then(
      reply => { if (!stale) setGot({ rows: reply.archived, error: '' }); },
      e => { if (!stale) setGot(was => ({ ...was, error: e.message })); },
    );
    return () => { stale = true; };
  }, [group.id, group.archived]);
  const failed = got.error ? html`<p class="status-note" role="alert">Could not load the archived sessions: ${got.error}</p>` : null;
  if (!got.rows) return failed ?? html`<p class="status-note" role="status">Loading the archived sessions</p>`;
  if (!got.rows.length) return failed;
  const more = got.rows.length - limit;
  return html`<${Part} label="Archived" rows=${got.rows.slice(0, limit)} count=${got.rows.length}>
    ${more > 0 ? html`<button class="btn status-more" data-variant="ghost" data-size="sm" type="button" onClick=${() => setLimit(n => n + ARCHIVED_SHOWN)}>Show ${Math.min(more, ARCHIVED_SHOWN)} more</button>` : null}${failed}
  <//>`;
}

function Rest({ group, idle, open, onFlip }) {
  const body = `status-more-${group.id}`;
  return html`<section class="status-part">
    <button class="status-fold status-rest" type="button" aria-expanded=${open} aria-controls=${open ? body : null} onClick=${onFlip}>
      <span>Idle and archived</span><span class="badge count">${idle.length + group.archived}</span>${chevron()}
    </button>
    ${open ? html`<div id=${body}>
      ${idle.length ? html`<${Part} label="Idle" rows=${idle} />` : null}
      ${group.archived ? html`<${Archived} group=${group} />` : null}
    </div>` : null}
  </section>`;
}

const LIVE = [['needs', 'Needs you'], ['working', 'Working'], ['recent', 'Recent activity']];

// The summary line folds the panel. Both folds are kept for each group in this browser.
function GroupStatus({ feed }) {
  const group = useStore(feed, s => s.group);
  const [shut, setShut] = useLocal('groupShut', {});
  const [opened, setOpened] = useLocal('groupMore', {});
  if (!group) return null;
  const buckets = bucketsOf(membersOf(group));
  const open = !shut[group.id];
  const body = `status-${group.id}`;
  const empty = !membersOf(group).length && !group.archived;
  return html`<section class="group-status" aria-label=${`Sessions in ${group.name}`}>
    <button class="status-fold status-sum" type="button" aria-expanded=${open} aria-controls=${open ? body : null} onClick=${() => setShut(all => flipped(all, group.id))}>
      <span>${summaryOf(buckets, group.archived)}</span>${chevron()}
    </button>
    ${open ? html`<div class="status-body" id=${body}>
      ${LIVE.map(([key, label]) => (buckets[key].length ? html`<${Part} key=${key} label=${label} rows=${buckets[key]} />` : null))}
      ${buckets.idle.length || group.archived ? html`<${Rest} group=${group} idle=${buckets.idle} open=${!!opened[group.id]} onFlip=${() => setOpened(all => flipped(all, group.id))} />` : null}
      ${empty ? html`<p class="status-note">No sessions in this group yet. Move one in from its menu, or ask here to start one.</p>` : null}
    </div>` : null}
  </section>`;
}

// A pane with no chat in it: a way back to the list, and why.
function Stub({ title, children, action }) {
  useDocumentTitle('Group session · GhostShell');
  return html`<section class="session" id="session">
    <header class="chat-head"><${Back} /><div class="chat-title"><h2>Group session</h2></div></header>
    <div data-slot="empty">
      <div data-slot="empty-header">
        <div data-slot="empty-icon" data-variant="icon">${draw(icons.messageSquare)}</div>
        <div data-slot="empty-title">${title}</div>
        <div data-slot="empty-description">${children}</div>
      </div>
      ${action ? html`<div data-slot="empty-content">${action}</div>` : null}
    </div>
  </section>`;
}

// The chat of the group `id`. A group not yet opened is given its session first, which starts no process and costs no tokens, then the
// list brings the id and the chat opens. `ix` is the page's list, so a server that cannot run group sessions is told from it.
export function GroupPane({ id, ix, refreshIndex }) {
  const state = paneOf(ix, id);
  const group = groupById(ix, id);
  const [booked, setBooked] = useState(null);
  const [problem, setProblem] = useState('');
  const [attempt, setAttempt] = useState(0);
  const feed = useMemo(() => createStore({ group: null }), []);
  const panel = useMemo(() => html`<${GroupStatus} feed=${feed} />`, [feed]);
  const session = group?.session?.id ?? booked;
  const booking = state === 'ready' && !group.session;

  useLayoutEffect(() => { feed.set({ group }); }, [feed, group]);

  useEffect(() => {
    if (!booking) return undefined;
    let stale = false;
    setProblem('');
    api(`api/groups/${enc(id)}/session`, {}).then(
      made => { if (!stale) { setBooked(made.id); refreshIndex(); } },
      e => { if (!stale) setProblem(e.message); },
    );
    return () => { stale = true; };
  }, [id, booking, attempt]);

  if (state === 'unloaded') return html`<${Stub} title="Sessions did not load">GhostShell could not be reached. This opens when the list does.<//>`;
  if (state === 'unsupported') return html`<${Stub} title="Restart GhostShell to talk to a group">This GhostShell started before groups had sessions of their own. Restart it to open one.<//>`;
  if (state === 'missing') return html`<${Stub} title="Group not found">It may have been deleted. Pick another from the list.<//>`;
  if (!session) {
    return html`<${Stub} title=${problem ? 'Could not open the session' : 'Opening the session'}
      action=${problem ? html`<button class="btn" data-variant="outline" type="button" onClick=${() => setAttempt(n => n + 1)}>Try again</button>` : null}>${problem || `Getting ${group.name} ready.`}<//>`;
  }
  return html`<${ChatPane} key=${session} id=${session} row=${{ title: group.name, cwd: '', branch: '' }} title=${group.name} refreshIndex=${refreshIndex} meta="Group session" aside=${panel} />`;
}
