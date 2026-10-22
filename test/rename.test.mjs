// Run with `npm test`. Renaming a session from Capcom's list: where the title is kept, which lists and routes show it, and what the
// route refuses. Over HTTP against the real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TITLE_MAX } from '../public/ui/tree.js';
import { as, request, signIn, start } from './harness.mjs';

const GROUPS = [{ id: 'cg-work', name: 'Work' }];
const SESSIONS = [
  { id: 'desk', title: 'Desktop session', ago: 1 },
  { id: 'term', title: 'Terminal session', source: 'cli', ago: 2 },
  { id: 'cap', title: 'Started here', source: 'capcom', ago: 3 },
  { id: 'bravo', title: 'Bravo', group: 'cg-work', ago: 4 },
  { id: 'charlie', title: 'Charlie', group: 'cg-work', ago: 5 },
  { id: 'delta', title: 'Delta', group: 'cg-work', ago: 6 },
  { id: 'pin', title: 'Pinned one', pinned: true, ago: 7 },
  { id: 'run', title: 'Nightly', routine: 'nightly', ago: 8 },
  { id: 'gone', title: 'Archived in Desktop', archived: true, ago: 9 },
];

const titles = list => list.map(r => r.title);
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const index = async (s, token) => (await request(s, 'GET', '/api/sessions', { headers: as(token) })).body();
const archived = async (s, token) => (await request(s, 'GET', '/api/archived', { headers: as(token) })).body().archived;
const post = (s, token, json, headers) => request(s, 'POST', '/api/layout/rename', { headers: { ...as(token), ...headers }, json });
const everyRow = ix => [...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.routines.flatMap(r => [r.latest, ...r.earlier]), ...ix.started, ...ix.ungrouped, ...ix.other];
const rowOf = (ix, id) => everyRow(ix).find(r => r.id === id);
const snapshot = dir => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).map(name => path.join(dir, name)).filter(file => fs.statSync(file).isFile()).sort().map(file => [file, fs.readFileSync(file, 'utf8')]));
const mac = s => ({ desktop: snapshot(path.join(s.home, 'Library')), transcripts: snapshot(path.join(s.home, '.claude')), started: fs.readFileSync(path.join(s.state, 'started.json'), 'utf8') });

async function ready(mine) {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, ...mine });
  return { s, ...(await signIn(s)) };
}

test('a rename shows in the list for a Desktop session, a terminal session and one started here, and nothing else changes', async () => {
  const { s, token } = await ready();
  const was = mac(s);
  const before = await index(s, token);
  for (const [id, title, place] of [['desk', 'Desktop, renamed', 'ungrouped'], ['term', 'Terminal, renamed', 'other'], ['cap', 'Started, renamed', 'started']]) {
    const res = await post(s, token, { id, title });
    assert.equal(res.status, 200, id);
    assert.deepEqual(res.body(), { id, group: null, pinned: false, title }, id);
    const row = rowOf(await index(s, token), id);
    assert.deepEqual([row.title, row.renamed], [title, true], id);
    assert.ok((await index(s, token))[place].some(r => r.id === id), `${id} stays in ${place}`);
  }
  assert.deepEqual(onDisk(s).titles, { desk: 'Desktop, renamed', term: 'Terminal, renamed', cap: 'Started, renamed' });
  const after = await index(s, token);
  assert.equal(rowOf(after, 'bravo').renamed, undefined, 'a session that was not renamed is not marked');
  assert.deepEqual(titles(after.ungrouped), ['Desktop, renamed']);
  assert.deepEqual(after.pinned.map(r => r.id), before.pinned.map(r => r.id));
  assert.deepEqual(mac(s), was, "Desktop's records, the transcripts and started.json are never written");
});

test('a session in a group that goes by title takes its place by its new title, A to Z, and stays in the group', async () => {
  const { s, token } = await ready({ sections: [{ id: 'cg-work', kind: 'manual', sortBy: 'alpha', ascending: false }] });
  const order = async () => titles((await index(s, token)).groups[0].sessions);
  assert.deepEqual(await order(), ['Bravo', 'Charlie', 'Delta']);
  await post(s, token, { id: 'delta', title: 'Alpha' });
  assert.deepEqual(await order(), ['Alpha', 'Bravo', 'Charlie']);
  await post(s, token, { id: 'bravo', title: 'zulu' });
  assert.deepEqual(await order(), ['Alpha', 'Charlie', 'zulu']);
  assert.deepEqual(onDisk(s).assignments, { bravo: 'cg-work', charlie: 'cg-work', delta: 'cg-work' });
});

test('a session in a group that goes by recency keeps its place under a new title, and stays in the group', async () => {
  const { s, token } = await ready();
  const order = async () => titles((await index(s, token)).groups[0].sessions);
  assert.deepEqual(await order(), ['Bravo', 'Charlie', 'Delta']);
  await post(s, token, { id: 'delta', title: 'Alpha' });
  assert.deepEqual(await order(), ['Bravo', 'Charlie', 'Alpha']);
  assert.deepEqual(onDisk(s).assignments, { bravo: 'cg-work', charlie: 'cg-work', delta: 'cg-work' });
});

test('a pinned session and a routine run keep their place and show the new title, and a routine keeps its name', async () => {
  const { s, token } = await ready();
  await post(s, token, { id: 'pin', title: 'Pinned, renamed' });
  await post(s, token, { id: 'run', title: 'Run, renamed' });
  const ix = await index(s, token);
  assert.deepEqual(titles(ix.pinned), ['Pinned, renamed']);
  assert.deepEqual(ix.routines.map(r => [r.name, r.latest.title]), [['nightly', 'Run, renamed']]);
  assert.deepEqual(onDisk(s).pinned, ['pin']);
});

test('an archived session shows its new title in the archive, and keeps it once it is archived or brought back', async () => {
  const { s, token } = await ready();
  assert.equal((await post(s, token, { id: 'gone', title: 'Archived, renamed' })).status, 200, 'a session in the archive can be renamed');
  assert.deepEqual(titles(await archived(s, token)), ['Archived, renamed']);
  await post(s, token, { id: 'desk', title: 'Desktop, renamed' });
  const archive = (id, flag) => request(s, 'POST', '/api/layout/archive', { headers: as(token), json: { id, archived: flag } });
  await archive('desk', true);
  assert.deepEqual(titles(await archived(s, token)).sort(), ['Archived, renamed', 'Desktop, renamed']);
  await archive('desk', false);
  assert.equal(rowOf(await index(s, token), 'desk').title, 'Desktop, renamed');
});

test("the messages route names the session by Capcom's title, so the open chat's header follows a rename", async () => {
  const { s, token } = await ready();
  const named = async id => (await request(s, 'GET', `/api/sessions/${id}/messages`, { headers: as(token) })).body().session.title;
  assert.equal(await named('desk'), 'Desktop session');
  await post(s, token, { id: 'desk', title: 'Desktop, renamed' });
  await post(s, token, { id: 'term', title: 'Terminal, renamed' });
  await post(s, token, { id: 'cap', title: 'Started, renamed' });
  assert.deepEqual([await named('desk'), await named('term'), await named('cap')], ['Desktop, renamed', 'Terminal, renamed', 'Started, renamed']);
});

test('a title is one line of text: markup stays text, spaces collapse and the controls that reorder text go', async () => {
  const { s, token } = await ready();
  const res = await post(s, token, { id: 'desk', title: '  <img src=x onerror=alert(1)>\n\tand   more ‮ ' });
  assert.equal(res.body().title, '<img src=x onerror=alert(1)> and more');
  assert.equal(rowOf(await index(s, token), 'desk').title, '<img src=x onerror=alert(1)> and more');
  assert.equal(onDisk(s).titles.desk, '<img src=x onerror=alert(1)> and more');
});

test("a title can run to the form's limit and no further, and a longer one is refused", async () => {
  const { s, token } = await ready();
  assert.equal((await post(s, token, { id: 'desk', title: 'x'.repeat(TITLE_MAX) })).status, 200);
  assert.equal((await post(s, token, { id: 'term', title: '🙂'.repeat(TITLE_MAX) })).status, 200);
  const res = await post(s, token, { id: 'cap', title: 'x'.repeat(TITLE_MAX + 1) });
  assert.equal(res.status, 400);
  assert.match(res.body().error, new RegExp(`${TITLE_MAX} characters`));
});

test("only a title that is a string with something in it is used, and a title is looked up by the session's own id only", async () => {
  const { s, token } = await ready({
    sessions: [...SESSIONS, { id: 'toString', title: 'Named like a method', ago: 10 }, { id: 'weird', title: 'Weird titles', ago: 11 }],
    layout: { titles: { desk: '', term: 5, cap: null, bravo: ['x'], charlie: {}, delta: ' \t ', weird: 'A real title', ghost: 'No such session' } },
  });
  const ix = await index(s, token);
  assert.deepEqual(['desk', 'term', 'cap', 'bravo', 'charlie', 'delta', 'toString', 'weird'].map(id => rowOf(ix, id).title), ['Desktop session', 'Terminal session', 'Started here', 'Bravo', 'Charlie', 'Delta', 'Named like a method', 'A real title']);
  assert.equal(rowOf(ix, 'weird').renamed, true);
  assert.equal(rowOf(ix, 'desk').renamed, undefined);
});

test('a layout file from before titles keeps every title as it was, and its first rename adds the titles', async () => {
  const { s, token } = await ready();
  assert.equal('titles' in onDisk(s), false);
  assert.deepEqual(titles((await index(s, token)).ungrouped), ['Desktop session']);
  assert.equal('titles' in onDisk(s), false, 'reading the list changes nothing');
  await post(s, token, { id: 'desk', title: 'Renamed' });
  assert.deepEqual(onDisk(s).titles, { desk: 'Renamed' });
  assert.deepEqual(onDisk(s).groups, GROUPS);
});

test('a title that is blank, too long or not a string is refused with a 400, and nothing is written', async () => {
  const { s, token } = await ready();
  const before = fs.readFileSync(s.layout, 'utf8');
  const cases = [
    [{ id: 'desk', title: '' }, /Give it a name/],
    [{ id: 'desk', title: '   \n\t' }, /Give it a name/],
    [{ id: 'desk', title: '​⠀' }, /Give it a name/],
    [{ id: 'desk', title: 'x'.repeat(TITLE_MAX + 1) }, /characters at most/],
    [{ id: 'desk', title: '🙂'.repeat(TITLE_MAX + 1) }, /characters at most/],
    [{ id: 'desk' }, /Give it a name/],
    [{ id: 'desk', title: null }, /Give it a name/],
    [{ id: 'desk', title: 5 }, /Give it a name/],
    [{ id: 'desk', title: ['Renamed'] }, /Give it a name/],
    [{ id: 'desk', title: { text: 'Renamed' } }, /Give it a name/],
  ];
  for (const [body, message] of cases) {
    const res = await post(s, token, body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.match(res.body().error, message, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('a session id that is missing, malformed or unknown is refused, and nothing is written', async () => {
  const { s, token } = await ready();
  const before = fs.readFileSync(s.layout, 'utf8');
  for (const id of [undefined, null, 5, '', 'two words', '../etc', ['desk'], { id: 'desk' }]) {
    const res = await post(s, token, { id, title: 'Renamed' });
    assert.equal(res.status, 400, JSON.stringify(id));
    assert.match(res.body().error, /Which session/, JSON.stringify(id));
  }
  const none = await post(s, token, { id: 'no-such-session', title: 'Renamed' });
  assert.equal(none.status, 404);
  assert.match(none.body().error, /No session with that id/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('a body that is not JSON is refused with a 400, as the other layout routes do, and nothing is written', async () => {
  const { s, token } = await ready();
  const before = fs.readFileSync(s.layout, 'utf8');
  const form = await request(s, 'POST', '/api/layout/rename', { headers: as(token), form: { id: 'desk', title: 'Renamed' } });
  assert.equal(form.status, 400);
  assert.match(form.body().error, /JSON/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('only a signed-in POST from this site renames, and a GET to the route never does', async () => {
  const { s, token } = await ready();
  const before = fs.readFileSync(s.layout, 'utf8');
  const body = { id: 'desk', title: 'Renamed' };
  assert.equal((await request(s, 'GET', '/api/layout/rename?id=desk&title=Renamed', { headers: as(token) })).status, 404, 'GET');
  assert.equal((await request(s, 'PUT', '/api/layout/rename', { headers: as(token), json: body })).status, 404, 'PUT');
  assert.equal((await request(s, 'POST', '/api/layout/rename', { json: body })).status, 401, 'signed out');
  assert.equal((await post(s, token, body, { origin: 'http://evil.example' })).status, 403, 'cross-site');
  assert.equal((await post(s, token, body, { origin: `http://localhost:${s.port + 1}` })).status, 403, 'another port');
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  assert.equal((await post(s, token, body, { origin: s.origin })).status, 200, 'the same origin is let through');
  assert.equal(onDisk(s).titles.desk, 'Renamed');
});

test('a layout file that cannot be read is reported, and no title is written over it', async () => {
  const { s, token } = await ready();
  for (const text of ['{ not json', JSON.stringify({ groups: [], titles: [] }), JSON.stringify({ groups: [], titles: 'Renamed' })]) {
    fs.writeFileSync(s.layout, text);
    assert.match((await index(s, token)).problem, /layout\.json cannot be read/, text);
    const res = await post(s, token, { id: 'desk', title: 'Renamed' });
    assert.equal(res.status, 500, text);
    assert.match(res.body().error, /layout\.json cannot be read/, text);
    assert.equal(fs.readFileSync(s.layout, 'utf8'), text, 'the file is as it was');
  }
});
