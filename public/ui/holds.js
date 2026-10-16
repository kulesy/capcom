// Messages from other sessions that the CLI holds for approval. The CLI gives a host no way to approve one, so a card says
// who sent it and why it is held. A hold that ends without the message arriving stays until the owner dismisses it.
import { holdCause, holdEnd, plural } from './format.js';
import { useStore } from './hooks.js';
import { html } from './html.js';

const SHOWN = 3;

function HeldCard({ h }) {
  return html`<article class="hold" data-id=${h.id}>
    <span class="lamp" data-state="waiting" aria-hidden="true"></span>
    <div>
      <h3>Message from ${h.from || 'another session'} is held</h3>
      <p>${holdCause(h.cause)}</p>
      <p class="quiet">Claude has not seen it. The CLI gives Capcom no way to approve it.</p>
    </div></article>`;
}

function EndedCard({ d, onDismiss }) {
  return html`<article class="hold" data-id=${d.id}>
    <span class="lamp" aria-hidden="true"></span>
    <div>
      <h3>Message from ${d.from || 'another session'} was not delivered</h3>
      <p>${holdEnd(d.outcome)}</p>
      <button class="link" type="button" onClick=${() => onDismiss(d.id)}>Dismiss</button>
    </div></article>`;
}

export function Holds({ ctrl }) {
  const held = useStore(ctrl.store, s => s.status?.holds) || [];
  const ended = useStore(ctrl.store, s => s.holdsEnded);
  return html`<div class="holds" role="status">
    ${held.length > SHOWN ? html`<p class="quiet hold-more">${plural(held.length - SHOWN, 'earlier held message')}</p>` : null}
    ${held.slice(-SHOWN).map(h => html`<${HeldCard} key=${h.id} h=${h} />`)}
    ${ended.map(d => html`<${EndedCard} key=${d.id} d=${d} onDismiss=${ctrl.dismissHold} />`)}
  </div>`;
}
