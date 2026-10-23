// Run with `npm test`. Capcom's own tools are answered by a plain function, so the list the CLI is given and what each call returns
// are checked here without a server. The widget guide is a file the model reads, so it is held to what the frame does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleMcp, makeChips, TOOL_NAMES } from '../lib/tools.mjs';
import {
  ACTIVE_MS, CDNS, HEIGHT_MAX, LINK_MAX, parseGlyphs, PROMPT_MAX,
} from '../public/ui/widget-frame.js';
import { hostCss, tokenCss } from '../public/ui/widget-theme.js';

const GUIDE_URL = new URL('../lib/widget-guide.md', import.meta.url);
const guide = fs.readFileSync(GUIDE_URL, 'utf8');

const call = (method, params) => handleMcp({ jsonrpc: '2.0', id: 7, method, params }, {});
const listed = () => Object.fromEntries(call('tools/list').result.tools.map(t => [t.name, t]));

// `--{bg,text}-{a,b}` stands for the four names it spells out.
function expand(name) {
  const open = name.indexOf('{');
  if (open < 0) return [name];
  const close = name.indexOf('}', open);
  const [head, tail] = [name.slice(0, open), name.slice(close + 1)];
  return name.slice(open + 1, close).split(',').flatMap(part => expand(head + part + tail));
}

const section = heading => new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(guide)?.[1] ?? '';
const declared = new Set([...tokenCss().matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]));

test('the list the CLI is given has a guide tool that takes no input', () => {
  const guideTool = listed().widget_guide;
  assert.ok(guideTool, 'widget_guide is not listed');
  assert.deepEqual(guideTool.inputSchema.properties, {});
  assert.ok(!guideTool.inputSchema.required?.length, 'widget_guide asks for an input');
  assert.match(guideTool.description, /once per chat/);
});

test('the widget tool takes loading messages first and still needs only a title and the code', () => {
  const { inputSchema, description } = listed().show_widget;
  assert.deepEqual(Object.keys(inputSchema.properties), ['loading_messages', 'title', 'widget_code']);
  assert.deepEqual(inputSchema.required, ['title', 'widget_code']);
  assert.equal(inputSchema.properties.loading_messages.type, 'array');
  assert.equal(inputSchema.properties.loading_messages.items.type, 'string');
  assert.match(inputSchema.properties.loading_messages.description, /a few words/);
  assert.match(description, /widget_guide/, 'the description does not send the model to the guide');
  assert.ok(description.length < 400, 'the description is sent with every request, so it stays short');
});

test('the tools Capcom serves are all allowed without asking, the guide included', () => {
  assert.ok(TOOL_NAMES.includes('mcp__capcom__widget_guide'));
  assert.deepEqual(TOOL_NAMES, Object.keys(listed()).map(name => `mcp__capcom__${name}`));
});

test('asking for the guide returns its text as the tool result', () => {
  const { result } = call('tools/call', { name: 'widget_guide', arguments: {} });
  assert.deepEqual(result, { content: [{ type: 'text', text: guide }] });
  assert.ok(guide.length > 1000);
});

test('a guide that is missing from the install is an error result the model can read, not a crash', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-tools-'));
  try {
    fs.copyFileSync(new URL('../lib/tools.mjs', import.meta.url), path.join(dir, 'tools.mjs'));
    const copy = await import(pathToFileURL(path.join(dir, 'tools.mjs')).href);
    const { result } = copy.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'widget_guide', arguments: {} } }, {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /could not be read \(ENOENT\)/);
    assert.ok(!result.content[0].text.includes(dir), 'the folder it looked in is not handed to the model');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the other tools answer as before', () => {
  assert.equal(call('tools/call', { name: 'show_widget', arguments: { title: 'x', widget_code: '<p></p>' } }).result.content[0].text, 'The widget is showing in the chat.');
  assert.equal(call('tools/call', { name: 'mark_chapter', arguments: { title: 'x' } }).result.content[0].text, 'Chapter marked.');
  assert.equal(call('tools/call', { name: 'nothing_here', arguments: {} }).result.isError, true);
});

test('chips map each session a chip started to the session that made it, and leave out a chip that is open, dismissed, or missing either session', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-chips-'));
  try {
    const chips = makeChips(dir);
    assert.deepEqual([...chips.links()], []);
    chips.put({ toolUseId: 'open', sessionId: 'maker', startedId: 'a', status: 'open' });
    chips.put({ toolUseId: 'dismissed', sessionId: 'maker', startedId: 'b', status: 'dismissed' });
    chips.put({ toolUseId: 'unstarted', sessionId: 'maker', status: 'started' });
    chips.put({ toolUseId: 'unowned', startedId: 'd', status: 'started' });
    assert.deepEqual([...chips.links()], [], 'none of these makes a link');
    chips.put({ toolUseId: 'open', status: 'started' });
    chips.put({ toolUseId: 'second', sessionId: 'other', startedId: 'e', status: 'started' });
    assert.deepEqual([...chips.links()], [['a', 'maker'], ['e', 'other']]);
    assert.deepEqual([...makeChips(dir).links()], [['a', 'maker'], ['e', 'other']], 'a restart reads them from chips.json');
    assert.deepEqual(fs.readdirSync(dir), ['chips.json']);

    const written = [];
    const write = fs.writeFileSync;
    t.mock.method(fs, 'writeFileSync', (file, ...rest) => { written.push(file); return write(file, ...rest); });
    chips.put({ toolUseId: 'third', sessionId: 'maker', startedId: 'f', status: 'started' });
    assert.equal(written.length, 1);
    assert.ok(written.every(file => file !== path.join(dir, 'chips.json')), 'a save is written beside the file and renamed into place, so a cut-off write cannot leave it unreadable');
    assert.deepEqual(fs.readdirSync(dir), ['chips.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the guide names every host a widget can load from, and Google Fonts', () => {
  for (const cdn of CDNS) assert.ok(guide.includes(new URL(cdn).host), `the guide leaves out ${cdn}`);
  assert.ok(guide.includes('fonts.googleapis.com') && guide.includes('fonts.gstatic.com'));
});

test('every variable the guide offers is one the host defines, and the guide offers every one the host defines', () => {
  const offered = [...section('Variables').matchAll(/`(--[^`]+)`/g)].flatMap(m => expand(m[1]));
  assert.ok(offered.length > 150, `only ${offered.length} names were read from the guide`);
  assert.deepEqual(offered.filter(name => !declared.has(name)), [], 'the guide offers a name the host does not define');
  assert.deepEqual([...declared].filter(name => !offered.includes(name)), [], 'the host defines a name the guide does not offer');
});

test('a variable used without a fallback anywhere in the guide is defined, and the one example name that is not defined has a fallback', () => {
  const bare = [...guide.matchAll(/var\((--[a-z0-9-]+)\)|['"](--[a-z0-9-]+)['"]/g)].map(m => m[1] ?? m[2]);
  assert.ok(bare.length >= 5, `only ${bare.length} uses were read from the guide`);
  assert.deepEqual(bare.filter(name => !declared.has(name)), []);
  const fallbacks = [...guide.matchAll(/var\((--[a-z0-9-]+)\s*,/g)].map(m => m[1]);
  assert.ok(fallbacks.length > 0 && fallbacks.every(name => !declared.has(name)), 'the fallback example should show a name the host does not define');
});

test('every class and icon the guide tells a widget to use is one the host styles define', () => {
  const css = hostCss();
  const ramps = ['purple', 'teal', 'coral', 'pink', 'gray', 'blue', 'green', 'amber', 'red'].map(name => `c-${name}`);
  for (const name of ['sr-only', 'ti', 't', 'ts', 'th', 'box', 'arr', 'leader', 'node', ...ramps]) {
    assert.match(css, new RegExp(`\\.${name}(?![\\w-])`), `the host styles do not define .${name}`);
    assert.match(guide, new RegExp(`(?:\`|class="[^"]*\\b)${name}(?![\\w-])`), `the guide does not mention ${name}`);
  }
  const glyphs = parseGlyphs(fs.readFileSync(new URL('../public/vendor/tabler-icons.min.css', import.meta.url), 'utf8'));
  const icons = [...guide.matchAll(/\bti-([a-z0-9][a-z0-9-]*)/g)].map(m => m[1]);
  assert.ok(icons.length > 0);
  assert.deepEqual(icons.filter(name => !(name in glyphs)), [], 'the guide shows an icon the vendored font does not have');
});

test('the limits the guide states are the ones the frame enforces', () => {
  assert.ok(guide.includes(`up to ${HEIGHT_MAX} px`) && guide.includes(`Past that the content scrolls`));
  assert.ok(guide.includes(`text over ${PROMPT_MAX} characters`));
  assert.equal(ACTIVE_MS, 5000);
  assert.ok(guide.includes('within five seconds of a send'));
  assert.ok(guide.includes(`at most ${LINK_MAX} characters`));
});

test('the guide holds no em dash or en dash', () => {
  assert.doesNotMatch(guide, /[\u2013\u2014]/);
});
