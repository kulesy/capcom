// A small Markdown renderer for Claude's replies. Everything is escaped first, so a reply can never
// inject markup; only http and https links survive.

const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Code spans and links are set aside before emphasis runs, so an underscore in a URL stays a URL.
function inline(src) {
  const kept = [];
  const keep = html => `\u0000${kept.push(html) - 1}\u0000`;
  const link = (text, url) => keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`);
  const s = esc(src
    .replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => link(t, u))
    .replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (_, t, u) => keep(`<code title="${esc(u)}">${esc(t)}</code>`))
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (_, pre, u) => pre + link(u, u)))
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[i]);
}

const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

const ITEM = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/;

function list(lines, i) {
  const first = lines[i].match(ITEM);
  const indent = first[1].length;
  const ordered = !!first[3];
  // An item of this list at this depth, or one nested under it. A bullet after a number starts a new list.
  const belongs = m => m && (m[1].length > indent || (m[1].length === indent && !!m[3] === ordered));
  const items = [];
  while (i < lines.length) {
    const l = lines[i];
    // Blank lines between items keep the list going, so "1." then a gap then "2." stays one list.
    if (!l.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && belongs(lines[j].match(ITEM))) { i = j; continue; }
      break;
    }
    const m = l.match(ITEM);
    if (m && m[1].length === indent && !!m[3] === ordered) { items.push([m[4]]); i++; continue; }
    if (m && m[1].length > indent) { const sub = list(lines, i); items[items.length - 1].push(sub.html); i = sub.i; continue; }
    if (!m && /^\s+/.test(l) && items.length) { items[items.length - 1][0] += ' ' + l.trim(); i++; continue; }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const start = ordered && Number(first[3]) !== 1 ? ` start="${Number(first[3])}"` : '';
  return { html: `<${tag}${start}>${items.map(([t, ...rest]) => `<li>${inline(t)}${rest.join('')}</li>`).join('')}</${tag}>`, i };
}

export function md(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    const fence = l.match(/^\s*(```+|~~~+)\s*([\w+-]*)/);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre class="code"${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); out.push(`<h${Math.min(h[1].length + 2, 6)}>${inline(h[2])}</h${Math.min(h[1].length + 2, 6)}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) { flush(); const r = list(lines, i); out.push(r.html); i = r.i; continue; }
    if (/^\s*>/.test(l)) {
      flush();
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${md(body.join('\n'))}</blockquote>`);
      continue;
    }
    if (isTableRow(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l);
    i++;
  }
  flush();
  return out.join('');
}

export { esc };
