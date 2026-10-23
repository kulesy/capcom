// A command's output as the page draws it: the colours its escape sequences ask for, the error stream tinted, and what the owner typed
// to it in the page's own colour. Lines are text with a newline between, so a copy of the selection reads as the terminal did.
import { renderAnsi } from './ansi.js';
import { html, useMemo } from './html.js';

const classOf = piece => [piece.stream === 'err' ? 'out-err' : piece.stream === 'in' ? 'out-in' : '', piece.cls].filter(Boolean).join(' ') || undefined;

export function Output({ chunks, maxLines, ...props }) {
  const { lines, cut } = useMemo(() => renderAnsi(chunks, { maxLines }), [chunks, maxLines]);
  const body = cut > 0 ? [html`<span class="out-cut">${cut} earlier ${cut === 1 ? 'line is' : 'lines are'} not shown${'\n'}</span>`] : [];
  lines.forEach((line, n) => {
    for (const piece of line) body.push(html`<span class=${classOf(piece)} style=${piece.css || undefined}>${piece.text}</span>`);
    if (n < lines.length - 1) body.push('\n');
  });
  return html`<pre ...${props}>${body}</pre>`;
}
