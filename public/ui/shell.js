// The Ghost look's shell: four two-tone plates turned round one eye, in a 24-unit box. ghost.css colours it and hides it in the standard look.
import { html } from './html.js';

const TURNS = [0, 90, 180, 270];

export const Shell = ({ class: name }) => html`<svg class=${name ? `shell ${name}` : 'shell'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <g class="shell-turn">${TURNS.map(turn => html`<g key=${turn} transform=${`rotate(${turn} 12 12)`}><g class="shell-plate">
    <path class="shell-lit" d="M8.75,8.33L5.51,4.66L16.38,1.15L12.85,7.17Z" />
    <path class="shell-shade" d="M12.85,7.17L16.38,1.15L16.64,6.76L15.25,8.33Z" />
  </g></g>`)}</g>
  <circle class="shell-socket" cx="12" cy="12" r="4.3" />
  <circle class="shell-glow" cx="12" cy="12" r="3.8" />
  <circle class="shell-eye" cx="12" cy="12" r="2.5" />
</svg>`;
