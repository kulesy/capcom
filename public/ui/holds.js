// Messages from other sessions that the CLI holds for approval. The CLI gives a host no way to approve one, so a card says
// who sent it and why it is held. A hold that ends without the message arriving stays until the owner dismisses it.
import { groupHolds, holdCause, holdEnd, plural } from './format.js';
import { useStore } from './hooks.js';
import { html, useLayoutEffect, useRef } from './html.js';

const SHOWN = 3;

const lead = (n, from) => (n === 1 ? 'Message' : `${n} messages`) + ` from ${from || 'another session'}`;

function HeldCard({ g }) {
  const n = g.ids.length;
  return html`<article class="hold">
    <span class="lamp" data-state="waiting" aria-hidden="true"></span>
    <div>
      <h3>${lead(n, g.from)} ${n === 1 ? 'is' : 'are'} held</h3>
      <p>${holdCause(g.why)}</p>
    </div></article>`;
}

function EndedCard({ g, onDismiss }) {
  const n = g.ids.length;
  return html`<article class="hold">
    <span class="lamp" aria-hidden="true"></span>
    <div>
      <h3>${lead(n, g.from)} ${n === 1 ? 'was' : 'were'} not delivered</h3>
      <p>${holdEnd(g.why)}</p>
      <button class="btn" data-variant="ghost" data-size="xs" type="button" onClick=${() => onDismiss(g.ids)}>Dismiss</button>
    </div></article>`;
}

const More = ({ n, what }) => (n ? html`<p class="quiet hold-more">${plural(n, what)}</p>` : null);

export function Holds({ ctrl }) {
  const holds = useStore(ctrl.store, s => s.status?.holds);
  const endedHolds = useStore(ctrl.store, s => s.holdsEnded);
  const held = groupHolds(holds || [], h => h.cause, SHOWN);
  const ended = groupHolds(endedHolds, d => d.outcome, SHOWN);
  // The box is capped in height, so the newest card is at its foot and would be cut off on a phone.
  const box = useRef(null);
  useLayoutEffect(() => { box.current.scrollTop = box.current.scrollHeight; }, [holds, endedHolds]);
  return html`<div class="holds" role="status" ref=${box}>
    <${More} n=${held.hidden} what="earlier held message" />
    ${held.groups.map(g => html`<${HeldCard} key=${g.key} g=${g} />`)}
    ${held.groups.length ? html`<p class="quiet hold-more">Claude has seen none of it. The CLI gives Capcom no way to approve a held message.</p>` : null}
    <${More} n=${ended.hidden} what="earlier undelivered message" />
    ${ended.groups.map(g => html`<${EndedCard} key=${g.key} g=${g} onDismiss=${ctrl.dismissHold} />`)}
  </div>`;
}
