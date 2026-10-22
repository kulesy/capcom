// Run with `npm test`. The Ghost look's colours as ghost.css writes them, in the light set and in the dark set laid over it: text keeps 4.5:1
// and a mark keeps 3:1 on each surface it is drawn on. It needs no page, so it reads the tokens, and the rules that draw the rings and hints, out of the stylesheet text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { styleRules } from './css.mjs';

const read = name => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const tokensIn = (body = '') => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

const ghost = read('ghost.css');
const app = read('app.css');
const ghostRules = styleRules(ghost);
const appRules = styleRules(app);
const lightBlock = /^:root\[data-look="ghost"\] \{([^}]*)\}/m.exec(ghost)?.[1];
const darkBlock = /@media \(prefers-color-scheme: dark\) \{\s*:root\[data-look="ghost"\] \{([^}]*)\}/.exec(ghost)?.[1];
const standard = tokensIn(/^:root \{([^}]*)\}/m.exec(app)?.[1]);
const standardDark = tokensIn(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/.exec(app)?.[1]);

// Ghost leaves the light --diff-del and the unread mark's --ready to app.css, and the dark block is laid over the light one as the cascade does.
const light = { ...tokensIn(lightBlock), '--diff-del': standard['--diff-del'], '--ready': standard['--ready'] };
const SETS = { light, dark: { ...light, '--ready': standardDark['--ready'], ...tokensIn(darkBlock) } };

const encode = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

// An oklch() colour as sRGB channels from 0 to 1, clipped to the gamut and encoded as a screen holds them, with its alpha.
function srgb(text) {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+)%)?\)$/.exec(text);
  assert.ok(match, `not an oklch() colour: ${text}`);
  const [l, c, h] = match.slice(1, 4).map(Number);
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const [x, y, z] = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map(v => v ** 3);
  const linear = [4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z, -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z, -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z];
  return { rgb: linear.map(v => encode(Math.min(1, Math.max(0, v)))), alpha: match[4] === undefined ? 1 : Number(match[4]) / 100 };
}

// What a value in a rule or a token paints: an oklch() colour, a token by its name or as var(--token), or color-mix(in oklab, <colour> N%, transparent), which is that colour at N% of its alpha.
function colour(set, text) {
  const value = text.startsWith('--') ? `var(${text})` : text;
  const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (token) {
    assert.ok(token in set, `${token} is not a token ghost.css or app.css sets`);
    return colour(set, set[token]);
  }
  const mix = /^color-mix\(in oklab, (.+) ([\d.]+)%, transparent\)$/.exec(value);
  if (!mix) return srgb(value);
  const { rgb, alpha } = colour(set, mix[1]);
  return { rgb, alpha: alpha * Number(mix[2]) / 100 };
}

const luminance = rgb => { const [r, g, b] = rgb.map(decode); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

// The WCAG ratio of an ink on a surface, the ink first blended over the surface by its alpha as a browser does, in encoded sRGB.
function ratio(set, ink, surface) {
  const top = colour(set, ink);
  const under = colour(set, surface);
  const shown = top.rgb.map((v, i) => v * top.alpha + under.rgb[i] * (1 - top.alpha));
  const [bright, dim] = [luminance(shown), luminance(under.rgb)].sort((p, q) => q - p);
  return (bright + 0.05) / (dim + 0.05);
}

const READING = ['--background', '--sidebar', '--card', '--popover', '--muted', '--sidebar-accent'];

// Each is an ink and the surfaces it is drawn on. An inverted menu item is --popover on --popover-foreground, and a destructive one --popover on --destructive.
const TEXT = [
  ['--foreground', READING],
  ['--muted-foreground', READING],
  ['--primary-foreground', ['--primary']],
  ['--destructive', ['--background', '--sidebar', '--popover']],
  ['--warning-foreground', ['--background', '--warning-muted']],
  ['--success-foreground', ['--muted']],
  ['--diff-del', ['--muted']],
  ['--popover', ['--popover-foreground', '--destructive']],
];
const MARKS = [
  ['--ring', ['--background', '--sidebar', '--popover']],
  ['--sidebar-ring', ['--sidebar']],
  ['--eye-ink', ['--background', '--sidebar']],
  ['--eye', ['--socket']],
  ['--shell', ['--background', '--sidebar']],
  ['--warning', ['--background', '--sidebar', '--socket']],
  ['--ready', ['--sidebar']],
  ['--warning-foreground', ['--sidebar']],
];

const DARK = '@media (prefers-color-scheme: dark)';
const inApp = selector => [appRules, selector];
const inGhost = selector => [ghostRules, `[data-look="ghost"] ${selector}`];

// What the rules for `selector` set `property` to in `mode`, or undefined: a dark rule is laid over a light one in dark, as the token sets are.
function declared(rules, selector, property, mode) {
  const last = within => rules.filter(rule => rule.selectors.includes(selector) && rule.within.join() === within && property in rule.declarations).at(-1)?.declarations[property];
  return (mode === 'dark' ? last(DARK) : undefined) ?? last('');
}

// The value of `property` that wins among these [rules, selector] places, listed weakest first: a variant beats the plain rule, and a Ghost rule beats
// app.css's, because its attribute selector is the longer or ties and comes later. A place no rule fills is passed over, so a Ghost rule that goes falls back to app.css's.
function winning(property, mode, ...places) {
  const value = places.map(([rules, selector]) => declared(rules, selector, property, mode)).filter(found => found !== undefined).at(-1);
  assert.ok(value !== undefined, `no rule sets ${property} for ${places.map(([, selector]) => selector).join(', ')}`);
  return value;
}

const DESTRUCTIVE_BUTTON = '.btn[data-variant="destructive"]';
const INVALID_BUTTON = '.btn[aria-invalid="true"]';
const DESTRUCTIVE_ITEM = '.menu-item[data-variant="destructive"]';
const LIT = ':is(:focus, [data-state="open"]):not([data-disabled])';
const HINTS = ':is(.menu-value, .menu-shortcut)';

const buttonRing = (mode, variant = '.btn') => winning('--btn-ring', mode, inApp('.btn'), inApp(variant), inGhost('.btn'), inGhost(variant));
const menuHint = (mode, item = '.menu-item') => winning('color', mode, inGhost(`.menu-item${LIT} ${HINTS}`), inGhost(`${item}${LIT} ${HINTS}`));

// The idle lamp's edge is a 1px ring inset in the lamp, drawn on whatever the lamp sits on.
function idleLampRing(mode) {
  const edge = winning('--lamp-edge', mode, inApp('.lamp'), inGhost('.lamp'));
  const ring = /^inset 0 0 0 1px (.+)$/.exec(edge)?.[1];
  assert.ok(ring, `the idle lamp's edge is not a 1px inset ring: ${edge}`);
  return ring;
}

// The transcript draws its focus as inset rings, and the first one alone has to hold 3:1 on the chat's background.
function transcriptRing(mode) {
  const shadow = winning('box-shadow', mode, inApp('.transcript:focus-visible'), inGhost('.transcript:focus-visible'));
  const ring = /^inset 0 0 0 \d+px (.+?)(?:, inset .*)?$/.exec(shadow)?.[1];
  assert.ok(ring, `the transcript's focus is not drawn as inset rings: ${shadow}`);
  return ring;
}

const rule = (what, value) => ({ name: `${what} (${value})`, value });
const RINGED_ON = ['--background', '--sidebar', '--popover', '--card'];

// The inks that rules set instead of a token, read from the rule that wins for the mode, each with the surfaces it is drawn on.
const fromRules = mode => ({
  text: [
    [rule('the inverted menu hint', menuHint(mode)), ['--popover-foreground']],
    [rule('the destructive menu hint', menuHint(mode, DESTRUCTIVE_ITEM)), ['--destructive']],
  ],
  marks: [
    [rule('a button\'s focus ring', buttonRing(mode)), RINGED_ON],
    [rule('a destructive button\'s focus ring', buttonRing(mode, DESTRUCTIVE_BUTTON)), RINGED_ON],
    [rule('an invalid button\'s ring', buttonRing(mode, INVALID_BUTTON)), RINGED_ON],
    [rule('the idle lamp\'s ring', idleLampRing(mode)), ['--sidebar', '--background']],
    [rule('the transcript\'s focus ring', transcriptRing(mode)), ['--background']],
  ],
});

// The pairs under `least`, each named with the ratio it got, so a failure shows which colour to move and by how much.
const misses = (set, pairs, least) => pairs
  .flatMap(([ink, surfaces]) => surfaces.map(surface => ({ ink, surface, got: ratio(set, ink.value ?? ink, surface) })))
  .filter(({ got }) => got < least)
  .map(({ ink, surface, got }) => `${ink.name ?? ink} on ${surface} is ${got.toFixed(2)}:1`);

test('ghost.css has a light token block and a dark one, and app.css has the colours the Ghost sets borrow', () => {
  assert.ok(lightBlock, 'no :root[data-look="ghost"] block at the start of a line');
  assert.ok(darkBlock, 'no :root[data-look="ghost"] block inside the first dark media query');
  assert.ok(standard['--diff-del']);
  assert.ok(standard['--ready']);
  assert.ok(standardDark['--ready']);
});

test('the dark block sets every token the light block does, so no light colour is left showing on a dark surface', () => {
  const dark = tokensIn(darkBlock);
  assert.deepEqual(Object.keys(tokensIn(lightBlock)).filter(name => !(name in dark)), []);
});

test('a colour reads through var(), a token by name and color-mix() with transparent, as the alpha it leaves', () => {
  const set = { '--a': 'oklch(0.5 0.1 200)', '--b': 'var(--a)', '--c': 'oklch(0.5 0.1 200 / 40%)' };
  assert.deepEqual(colour(set, '--b'), colour(set, 'oklch(0.5 0.1 200)'));
  assert.equal(colour(set, 'color-mix(in oklab, var(--b) 50%, transparent)').alpha, 0.5);
  assert.equal(colour(set, 'color-mix(in oklab, var(--c) 50%, transparent)').alpha, 0.2);
  assert.throws(() => colour(set, 'var(--missing)'), /--missing is not a token/);
});

for (const mode of ['light', 'dark']) {
  test(`${mode}: text keeps 4.5:1 on each surface it is drawn on`, () => {
    assert.deepEqual(misses(SETS[mode], [...TEXT, ...fromRules(mode).text], 4.5), []);
  });

  test(`${mode}: a mark keeps 3:1 on each surface it is drawn on`, () => {
    assert.deepEqual(misses(SETS[mode], [...MARKS, ...fromRules(mode).marks], 3), []);
  });

  test(`${mode}: a button rings its focus in the eye's colour at full strength, a destructive one too, and an invalid one in the destructive colour`, () => {
    const eye = colour(SETS[mode], '--ring');
    assert.deepEqual(colour(SETS[mode], buttonRing(mode)), eye);
    assert.deepEqual(colour(SETS[mode], buttonRing(mode, DESTRUCTIVE_BUTTON)), eye);
    assert.deepEqual(colour(SETS[mode], buttonRing(mode, INVALID_BUTTON)), colour(SETS[mode], '--destructive'));
  });
}
