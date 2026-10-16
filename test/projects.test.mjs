// Run with `npm test`. Projects above groups over HTTP against the real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { as, request, signIn, start } from './harness.mjs';

const GROUPS = [{ id: 'cg-a', name: 'Reviewing' }, { id: 'cg-b', name: 'Backlog' }, { id: 'cg-c', name: 'Notes' }];
const SESSIONS = [
  { id: 's1', title: 'In reviewing', group: 'cg-a', ago: 1 },
  { id: 's2', title: 'In backlog', group: 'cg-b', ago: 2 },
  { id: 's3', title: 'Pinned', pinned: true, ago: 3 },
  { id: 's4', title: 'In no group', ago: 4 },
];

const post = (s, token, url, json, headers) => request(s, 'POST', `/api/layout/${url}`, { headers: { ...as(token), ...headers }, json });
const index = async (s, token) => (await request(s, 'GET', '/api/sessions', { headers: as(token) })).body();
const places = ix => Object.fromEntries(ix.groups.map(g => [g.id, g.project]));
const kept = ix => Object.fromEntries(ix.groups.map(g => [g.id, g.sessions.map(r => r.title)]));
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));

async function ready(mac) {
  const s = await start({ sessions: SESSIONS, groups: GROUPS, ...mac });
  return { s, ...(await signIn(s)) };
}

test('the list carries the projects in order, and says which project each group is in, with a gone project meaning the top level', async () => {
  const { s, token } = await ready({
    groups: [{ id: 'cg-a', name: 'Reviewing', project: 'cp-x' }, { id: 'cg-b', name: 'Backlog', project: 'cp-gone' }, { id: 'cg-c', name: 'Notes', project: 5 }],
    layout: { projects: [{ id: 'cp-y', name: 'Tina' }, { id: 'cp-x', name: 'Capcom' }] },
  });
  const before = fs.readFileSync(s.layout, 'utf8');
  const ix = await index(s, token);
  assert.deepEqual(ix.projects, [{ id: 'cp-y', name: 'Tina' }, { id: 'cp-x', name: 'Capcom' }]);
  assert.deepEqual(places(ix), { 'cg-a': 'cp-x', 'cg-b': null, 'cg-c': null });
  assert.deepEqual(kept(ix), { 'cg-a': ['In reviewing'], 'cg-b': ['In backlog'], 'cg-c': [] });
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before, 'reading the list changes nothing');
});

test('a layout file from before projects lists none and takes its first project', async () => {
  const { s, token } = await ready();
  const ix = await index(s, token);
  assert.deepEqual(ix.projects, []);
  assert.deepEqual(places(ix), { 'cg-a': null, 'cg-b': null, 'cg-c': null });
  assert.equal('projects' in onDisk(s), false);
  const made = await post(s, token, 'project/add', { name: 'Capcom' });
  assert.equal(made.status, 200);
  assert.deepEqual(onDisk(s).projects, [made.body()]);
  assert.deepEqual((await index(s, token)).projects, [made.body()]);
});

test('a project is added, renamed and deleted, and its name stays text', async () => {
  const { s, token } = await ready();
  const first = (await post(s, token, 'project/add', { name: ' Capcom ' })).body();
  const second = (await post(s, token, 'project/add', { name: '<img src=x onerror=alert(1)>' })).body();
  assert.deepEqual(first, { id: first.id, name: 'Capcom' });
  assert.match(first.id, /^cp-[0-9a-f-]{36}$/);
  assert.equal(second.name, '<img src=x onerror=alert(1)>');
  assert.deepEqual((await index(s, token)).projects, [first, second], 'in the order they were added');

  const renamed = await post(s, token, 'project/rename', { id: first.id, name: 'Capcom app' });
  assert.deepEqual(renamed.body(), { id: first.id, name: 'Capcom app' });
  assert.deepEqual((await index(s, token)).projects, [{ id: first.id, name: 'Capcom app' }, second]);

  const removed = await post(s, token, 'project/remove', { id: first.id });
  assert.equal(removed.status, 200);
  assert.deepEqual((await index(s, token)).projects, [second]);
});

test('a group is added inside a project or at the top level, and moves into a project, between projects and out again', async () => {
  const { s, token } = await ready();
  const [a, b] = [(await post(s, token, 'project/add', { name: 'A' })).body(), (await post(s, token, 'project/add', { name: 'B' })).body()];
  const inside = (await post(s, token, 'group/add', { name: 'Inside A', project: a.id })).body();
  const top = (await post(s, token, 'group/add', { name: 'Top' })).body();
  assert.deepEqual(inside, { id: inside.id, name: 'Inside A', project: a.id });
  assert.deepEqual(top, { id: top.id, name: 'Top' });
  assert.deepEqual(places(await index(s, token)), { 'cg-a': null, 'cg-b': null, 'cg-c': null, [inside.id]: a.id, [top.id]: null });

  assert.deepEqual((await post(s, token, 'group/move', { id: 'cg-a', project: a.id })).body(), { id: 'cg-a', name: 'Reviewing', project: a.id });
  await post(s, token, 'group/move', { id: 'cg-b', project: b.id });
  await post(s, token, 'group/move', { id: 'cg-a', project: b.id });
  await post(s, token, 'group/move', { id: inside.id, project: null });
  await post(s, token, 'group/move', { id: top.id });
  const ix = await index(s, token);
  assert.deepEqual(places(ix), { 'cg-a': b.id, 'cg-b': b.id, 'cg-c': null, [inside.id]: null, [top.id]: null });
  assert.deepEqual(ix.groups.map(g => g.id), ['cg-a', 'cg-b', 'cg-c', inside.id, top.id], 'a group keeps its place in the list when it moves');
  assert.deepEqual(kept(ix)['cg-a'], ['In reviewing'], 'and its sessions go with it');
});

test('deleting a project returns its groups to the top level and loses no group, session or pin', async () => {
  const { s, token } = await ready();
  const gone = (await post(s, token, 'project/add', { name: 'Gone' })).body();
  const stays = (await post(s, token, 'project/add', { name: 'Stays' })).body();
  const extra = (await post(s, token, 'group/add', { name: 'Extra', project: gone.id })).body();
  await post(s, token, 'group/move', { id: 'cg-a', project: gone.id });
  await post(s, token, 'group/move', { id: 'cg-b', project: stays.id });
  const before = onDisk(s);
  const ix = await index(s, token);
  assert.deepEqual(places(ix), { 'cg-a': gone.id, 'cg-b': stays.id, 'cg-c': null, [extra.id]: gone.id });

  assert.equal((await post(s, token, 'project/remove', { id: gone.id })).status, 200);
  const after = await index(s, token);
  assert.deepEqual(after.projects, [stays]);
  assert.deepEqual(places(after), { 'cg-a': null, 'cg-b': stays.id, 'cg-c': null, [extra.id]: null });
  assert.deepEqual(kept(after), { ...kept(ix) });
  assert.deepEqual(after.pinned.map(r => r.title), ['Pinned']);
  assert.deepEqual(after.ungrouped.map(r => r.title), ['In no group']);
  const disk = onDisk(s);
  assert.deepEqual(disk.assignments, before.assignments);
  assert.deepEqual(disk.pinned, before.pinned);
  assert.deepEqual(disk.groups.map(g => g.id), before.groups.map(g => g.id));
});

test('a refused edit says why and writes nothing', async () => {
  const { s, token } = await ready({ layout: { projects: [{ id: 'cp-x', name: 'Capcom' }] } });
  const before = fs.readFileSync(s.layout, 'utf8');
  const refusals = [
    ['project/add', {}, 400, /Give it a name/],
    ['project/add', { name: '   ' }, 400, /Give it a name/],
    ['project/add', { name: 7 }, 400, /Give it a name/],
    ['project/add', { name: 'x'.repeat(81) }, 400, /80 characters/],
    ['project/rename', { id: 'cp-x', name: '' }, 400, /Give it a name/],
    ['project/rename', { id: 'cp-none', name: 'Fine' }, 404, /Unknown project/],
    ['project/remove', {}, 404, /Unknown project/],
    ['project/remove', { id: 'cg-a' }, 404, /Unknown project/],
    ['group/add', { name: '' }, 400, /Give it a name/],
    ['group/add', { name: 'Fine', project: 'cp-none' }, 404, /Unknown project/],
    ['group/move', { id: 'cg-none', project: null }, 404, /Unknown group/],
    ['group/move', { id: 'cp-x' }, 404, /Unknown group/],
    ['group/move', { id: 'cg-a', project: 'cp-none' }, 404, /Unknown project/],
  ];
  for (const [url, body, status, message] of refusals) {
    const res = await post(s, token, url, body);
    assert.equal(res.status, status, `${url} ${JSON.stringify(body)}`);
    assert.match(res.body().error, message, `${url} ${JSON.stringify(body)}`);
  }
  const notJson = await request(s, 'POST', '/api/layout/project/add', { headers: as(token), form: { name: 'Fine' } });
  assert.equal(notJson.status, 400);
  assert.match(notJson.body().error, /JSON/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
});

test('a layout file that cannot be read is reported, and no project is written over it', async () => {
  const { s, token } = await ready();
  fs.writeFileSync(s.layout, '{ not json');
  assert.match((await index(s, token)).problem, /layout\.json cannot be read/);
  const res = await post(s, token, 'project/add', { name: 'Capcom' });
  assert.equal(res.status, 500);
  assert.match(res.body().error, /layout\.json cannot be read/);
  assert.equal(fs.readFileSync(s.layout, 'utf8'), '{ not json');
});

test('only a signed-in POST from this site changes anything, and a GET to these paths never does', async () => {
  const { s, token } = await ready({ layout: { projects: [{ id: 'cp-x', name: 'Capcom' }] } });
  const before = fs.readFileSync(s.layout, 'utf8');
  const urls = ['project/add', 'project/rename', 'project/remove', 'group/add', 'group/move'];
  const body = { id: 'cp-x', name: 'Changed', project: 'cp-x' };
  for (const url of urls) {
    assert.equal((await request(s, 'GET', `/api/layout/${url}?id=cp-x&name=Changed&project=cp-x`, { headers: as(token) })).status, 404, `GET ${url}`);
    assert.equal((await request(s, 'PUT', `/api/layout/${url}`, { headers: as(token), json: body })).status, 404, `PUT ${url}`);
    assert.equal((await request(s, 'POST', `/api/layout/${url}`, { json: body })).status, 401, `signed out ${url}`);
    assert.equal((await post(s, token, url, body, { origin: 'http://evil.example' })).status, 403, `cross-site ${url}`);
    assert.equal((await post(s, token, url, body, { origin: `http://localhost:${s.port + 1}` })).status, 403, `another port ${url}`);
  }
  assert.equal(fs.readFileSync(s.layout, 'utf8'), before);
  assert.equal((await post(s, token, 'project/add', { name: 'Fine' }, { origin: s.origin })).status, 200, 'the same origin is let through');
});
