// A file attached to a message: a square showing its extension, the name on one line, and the kind and size under it.
import { glyph, metaLine } from './files.js';
import { html } from './html.js';

export const FileFace = ({ file }) => html`<span class="file-glyph" aria-hidden="true">${glyph(file.name)}</span>
  <span class="file-card-text"><span class="file-card-name">${file.name}</span><span class="file-card-meta">${metaLine(file)}</span></span>`;

// The card in a transcript, where the path the file was read from is its tooltip.
export const FileCard = ({ file }) => html`<div class="file-card" title=${file.path}><${FileFace} file=${file} /></div>`;
