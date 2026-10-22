// The Ghost look's shell: four thin plates round one eye, mirrored left to right and top to bottom, in a 24-unit box. ghost.css colours it and hides it in the standard look.
import { html } from './html.js';

// Each plate is drawn pointing up and turned into place, so ghost.css opens the shell by moving every plate up.
const TALL = 'M7.57,5.87L12,1L16.43,5.87L15.01,7.29L12,3.97L8.99,7.29Z';
const WIDE = 'M7.65,5.95L12,2L16.35,5.95L14.93,7.37L12,4.7L9.07,7.37Z';
const PLATES = [[0, TALL], [90, WIDE], [180, TALL], [270, WIDE]];

export const Shell = ({ class: name }) => html`<svg class=${name ? `shell ${name}` : 'shell'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <g class="shell-turn">${PLATES.map(([turn, d]) => html`<g key=${turn} transform=${`rotate(${turn} 12 12)`}><path class="shell-plate" d=${d} /></g>`)}</g>
  <circle class="shell-eye" cx="12" cy="12" r="2.5" />
</svg>`;
