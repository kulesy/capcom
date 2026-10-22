// Run with `npm test`. Parses and links what each page loads and every module under public/ but vendor/, resolving imports as the
// browser would on that page and running none of it, so a syntax error, a missing export or an unfetchable import fails here first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const LINKED = 'linked';
const root = new URL('../', import.meta.url);
const served = new URL('public/', root);
const dataModule = source => `data:text/javascript,${encodeURIComponent(source)}`;

// A page with no import map gets an empty one, so a bare name on it fails here as it does in the browser.
const maps = {};
const scripts = [];
for (const page of fs.readdirSync(served).filter(file => file.endsWith('.html')).sort()) {
  const url = new URL(page, served);
  const html = fs.readFileSync(url, 'utf8');
  const map = html.match(/<script type="importmap">(.*?)<\/script>/s)?.[1];
  const imports = map ? JSON.parse(map).imports : {};
  for (const name in imports) imports[name] = new URL(imports[name], url).href;
  maps[page] = imports;
  const modules = html.matchAll(/<script\b(?=[^>]*\btype="module")[^>]*\bsrc="([^"]+)"/g);
  for (const [, src] of modules) scripts.push({ page, src, file: new URL(src, url) });
}
// A module's page rides in its URL as ?page= and each import it makes inherits it, so a file two pages share links once per page.
register('./load-hooks.mjs', import.meta.url, { data: { served: served.href, maps } });

const files = fs.readdirSync(served, { recursive: true })
  .filter(file => /\.m?js$/.test(file) && !file.startsWith('vendor/'))
  .sort()
  .map(file => `public/${file}`);

// Throws on purpose, and each entry imports it first: Node parses and links the whole graph before running any of it, so a bad file
// rejects before this does, and the page's own code, which needs a window and a document, never runs.
const guard = dataModule(`throw ${JSON.stringify(LINKED)}`);

async function links(file, page) {
  const entry = new URL(file);
  entry.searchParams.set('page', page);
  try {
    await import(dataModule(`import ${JSON.stringify(guard)}; import ${JSON.stringify(entry.href)};`));
  } catch (error) {
    if (error === LINKED) return;
    // A parse error names no file or line, so node --check shows them, though only in the broken file's own test.
    const check = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    throw error;
  }
  assert.fail('the guard did not stop the import, so the page code ran');
}

test('the walk finds the app and its ui modules and a page loads a script, so the suite cannot pass with nothing to load', () => {
  assert.ok(files.includes('public/app.js'));
  assert.ok(files.some(file => file.startsWith('public/ui/')));
  assert.ok(scripts.length > 0);
});

for (const { page, src, file } of scripts) {
  test(`${page} loads ${src}`, () => links(file, page));
}

for (const file of files) {
  test(`${file} parses and links`, () => links(new URL(file, root), 'index.html'));
}
