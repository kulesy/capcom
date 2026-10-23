// The Ghost look's shell: four plates round one eye, mirrored left to right and top to bottom, in a 24-unit box. ghost.css colours it and hides it in the standard look.
import { html } from './html.js';

// Each plate is drawn pointing up and turned into place, so ghost.css opens the shell by moving every plate up.
const TALL = 'M8.95,8.17L12,6.91L15.05,8.17L17.48,5.75L12,0.5L6.52,5.75Z';
const WIDE = 'M8.95,8.17L12,6.91L15.05,8.17L17.49,5.73L12,0L6.51,5.73Z';
const PLATES = [[0, TALL], [90, WIDE], [180, TALL], [270, WIDE]];

export const Shell = ({ class: name }) => html`<svg class=${name ? `shell ${name}` : 'shell'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <g class="shell-turn">${PLATES.map(([turn, d]) => html`<g key=${turn} transform=${`rotate(${turn} 12 12)`}><path class="shell-plate" d=${d} /></g>`)}</g>
  <circle class="shell-socket" cx="12" cy="12" r="4.3" />
  <circle class="shell-glow" cx="12" cy="12" r="3.8" />
  <circle class="shell-eye" cx="12" cy="12" r="2.5" />
</svg>`;
