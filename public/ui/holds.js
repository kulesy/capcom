// Messages from other sessions that the CLI holds for approval. The CLI gives a host no way to approve one, so a card says
// who sent it and why it is held. A hold that ends without the message arriving stays until the owner dismisses it.
import { groupHolds, holdCause, holdEnd, plural } from './format.js';
import { useStore } from './hooks.js';
import { html } from './html.js';

const SHOWN = 3;

const lead = (n, from) => (n === 1 ? 'Message' : `${n} messages`) + ` from ${from || 'another session'}`;

function HeldCard({ g }) {
  const n = g.ids.length;
  return html`<article class="hold">
    <span class="lamp" data-state="waiting" aria-hidden="true"></span>
    <div>
      <h3>${lead(n, g.from)} ${n === 1 ? 'is' : 'are'} held</h3>
      <p>${holdCause(g.why)}</p>
      <p class="quiet">Claude has seen none of it. The CLI gives Capcom no way to approve a held message.</p>
    </div></article>`;
}

function EndedCard({ g, onDismiss }) {
  const n = g.ids.length;
  return html`<article class="hold">
    <span class="lamp" aria-hidden="true"></span>
    <div>
      <h3>${lead(n, g.from)} ${n === 1 ? 'was' : 'were'} not delivered</h3>
      <p>${holdEnd(g.why)}</p>
      <button class="link" type="button" onClick=${() => onDismiss(g.ids)}>Dismiss</button>
    </div></article>`;
}

const More = ({ n, what }) => (n ? html`<p class="quiet hold-more">${plural(n, what)}</p>` : null);

export function Holds({ ctrl }) {
  const held = groupHolds(useStore(ctrl.store, s => s.status?.holds) || [], h => h.cause, SHOWN);
  const ended = groupHolds(useStore(ctrl.store, s => s.holdsEnded), d => d.outcome, SHOWN);
  return html`<div class="holds" role="status">
    <${More} n=${held.hidden} what="earlier held message" />
    ${held.groups.map(g => html`<${HeldCard} key=${g.key} g=${g} />`)}
    <${More} n=${ended.hidden} what="earlier undelivered message" />
    ${ended.groups.map(g => html`<${EndedCard} key=${g.key} g=${g} onDismiss=${ctrl.dismissHold} />`)}
  </div>`;
}
