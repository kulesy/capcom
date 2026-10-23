// Run with `npm test`. GhostShell's logo: the three files the README uses, the wordmark that app.css holds once for the list, the sign-in and
// set-up pages and the title bar, the shell those pages draw, and what an installed window needs to show it in its title bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const read = name => root(`public/${name}`);
const LOGOS = ['logo.svg', 'logo-light.svg', 'logo-dark.svg'];
const logos = Object.fromEntries(LOGOS.map(name => [name, root(`docs/media/${name}`)]));
const [index, login, setup, css, ghost, shell] = ['index.html', 'login.html', 'setup.html', 'app.css', 'ghost.css', 'ui/shell.js'].map(read);
const manifest = JSON.parse(read('manifest.webmanifest'));
const readme = root('README.md');

const PARTS = ['shell-core', 'shell-turn', 'shell-plate', 'shell-socket', 'shell-glow', 'shell-eye'];

// The text between the braces that follow the first `header` in `text`.
function block(text, header) {
  const from = text.indexOf(header);
  assert.notEqual(from, -1, `${header} is in the stylesheet`);
  const open = text.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  assert.fail(`${header} never closes`);
}

const wordmark = decodeURIComponent(/--wordmark: url\("data:image\/svg\+xml,([^"]+)"\)/.exec(css)?.[1] ?? '');
const overlay = block(css, '@media (display-mode: window-controls-overlay)');

// The declarations of the rule in the overlay block whose selector list has `selector`.
const ruleFor = selector => {
  const rule = [...overlay.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, list]) => list.split(',').map(part => part.trim()).includes(selector));
  assert.ok(rule, `${selector} has a rule in the overlay block`);
  return rule[2];
};

test('the README logo comes in three files that share one box and carry the name GhostShell for a screen reader', () => {
  const boxes = new Set(Object.values(logos).map(svg => /<svg[^>]*\sviewBox="([^"]+)"/.exec(svg)?.[1]));
  assert.equal(boxes.size, 1);
  assert.ok([...boxes][0]);
  for (const [name, svg] of Object.entries(logos)) {
    assert.match(svg, /<svg[^>]*\srole="img"/, name);
    assert.match(svg, /<svg[^>]*\saria-label="GhostShell"|<title>GhostShell<\/title>/, name);
  }
});

test('the logo files draw letters as paths, so they need no font and look the same wherever they are shown', () => {
  for (const [name, svg] of Object.entries(logos)) {
    assert.doesNotMatch(svg, /<text/, name);
    assert.doesNotMatch(svg, /font/i, name);
    assert.match(svg, /<path /, name);
  }
});

test('the logo in dark has light ink and the logo in light has dark ink, and the third follows the reader\'s scheme', () => {
  const ink = svg => /\.plate,\.word\{fill:(#[0-9a-f]+)\}/.exec(svg)?.[1];
  const lightness = hex => parseInt(hex.slice(1, 3), 16);
  assert.ok(lightness(ink(logos['logo-dark.svg'])) > 200);
  assert.ok(lightness(ink(logos['logo-light.svg'])) < 60);
  assert.match(logos['logo.svg'], /@media \(prefers-color-scheme: dark\)/);
});

test('app.css holds the wordmark once, as a data URL of two paths and no text, and it draws the same letters as the README logo', () => {
  assert.equal(css.match(/--wordmark:/g).length, 1);
  assert.match(wordmark, /^<svg [^>]*viewBox='0 -726 3440 1742'/);
  assert.doesNotMatch(wordmark, /<text/);
  assert.doesNotMatch(wordmark, /font/i);
  const paths = [...wordmark.matchAll(/<path (?:[^>]*\s)?d='([^']+)'/g)].map(m => m[1]);
  assert.equal(paths.length, 2);
  for (const [name, svg] of Object.entries(logos)) for (const d of paths) assert.ok(svg.includes(d), name);
});

test('the README header is the logo in a picture that picks the dark file in a dark scheme, with the alt text GhostShell', () => {
  const header = /<h1>(<picture>.*<\/picture>)<\/h1>/.exec(readme)?.[1];
  assert.ok(header, 'the h1 holds a picture');
  assert.match(header, /<source media="\(prefers-color-scheme: dark\)" srcset="docs\/media\/logo-dark\.svg">/);
  assert.match(header, /<img alt="GhostShell" src="docs\/media\/logo-light\.svg"/);
});

test('the list heading stays real text and the Ghost look turns it into the wordmark in the plates\' ink', () => {
  assert.match(read('ui/sessions-list.js'), /<div class="brand"><\$\{Shell\} class="brand-mark" \/><h1>GhostShell<\/h1><\/div>/);
  const rule = block(ghost, '[data-look="ghost"] .brand h1 {');
  assert.match(rule, /background: var\(--shell\)/);
  assert.match(rule, /mask: var\(--wordmark\) center \/ contain no-repeat/);
  assert.match(rule, /text-indent: 100%/);
  assert.match(rule, /overflow: hidden/);
});

test('the sign-in page and the set-up page draw the shell above a heading that is still the name in text', () => {
  const plates = [...shell.matchAll(/const (?:TALL|WIDE) = '([^']+)'/g)].map(m => m[1]);
  assert.equal(plates.length, 2);
  for (const html of [login, setup]) {
    const header = /<header class="gate-header">([\s\S]*?)<\/header>/.exec(html)[1];
    assert.match(header, /<svg class="shell gate-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">/);
    for (const part of PARTS) assert.match(header, new RegExp(`class="${part}"`), part);
    for (const d of plates) assert.ok(header.includes(d));
    assert.ok(header.indexOf('gate-mark') < header.indexOf('<h1>GhostShell</h1>'), 'the mark comes first');
  }
});

test('the heading of the sign-in and set-up pages is the wordmark in the same ink as the mark', () => {
  const rule = block(css, '.gate-header h1 {');
  assert.match(rule, /background: var\(--gate-shell\)/);
  assert.match(rule, /mask: var\(--wordmark\) center \/ contain no-repeat/);
  assert.match(block(css, '.gate-mark .shell-plate {'), /fill: var\(--gate-shell\)/);
});

test('an installed app asks Chrome to draw its window controls over the page and stays standalone where that is not offered', () => {
  assert.deepEqual(manifest.display_override, ['window-controls-overlay']);
  assert.equal(manifest.display, 'standalone');
});

test('the title bar is a static strip outside the app, shown only with the controls over the page', () => {
  const bar = /<div class="titlebar" aria-hidden="true">([\s\S]*?)<p id="unsupported"/.exec(index)?.[1];
  assert.ok(bar, 'the strip comes before the app in the body');
  assert.match(bar, /<svg class="shell titlebar-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">/);
  assert.match(bar, /<span class="titlebar-word"><\/span>/);
  for (const part of PARTS) assert.match(bar, new RegExp(`class="${part}"`), part);
  assert.ok(index.indexOf('class="titlebar"') < index.indexOf('id="boot"'));
  assert.ok(index.indexOf('class="titlebar"') < index.indexOf('id="root"'));
  assert.match(css, /^\.titlebar \{ display: none; \}$/m);
  assert.doesNotMatch(css.slice(0, css.indexOf('@media (display-mode: window-controls-overlay)')).replace(/\.titlebar \{ display: none; \}/, ''), /\.titlebar/);
});

test('the strip is a drag area as tall as the title bar, and its colour is the theme colour Chrome paints behind the controls', () => {
  const rule = block(overlay, '.titlebar {');
  assert.match(rule, /position: fixed/);
  assert.match(rule, /height: env\(titlebar-area-height, 0px\)/);
  assert.match(rule, /(?<!-webkit-)app-region: drag/);
  assert.match(rule, /-webkit-app-region: drag/);
  assert.match(rule, /border-bottom: 1px solid var\(--sidebar-border\)/);
  assert.match(block(overlay, '.titlebar-box {'), /left: env\(titlebar-area-x, 0px\)/);
  assert.match(block(overlay, '.titlebar-box {'), /width: env\(titlebar-area-width, 100%\)/);
  const [light, dark] = ['light', 'dark'].map(scheme => new RegExp(`<meta name="theme-color" content="(#[0-9a-f]+)" media="\\(prefers-color-scheme: ${scheme}\\)">`).exec(index)[1]);
  assert.match(rule, new RegExp(`background: ${light}`));
  assert.match(block(overlay, '@media (prefers-color-scheme: dark)'), new RegExp(`\\.titlebar \\{ background: ${dark}; \\}`));
});

test('with the controls over the page the app and every full-window layer start below the strip, and the list\'s own logo is for screen readers only', () => {
  assert.match(block(overlay, '.app {'), /margin-top: env\(titlebar-area-height, 0px\)/);
  assert.match(block(overlay, '.app {'), /height: calc\(100dvh - env\(titlebar-area-height, 0px\)\)/);
  for (const layer of ['[data-slot="dialog-overlay"]', '[data-slot="alert-dialog-overlay"]', '[data-slot="sheet-overlay"]', '.viewer', '[data-slot="sidebar"][data-mobile="true"]']) {
    assert.match(ruleFor(layer), /(?:^|\s)top: env\(titlebar-area-height, 0px\);/, layer);
  }
  assert.match(block(overlay, '.app .list-head .brand > * {'), /clip-path: inset\(50%\)/);
});

test('a menu, a context popover and the slash menu keep their clicks where they overlap the strip, and the slash list leaves room for it', () => {
  for (const popup of ['.menu', '.context-pop', '.slash-menu']) assert.match(ruleFor(popup), /(?:^|\s)app-region: no-drag;/, popup);
  assert.match(ruleFor('.slash-menu [data-slot="command-list"]'), /- env\(titlebar-area-height, 0px\)/);
});

test('the sign-in and set-up pages carry the theme colours of the app page, and their card clears the strip', () => {
  const metas = html => html.match(/<meta name="theme-color"[^>]*>/g);
  assert.equal(metas(index).length, 2);
  assert.deepEqual(metas(login), metas(index));
  assert.deepEqual(metas(setup), metas(index));
  assert.match(ruleFor('.gate'), /padding-top: calc\(1\.5rem \+ env\(titlebar-area-height, 0px\)\)/);
});

test('with forced colours the three wordmarks keep their own ink and draw in the text colour', () => {
  for (const sheet of [css, ghost]) assert.match(block(sheet, '@media (forced-colors: active)'), /forced-color-adjust: none;\s+background: CanvasText/);
  assert.match(block(css, '@media (forced-colors: active)'), /\.gate-header h1, \.titlebar-word/);
  assert.match(block(ghost, '@media (forced-colors: active)'), /\.brand h1/);
});
