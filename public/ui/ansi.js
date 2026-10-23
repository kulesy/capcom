// Draws a command's output as lines of coloured pieces, with no page in it so node can test it. Colours come from SGR sequences,
// \r goes back to the start of the line and writes over it, and every other escape sequence is dropped.

const CSI = /\x1b\[([0-?]*)([ -/]*)([@-~])/y;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/y;
// An escape sequence that has begun and not ended, which the next piece of the same stream finishes.
const UNFINISHED = /^\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*\x1b?)?$/;
const CONTROL = /[\x00-\x1f\x7f]/g;

const PLAIN = Object.freeze({ fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false, strike: false });

// The xterm colour for 16 to 255 as [r, g, b].
function xterm(n) {
  if (n >= 232) { const v = 8 + 10 * (n - 232); return [v, v, v]; }
  const i = n - 16;
  const level = v => (v === 0 ? 0 : 55 + 40 * v);
  return [level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6)];
}

const channel = v => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

// The surfaces the output is drawn on: the lightest the block's background gets in the light look and the darkest in the dark one.
const SURFACE = { light: 0.79, dark: 0.02 };

// A colour moved towards black (on light) or white (on dark) until its text keeps 4.5:1 on the surface, and left as it is when it already does.
export function readable([r, g, b], scheme) {
  const target = scheme === 'dark' ? 255 : 0;
  const surface = SURFACE[scheme];
  const ratio = rgb => {
    const l = luminance(rgb);
    return scheme === 'dark' ? (l + 0.05) / (surface + 0.05) : (surface + 0.05) / (l + 0.05);
  };
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const mixed = [r, g, b].map(v => Math.round(v + (target - v) * t));
    if (ratio(mixed) >= 4.5) return mixed;
  }
  return [target, target, target];
}

// The colour of an rgb value as the stylesheet takes it: one colour for each look, each readable on that look's background.
const rgbCss = rgb => `light-dark(rgb(${readable(rgb, 'light').join(' ')}), rgb(${readable(rgb, 'dark').join(' ')}))`;

// A background is a tint of its colour, so the text over it stays readable whatever colour it is.
const tintCss = ([r, g, b]) => `color-mix(in srgb, rgb(${r} ${g} ${b}) 30%, transparent)`;

// The next colour in an SGR parameter list, from `i` just after a 38 or 48: [color, how many parameters it used], or null.
function extended(params, i) {
  if (params[i] === 5 && Number.isInteger(params[i + 1]) && params[i + 1] >= 0 && params[i + 1] <= 255) {
    const n = params[i + 1];
    return [n < 16 ? n : xterm(n), 2];
  }
  if (params[i] === 2) {
    const rgb = params.slice(i + 1, i + 4);
    if (rgb.length === 3 && rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) return [rgb, 4];
  }
  return null;
}

function applySgr(style, text) {
  const params = text === '' ? [0] : text.replace(/:/g, ';').split(';').map(p => (p === '' ? 0 : Number(p)));
  const s = { ...style };
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) Object.assign(s, PLAIN);
    else if (p === 1) s.bold = true;
    else if (p === 2) s.dim = true;
    else if (p === 3) s.italic = true;
    else if (p === 4 || p === 21) s.underline = true;
    else if (p === 7) s.inverse = true;
    else if (p === 9) s.strike = true;
    else if (p === 22) { s.bold = false; s.dim = false; }
    else if (p === 23) s.italic = false;
    else if (p === 24) s.underline = false;
    else if (p === 27) s.inverse = false;
    else if (p === 29) s.strike = false;
    else if (p >= 30 && p <= 37) s.fg = p - 30;
    else if (p >= 90 && p <= 97) s.fg = p - 90 + 8;
    else if (p >= 40 && p <= 47) s.bg = p - 40;
    else if (p >= 100 && p <= 107) s.bg = p - 100 + 8;
    else if (p === 39) s.fg = null;
    else if (p === 49) s.bg = null;
    else if (p === 38 || p === 48) {
      const got = extended(params, i + 1);
      if (!got) break;
      s[p === 38 ? 'fg' : 'bg'] = got[0];
      i += got[1];
    }
  }
  return s;
}

// The class names and inline style that draw a style. A palette colour is a class, so the stylesheet picks it for each look, and an
// extended colour is a style that holds a readable colour for each.
function look(style) {
  let { fg, bg } = style;
  if (style.inverse) [fg, bg] = [bg, fg];
  const classes = [];
  const css = [];
  if (fg === null && style.inverse) classes.push('ansi-inverse-fg');
  else if (typeof fg === 'number') classes.push(`ansi-fg-${fg}`);
  else if (fg) css.push(`color:${rgbCss(fg)}`);
  if (bg === null && style.inverse) classes.push('ansi-inverse-bg');
  else if (typeof bg === 'number') classes.push(`ansi-bg-${bg}`);
  else if (bg) css.push(`background-color:${tintCss(bg)}`);
  if (style.bold) classes.push('ansi-bold');
  if (style.dim && fg === null) classes.push('ansi-dim');
  if (style.italic) classes.push('ansi-italic');
  if (style.underline || style.strike) classes.push(style.underline && style.strike ? 'ansi-underline ansi-strike' : style.underline ? 'ansi-underline' : 'ansi-strike');
  return { cls: classes.join(' '), css: css.join(';') };
}

const sameLook = (a, b) => a.stream === b.stream && a.cls === b.cls && a.css === b.css;

// The pieces of `runs` before column `at`, or from it on.
function before(runs, at) {
  const out = [];
  let col = 0;
  for (const run of runs) {
    if (col >= at) break;
    out.push(col + run.text.length > at ? { ...run, text: run.text.slice(0, at - col) } : run);
    col += run.text.length;
  }
  return out;
}

function after(runs, at) {
  const out = [];
  let col = 0;
  for (const run of runs) {
    if (col + run.text.length > at) out.push(col >= at ? run : { ...run, text: run.text.slice(at - col) });
    col += run.text.length;
  }
  return out;
}

function join(runs) {
  const out = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out.at(-1);
    if (last && sameLook(last, run)) out[out.length - 1] = { ...last, text: last.text + run.text };
    else out.push(run);
  }
  return out;
}

const width = runs => runs.reduce((n, r) => n + r.text.length, 0);

// A line holds at most this many pieces, so a line that changes colour at every character stays small. Past it, text joins the last piece
// and takes its look.
export const MAX_PIECES = 256;

// `run` added to the end of a line, joined to the last piece when it looks the same or the line is full.
function append(line, run) {
  const last = line.runs.at(-1);
  if (last && (line.runs.length >= MAX_PIECES || sameLook(last, run))) line.runs[line.runs.length - 1] = { ...last, text: last.text + run.text };
  else line.runs.push(run);
  line.width += run.text.length;
}

// `runs` with every piece from the last allowed one on joined into it.
function limit(runs) {
  if (runs.length <= MAX_PIECES) return runs;
  const [first, ...rest] = runs.slice(MAX_PIECES - 1);
  return [...runs.slice(0, MAX_PIECES - 1), { ...first, text: first.text + rest.map(r => r.text).join('') }];
}

// `text` written at column `col` of a line, over what is there.
function write(line, col, run) {
  if (col >= line.width) {
    if (col > line.width) append(line, { stream: run.stream, cls: '', css: '', text: ' '.repeat(col - line.width) });
    append(line, run);
    return;
  }
  line.runs = limit(join([...before(line.runs, col), run, ...after(line.runs, col + run.text.length)]));
  line.width = width(line.runs);
}

// Lines of pieces for output chunks ({ stream, text }, in the order they came). A piece is { stream, cls, css, text }, with `cls` and `css`
// drawing its colours and weight. Only the last `maxLines` lines are returned, with `cut` the number before them. Chunks of the page's own
// echo (stream 'in') are drawn as they came.
export function renderAnsi(chunks, { maxLines = 2000 } = {}) {
  const lines = [{ runs: [], width: 0 }];
  let line = lines[0];
  let col = 0;
  const styles = {};
  const waiting = {};
  for (const chunk of chunks) {
    const { stream } = chunk;
    let style = styles[stream] || PLAIN;
    let drawn = look(style);
    const text = (waiting[stream] || '') + chunk.text;
    waiting[stream] = '';
    let i = 0;
    while (i < text.length) {
      CONTROL.lastIndex = i;
      const next = CONTROL.exec(text);
      const end = next ? next.index : text.length;
      if (end > i) {
        write(line, col, { stream, ...drawn, text: text.slice(i, end) });
        col += end - i;
        i = end;
        continue;
      }
      const c = text[i];
      if (c === '\n') { lines.push({ runs: [], width: 0 }); line = lines.at(-1); col = 0; i++; continue; }
      if (c === '\r') { col = 0; i++; continue; }
      if (c === '\b') { col = Math.max(0, col - 1); i++; continue; }
      if (c === '\t') {
        const stop = col + (8 - (col % 8));
        write(line, col, { stream, ...drawn, text: ' '.repeat(stop - col) });
        col = stop;
        i++;
        continue;
      }
      if (c === '\x1b') {
        CSI.lastIndex = i;
        const csi = CSI.exec(text);
        if (csi) {
          i = CSI.lastIndex;
          if (csi[3] === 'm' && csi[2] === '') { style = applySgr(style, csi[1]); drawn = look(style); }
          else if (csi[3] === 'K' && csi[2] === '') {
            const mode = csi[1] === '' ? 0 : Number(csi[1]);
            if (mode === 0) { line.runs = before(line.runs, col); line.width = width(line.runs); }
            else if (mode === 2) { line.runs = []; line.width = 0; }
          }
          continue;
        }
        OSC.lastIndex = i;
        if (OSC.exec(text)) { i = OSC.lastIndex; continue; }
        if (UNFINISHED.test(text.slice(i))) { waiting[stream] = text.slice(i); break; }
        i += '()*+'.includes(text[i + 1]) ? 3 : 2;
        continue;
      }
      i++;
    }
    styles[stream] = style;
  }
  if (lines.length > 1 && !lines.at(-1).runs.length) lines.pop();
  const cut = Math.max(0, lines.length - maxLines);
  return { lines: lines.slice(cut).map(l => l.runs), cut };
}

// The words of output with its colours and cursor moves taken out, for a copy.
export const plainOf = chunks => renderAnsi(chunks, { maxLines: Infinity }).lines.map(runs => runs.map(r => r.text).join('')).join('\n');
