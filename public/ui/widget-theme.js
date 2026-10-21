// What a widget's frame is given to draw with: the colour and type variables, the plain looks for controls, the SVG classes and the colour
// ramps. Plain strings and functions, so they run without a browser. widget-frame.js puts them in each frame's document.

export const CARD_CLASS = 'capcom-card';

// ---- the host's tokens ----------------------------------------------------------------------------------------------------
//
// One object holds every value. `common` is the same in both modes. `light` goes on :root, and `dark` is written twice from the
// same object, under [data-mode="dark"] and, for a frame that has no data-mode, under the colour-scheme media query.

const ok = (l, c, h, alpha) => `oklch(${l} ${c} ${h}${alpha === undefined ? '' : ` / ${alpha}`})`;

// A role is a hue and, in each mode, [lightness, chroma] for its wash, its text, its edge, its solid fill, that fill under the
// pointer, and the text that sits on the fill. Chroma is what sRGB can show at that lightness, so every browser draws the same colour.
const ROLE_HUE = { accent: 0, danger: 27, success: 150, warning: 78, pro: 290, brand: 40 };
const ROLE = {
  light: {
    accent: { bg: [0.97, 0], text: [0.205, 0], border: [0.922, 0], fill: [0.205, 0], hover: [0.269, 0], on: [0.985, 0] },
    danger: { bg: [0.94, 0.03], text: [0.44, 0.15], border: [0.8, 0.08], fill: [0.55, 0.17], hover: [0.49, 0.17], on: [0.99, 0.004] },
    success: { bg: [0.94, 0.03], text: [0.42, 0.11], border: [0.8, 0.08], fill: [0.52, 0.13], hover: [0.46, 0.126], on: [0.99, 0.004] },
    warning: { bg: [0.94, 0.03], text: [0.42, 0.087], border: [0.8, 0.08], fill: [0.82, 0.15], hover: [0.77, 0.15], on: [0.3, 0.06] },
    pro: { bg: [0.94, 0.03], text: [0.44, 0.15], border: [0.8, 0.08], fill: [0.55, 0.17], hover: [0.49, 0.17], on: [0.99, 0.004] },
    brand: { fill: [0.57, 0.13], hover: [0.51, 0.13], on: [0.99, 0.004] },
  },
  dark: {
    accent: { bg: [0.269, 0], text: [0.985, 0], border: [0.371, 0], fill: [0.922, 0], hover: [0.87, 0], on: [0.205, 0] },
    danger: { bg: [0.31, 0.06], text: [0.82, 0.101], border: [0.5, 0.1], fill: [0.72, 0.15], hover: [0.77, 0.135], on: [0.2, 0.03] },
    success: { bg: [0.31, 0.06], text: [0.82, 0.12], border: [0.5, 0.1], fill: [0.72, 0.15], hover: [0.77, 0.14], on: [0.2, 0.03] },
    warning: { bg: [0.31, 0.06], text: [0.82, 0.12], border: [0.5, 0.1], fill: [0.82, 0.15], hover: [0.86, 0.127], on: [0.25, 0.05] },
    pro: { bg: [0.31, 0.06], text: [0.82, 0.096], border: [0.5, 0.1], fill: [0.72, 0.15], hover: [0.77, 0.126], on: [0.2, 0.03] },
    brand: { fill: [0.7, 0.13], hover: [0.75, 0.12], on: [0.22, 0.03] },
  },
};

// The eight palette tints, each as [lightness, chroma] for a pale background and for the text on it.
const TINT_HUE = { red: 25, orange: 55, yellow: 95, green: 145, aqua: 195, blue: 250, violet: 295, magenta: 345 };
const TINT = {
  light: {
    red: [[0.94, 0.03], [0.42, 0.12]], orange: [[0.94, 0.035], [0.42, 0.104]], yellow: [[0.94, 0.045], [0.42, 0.086]], green: [[0.94, 0.045], [0.42, 0.12]],
    aqua: [[0.94, 0.045], [0.42, 0.071]], blue: [[0.94, 0.029], [0.42, 0.119]], violet: [[0.94, 0.031], [0.42, 0.12]], magenta: [[0.94, 0.037], [0.42, 0.12]],
  },
  dark: {
    red: [[0.33, 0.07], [0.84, 0.087]], orange: [[0.33, 0.07], [0.84, 0.1]], yellow: [[0.33, 0.068], [0.84, 0.1]], green: [[0.33, 0.07], [0.84, 0.1]],
    aqua: [[0.33, 0.056], [0.84, 0.1]], blue: [[0.33, 0.07], [0.84, 0.082]], violet: [[0.33, 0.07], [0.84, 0.088]], magenta: [[0.33, 0.07], [0.84, 0.1]],
  },
};

// The nine ramps behind the c-* classes. Each stop is [lightness, chroma]. A mode picks four of them: the box's fill and its edge,
// the title and the subtitle.
const STOP = { 50: [0.965, 0.025], 100: [0.92, 0.05], 200: [0.85, 0.085], 600: [0.52, 0.13], 800: [0.37, 0.1] };
const RAMP_HUE = { purple: 290, teal: 180, coral: 40, pink: 355, gray: 245, blue: 250, green: 140, amber: 75, red: 25 };
const RAMP_PICK = { light: [50, 600, 800, 600], dark: [800, 200, 100, 200] };

const stop = (name, n) => ok(STOP[n][0], name === 'gray' ? 0 : STOP[n][1], RAMP_HUE[name]);

function roleTokens(mode) {
  const out = {};
  for (const [role, part] of Object.entries(ROLE[mode])) {
    const hue = ROLE_HUE[role];
    const at = key => ok(part[key][0], part[key][1], hue);
    if (part.bg) Object.assign(out, { [`--bg-${role}`]: at('bg'), [`--text-${role}`]: at('text'), [`--border-${role}`]: at('border') });
    Object.assign(out, { [`--fill-${role}`]: at('fill'), [`--fill-${role}-hover`]: at('hover'), [`--on-${role}`]: at('on') });
  }
  return out;
}

function tintTokens(mode) {
  const out = {};
  for (const [name, [bg, text]] of Object.entries(TINT[mode])) {
    out[`--bg-tint-${name}`] = ok(bg[0], bg[1], TINT_HUE[name]);
    out[`--text-tint-${name}`] = ok(text[0], text[1], TINT_HUE[name]);
  }
  return out;
}

function rampTokens(mode) {
  const [fill, edge, title, sub] = RAMP_PICK[mode];
  const out = {};
  for (const name of Object.keys(RAMP_HUE)) {
    out[`--c-${name}-fill`] = stop(name, fill);
    out[`--c-${name}-stroke`] = stop(name, edge);
    out[`--c-${name}-title`] = stop(name, title);
    out[`--c-${name}-sub`] = stop(name, sub);
  }
  return out;
}

export const TOKENS = {
  common: {
    '--surface-panel': 'var(--surface-2)',
    '--surface-popover': 'var(--surface-3)',
    '--page-bg': 'var(--surface-0)',
    '--bg-accent-muted': 'color-mix(in oklab, var(--fill-accent) 5%, transparent)',
    '--fill-field-ring': 'color-mix(in oklab, var(--border-stronger) 50%, transparent)',
    '--focus-shadow': '0 0 0 3px var(--fill-field-ring)',
    '--font-sans': '"Geist", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    '--font-mono': '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    '--font-voice': 'ui-serif, "New York", Georgia, serif',
    '--font-size-caption': '12px',
    '--font-size-footnote': '13px',
    '--font-size-body': '14px',
    '--font-size-prose': '16px',
    '--font-size-code': '13px',
    '--font-size-heading': '18px',
    '--font-size-title': '22px',
    '--radius': '8px',
    '--pad-sm': '8px',
    '--pad-md': '12px',
    '--pad-lg': '16px',
    '--pad-xl': '24px',
    '--gap-xs': '4px',
    '--gap-sm': '8px',
    '--gap-md': '12px',
    '--gap-lg': '16px',
    '--gap-xl': '24px',
    '--h-control': '36px',
    '--shadow-sm': '0 1px 3px 0 var(--shadow-color), 0 1px 2px -1px var(--shadow-color)',
    '--shadow-md': '0 4px 6px -1px var(--shadow-color), 0 2px 4px -2px var(--shadow-color)',
    '--shadow-lg': '0 10px 15px -3px var(--shadow-color), 0 4px 6px -4px var(--shadow-color)',
    '--shadow-popover': '0 0 0 1px var(--border), var(--shadow-md)',
    '--dur-fast': '100ms',
    '--dur-snap': '160ms',
    '--dur-base': '240ms',
    '--dur-slow': '400ms',
    '--ease-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
    '--ease-snap': 'cubic-bezier(0.2, 0, 0, 1)',
    '--ease-overshoot': 'cubic-bezier(0.34, 1.3, 0.64, 1)',
    '--p': 'var(--text-primary)',
    '--s': 'var(--text-secondary)',
    '--t': 'var(--text-muted)',
    '--bg2': 'var(--surface-1)',
    '--b': 'var(--border)',
  },
  // NOTE: [19 Oct 2026] EK - Some of these are the page's own colours and fonts in app.css (--surface-2 is --widget-card, and so on).
  // They must equal the page's in both modes. test/widget.test.mjs lists the pairs and fails if one differs.
  light: {
    'color-scheme': 'light',
    '--surface-0': ok(0.97, 0, 0),
    '--surface-1': ok(0.985, 0, 0),
    '--surface-2': ok(0.995, 0, 0),
    '--surface-3': ok(1, 0, 0),
    '--text-primary': ok(0.145, 0, 0),
    '--text-secondary': ok(0.371, 0, 0),
    '--text-muted': ok(0.556, 0, 0),
    '--text-disabled': ok(0.708, 0, 0),
    ...roleTokens('light'),
    '--bg-neutral': ok(0.97, 0, 0),
    '--bg-highlight': ok(0.93, 0.1, 95),
    ...tintTokens('light'),
    '--border': ok(0.922, 0, 0),
    '--border-strong': ok(0.87, 0, 0),
    '--border-stronger': ok(0.708, 0, 0),
    '--fill-primary': ok(0.205, 0, 0),
    '--fill-primary-hover': ok(0.269, 0, 0),
    '--on-primary': ok(0.985, 0, 0),
    '--fill-secondary': ok(0.97, 0, 0),
    '--fill-secondary-hover': ok(0.94, 0, 0),
    '--fill-secondary-ring': ok(0.145, 0, 0, 0.16),
    '--fill-ghost-hover': ok(0.145, 0, 0, 0.06),
    '--fill-ghost-selected': ok(0.145, 0, 0, 0.1),
    '--fill-field': ok(1, 0, 0),
    '--fill-control': ok(0.922, 0, 0),
    '--fill-control-hover': ok(0.87, 0, 0),
    '--fill-disabled': ok(0.97, 0, 0),
    '--shadow-color': ok(0, 0, 0, 0.1),
    ...rampTokens('light'),
  },
  dark: {
    'color-scheme': 'dark',
    '--surface-0': ok(0.145, 0, 0),
    '--surface-1': ok(0.175, 0, 0),
    '--surface-2': ok(0.205, 0, 0),
    '--surface-3': ok(0.269, 0, 0),
    '--text-primary': ok(0.985, 0, 0),
    '--text-secondary': ok(0.87, 0, 0),
    '--text-muted': ok(0.708, 0, 0),
    '--text-disabled': ok(0.556, 0, 0),
    ...roleTokens('dark'),
    '--bg-neutral': ok(0.269, 0, 0),
    '--bg-highlight': ok(0.42, 0.08, 90),
    ...tintTokens('dark'),
    '--border': ok(1, 0, 0, 0.1),
    '--border-strong': ok(1, 0, 0, 0.15),
    '--border-stronger': ok(0.556, 0, 0),
    '--fill-primary': ok(0.922, 0, 0),
    '--fill-primary-hover': ok(0.87, 0, 0),
    '--on-primary': ok(0.205, 0, 0),
    '--fill-secondary': ok(0.269, 0, 0),
    '--fill-secondary-hover': ok(0.31, 0, 0),
    '--fill-secondary-ring': ok(0.985, 0, 0, 0.16),
    '--fill-ghost-hover': ok(0.985, 0, 0, 0.08),
    '--fill-ghost-selected': ok(0.985, 0, 0, 0.14),
    '--fill-field': ok(1, 0, 0, 0.045),
    '--fill-control': ok(0.371, 0, 0),
    '--fill-control-hover': ok(0.439, 0, 0),
    '--fill-disabled': ok(0.269, 0, 0),
    '--shadow-color': ok(0, 0, 0, 0.1),
    ...rampTokens('dark'),
  },
};

const declarations = set => Object.entries(set).map(([name, value]) => `${name}:${value}`).join(';');

export function tokenCss() {
  const { common, light, dark } = TOKENS;
  return `:root{${declarations(common)};${declarations(light)}}`
    + `:root[data-mode="dark"]{${declarations(dark)}}`
    + `@media (prefers-color-scheme:dark){:root:not([data-mode]){${declarations(dark)}}}`;
}

// ---- the host's styles ----------------------------------------------------------------------------------------------------
//
// Everything that styles a bare tag or a state is wrapped in :where(), which has no specificity. A widget's own rule, however
// plain, then wins over the host's, and the host only fills in what the widget leaves alone.

const BASE = `
html,body{height:auto!important;min-height:0!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;padding:2px;background:transparent;color:var(--text-primary);font:16px/1.7 var(--font-sans)}
body.${CARD_CLASS}{padding:16px}
@media (max-width:479px){body.${CARD_CLASS}{padding:8px}}
body.${CARD_CLASS}>svg{display:block;max-width:100%}
body.${CARD_CLASS}>svg[viewBox]{height:auto}
h1,h2,h3{font-weight:500}
h1{font-size:22px}
h2{font-size:18px}
h3{font-size:16px}
a{color:var(--text-accent)}
code,kbd,pre,samp{font-family:var(--font-mono);font-size:var(--font-size-code)}
img,video,canvas,svg{max-width:100%}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.ti{font-family:"tabler-icons";font-style:normal;font-weight:normal;line-height:1;text-transform:none;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
`;

const PUSH = ['button', 'input[type=button]', 'input[type=submit]', 'input[type=reset]'];
const TYPED = ['input:not([type])', ...['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'].map(t => `input[type=${t}]`)];
const FIELD = [...TYPED, 'select', 'textarea'];
const TICK = ['input[type=checkbox]', 'input[type=radio]'];

const where = (list, state = '') => `:where(${list.map(s => s + state).join(',')})`;

const CONTROLS = `
${where(PUSH)}{box-sizing:border-box;padding:var(--pad-sm) var(--pad-md);border:1px solid var(--border-strong);border-radius:var(--radius);background:transparent;color:inherit;font:inherit;font-size:var(--font-size-body);line-height:1.35;cursor:pointer;transition:background-color var(--dur-fast),transform var(--dur-fast)}
${where(PUSH, ':hover')}{background:var(--fill-secondary)}
${where(PUSH, ':active')}{transform:scale(.98)}
${where(PUSH, ':focus-visible')}{outline:none;border-color:var(--border-stronger);box-shadow:var(--focus-shadow)}
${where([...TYPED, 'select'])}{box-sizing:border-box;height:var(--h-control);padding:0 var(--pad-md);border:1px solid var(--border-strong);border-radius:var(--radius);background:var(--fill-field);color:inherit;font:inherit;font-size:var(--font-size-body);transition:border-color var(--dur-fast),box-shadow var(--dur-fast)}
${where(['textarea'])}{box-sizing:border-box;padding:var(--pad-sm) var(--pad-md);border:1px solid var(--border-strong);border-radius:var(--radius);background:var(--fill-field);color:inherit;font:inherit;font-size:var(--font-size-body);line-height:1.5;resize:vertical;transition:border-color var(--dur-fast),box-shadow var(--dur-fast)}
${where(FIELD, ':hover')}{border-color:var(--border-stronger)}
${where(FIELD, ':focus')}{outline:none;border-color:var(--border-stronger);box-shadow:var(--focus-shadow)}
${where(['input', 'textarea'], '::placeholder')}{color:var(--text-muted);opacity:1}
${where(TICK)}{accent-color:var(--fill-accent)}
${where([...PUSH, ...FIELD], ':disabled')}{background:var(--fill-disabled);color:var(--text-disabled);cursor:not-allowed;transform:none}
${where([...TICK, 'input[type=range]'], ':disabled')}{opacity:.5;cursor:not-allowed}
${where(['input[type=range]'])}{-webkit-appearance:none;appearance:none;box-sizing:border-box;height:16px;margin:var(--gap-xs) 0;background:transparent;cursor:pointer}
${where(['input[type=range]'])}::-webkit-slider-runnable-track{height:6px;border-radius:9999px;background:var(--fill-control)}
${where(['input[type=range]'])}::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-5px;border:1px solid var(--fill-accent);border-radius:50%;background:var(--page-bg);box-shadow:var(--shadow-sm)}
${where(['input[type=range]'])}::-moz-range-track{height:6px;border-radius:9999px;background:var(--fill-control)}
${where(['input[type=range]'])}::-moz-range-progress{height:6px;border-radius:9999px;background:var(--fill-accent)}
${where(['input[type=range]'])}::-moz-range-thumb{width:16px;height:16px;box-sizing:border-box;border:1px solid var(--fill-accent);border-radius:50%;background:var(--page-bg);box-shadow:var(--shadow-sm)}
${where(['input[type=range]'], ':hover')}::-webkit-slider-thumb{box-shadow:var(--shadow-sm),0 0 0 4px var(--fill-field-ring)}
${where(['input[type=range]'], ':hover')}::-moz-range-thumb{box-shadow:var(--shadow-sm),0 0 0 4px var(--fill-field-ring)}
${where(['input[type=range]'], ':focus-visible')}{outline:none}
${where(['input[type=range]'], ':focus-visible')}::-webkit-slider-thumb{box-shadow:var(--shadow-sm),0 0 0 4px var(--fill-field-ring)}
${where(['input[type=range]'], ':focus-visible')}::-moz-range-thumb{box-shadow:var(--shadow-sm),0 0 0 4px var(--fill-field-ring)}
@media (prefers-reduced-motion:reduce){${where([...PUSH, ...FIELD])}{transition:none}}
`;

// A host default for one property, kept off any element that sets that property itself as an attribute. A rule in a stylesheet
// beats a presentation attribute, so without the :not() the host would override the widget's own fill or stroke.
const ifUnset = (selectors, property, value) => `${where(selectors, `:not([${property}])`)}{${property}:${value}}`;

const SVG_CLASSES = [
  ifUnset(['svg .t'], 'fill', 'var(--text-primary)'),
  ifUnset(['svg .ts'], 'fill', 'var(--text-secondary)'),
  ifUnset(['svg .th'], 'fill', 'var(--text-primary)'),
  `${where(['svg .t', 'svg .ts', 'svg .th'])}{font-family:var(--font-sans)}`,
  `${where(['svg .t', 'svg .th'])}{font-size:14px}`,
  `${where(['svg .ts'])}{font-size:12px}`,
  `${where(['svg .th'])}{font-weight:500}`,
  ifUnset(['svg .box'], 'fill', 'var(--surface-1)'),
  ifUnset(['svg .box'], 'stroke', 'var(--border-strong)'),
  ifUnset(['svg .box'], 'stroke-width', '.5px'),
  `${where(['svg .node'])}{cursor:pointer;transition:opacity var(--dur-fast)}`,
  `${where(['svg .node'], ':hover')}{opacity:.8}`,
  ifUnset(['svg .arr'], 'fill', 'none'),
  ifUnset(['svg .arr'], 'stroke', 'var(--text-muted)'),
  ifUnset(['svg .arr'], 'stroke-width', '1.5px'),
  ifUnset(['svg .leader'], 'fill', 'none'),
  ifUnset(['svg .leader'], 'stroke', 'var(--text-muted)'),
  ifUnset(['svg .leader'], 'stroke-width', '.5px'),
  ifUnset(['svg .leader'], 'stroke-dasharray', '4 3'),
  '@supports not (stroke:context-stroke){marker [stroke="context-stroke"]{stroke:var(--text-muted)}marker [fill="context-stroke"]{fill:var(--text-muted)}}',
].join('\n');

// A ramp colours the shapes that are its direct children, or the shape itself when the class is on it, and never a path, so an
// arrow drawn inside a coloured group keeps its own look. It overrides fill and stroke attributes but keeps a stroke-width the widget set.
function rampCss() {
  return Object.keys(RAMP_HUE).map(name => {
    const c = `.c-${name}`;
    const shapes = [`${c}>rect`, `${c}>circle`, `${c}>ellipse`, `rect${c}`, `circle${c}`, `ellipse${c}`];
    return [
      `${shapes.join(',')}{fill:var(--c-${name}-fill);stroke:var(--c-${name}-stroke)}`,
      `${shapes.map(s => `${s}:not([stroke-width])`).join(',')}{stroke-width:.5px}`,
      `${c}>.th,${c}>.t{fill:var(--c-${name}-title)}`,
      `${c}>.ts{fill:var(--c-${name}-sub)}`,
    ].join('\n');
  }).join('\n');
}

export function hostCss() {
  return [tokenCss(), BASE, CONTROLS, SVG_CLASSES, rampCss()].join('\n').replace(/\n+/g, '\n').trim();
}
