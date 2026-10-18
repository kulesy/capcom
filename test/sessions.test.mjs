// Run with `npm test`. The session list and what a message does to it, over HTTP against the real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, cliCalls, request, signIn, start, until } from './harness.mjs';

const titles = list => list.map(r => r.title);

async function listing(s, token) {
  const sessions = (await request(s, 'GET', '/api/sessions', { headers: as(token) })).body();
  const archived = (await request(s, 'GET', '/api/archived', { headers: as(token) })).body().archived;
  return { sessions, archived };
}

test('a group lists its sessions by title with the emoji ones first, and every other list stays newest first', async () => {
  const s = await start({
    groups: [{ id: 'cg-work', name: 'Work' }],
    sessions: [
      { id: 'g1', title: 'zeta report', group: 'cg-work', ago: 1 },
      { id: 'g2', title: '🟨 yellow check', group: 'cg-work', ago: 2 },
      { id: 'g3', title: 'Alpha plan', group: 'cg-work', ago: 3 },
      { id: 'g4', title: '10 items', group: 'cg-work', ago: 4 },
      { id: 'g5', title: '2 items', group: 'cg-work', ago: 5 },
      { id: 'g6', title: '🛢️ oil', group: 'cg-work', ago: 6 },
      { id: 'p1', title: 'Zulu pinned', pinned: true, ago: 7 },
      { id: 'p2', title: 'Alpha pinned', pinned: true, ago: 8 },
      { id: 'u1', title: 'Zulu loose', ago: 9 },
      { id: 'u2', title: 'Alpha loose', ago: 10 },
    ],
  });
  const { token } = await signIn(s);
  const { sessions } = await listing(s, token);
  const work = titles(sessions.groups[0].sessions);
  assert.ok(['🛢️ oil', '🟨 yellow check'].every(t => work.slice(0, 2).includes(t)), work.join(' | '));
  assert.deepEqual(work.slice(2), ['2 items', '10 items', 'Alpha plan', 'zeta report']);
  assert.deepEqual(titles(sessions.pinned), ['Zulu pinned', 'Alpha pinned']);
  assert.deepEqual(titles(sessions.ungrouped), ['Zulu loose', 'Alpha loose']);
});

test('a message to an archived session brings it back to where it was, on the send that resumes it and on a later one', async () => {
  const s = await start({
    claude: true,
    groups: [{ id: 'cg-work', name: 'Work' }],
    sessions: [
      { id: 'live', title: 'Live one', group: 'cg-work', ago: 1 },
      { id: 'grouped', title: 'Archived in a group', group: 'cg-work', archived: true, ago: 2 },
      { id: 'pinned', title: 'Archived and pinned', pinned: true, archived: true, ago: 3 },
      { id: 'loose', title: 'Archived and loose', archived: true, ago: 4 },
    ],
  });
  const { token } = await signIn(s);
  const send = (id, text) => request(s, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text } });
  const resumes = id => cliCalls(s).filter(c => c.started?.[c.started.indexOf('--resume') + 1] === id);
  const said = text => cliCalls(s).some(c => c.user === text);
  const records = path.join(s.home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions', 'account', 'org');
  const desktop = () => fs.readdirSync(records).sort().map(name => fs.readFileSync(path.join(records, name), 'utf8'));
  const before = desktop();

  let now = await listing(s, token);
  assert.deepEqual(titles(now.sessions.groups[0].sessions), ['Live one']);
  assert.deepEqual(titles(now.sessions.pinned), []);
  assert.deepEqual(titles(now.sessions.ungrouped), []);
  assert.deepEqual(titles(now.archived).sort(), ['Archived and loose', 'Archived and pinned', 'Archived in a group']);

  const live = await send('live', 'a message to a session that was never archived');
  assert.equal(live.status, 200);
  assert.equal(live.body().unarchived, undefined);
  assert.equal(JSON.parse(fs.readFileSync(s.layout, 'utf8')).unarchived, undefined, 'nothing is written for a session that is not archived');

  const first = await send('grouped', 'the message that resumes it');
  assert.equal(first.status, 200);
  assert.equal(first.body().unarchived, true);
  await until(() => resumes('grouped').length === 1 && said('the message that resumes it'));
  now = await listing(s, token);
  assert.deepEqual(titles(now.sessions.groups[0].sessions), ['Archived in a group', 'Live one']);
  assert.deepEqual(titles(now.archived).sort(), ['Archived and loose', 'Archived and pinned']);

  const layout = JSON.parse(fs.readFileSync(s.layout, 'utf8'));
  fs.writeFileSync(s.layout, JSON.stringify({ ...layout, unarchived: layout.unarchived.filter(id => id !== 'grouped') }));
  now = await listing(s, token);
  assert.deepEqual(titles(now.sessions.groups[0].sessions), ['Live one'], 'archived again, as it would be if Desktop archived it again');
  const later = await send('grouped', 'a message to the chat that is already running');
  assert.equal(later.body().unarchived, true);
  await until(() => said('a message to the chat that is already running'));
  assert.equal(resumes('grouped').length, 1, 'the later message went to the process the first one started');
  now = await listing(s, token);
  assert.deepEqual(titles(now.sessions.groups[0].sessions), ['Archived in a group', 'Live one']);

  assert.equal((await send('pinned', 'and one that is pinned')).body().unarchived, true);
  assert.equal((await send('loose', 'and one that is in no group')).body().unarchived, true);
  now = await listing(s, token);
  assert.deepEqual(titles(now.sessions.pinned), ['Archived and pinned']);
  assert.deepEqual(titles(now.sessions.ungrouped), ['Archived and loose']);
  assert.deepEqual(now.archived, []);
  assert.deepEqual(desktop(), before, "Desktop's records are never written");
});

test('a message to a session archived in Capcom brings it back to where it was, whoever started it, and a later message writes nothing', async () => {
  const archivedAt = '2026-10-17T09:30:00.000Z';
  const s = await start({
    claude: true,
    groups: [{ id: 'cg-work', name: 'Work' }],
    sessions: [
      { id: 'live', title: 'Live one', group: 'cg-work', ago: 1 },
      { id: 'grouped', title: 'Archived in a group', group: 'cg-work', ago: 2 },
      { id: 'pinned', title: 'Archived and pinned', pinned: true, ago: 3 },
      { id: 'started', title: 'Started here and archived', source: 'capcom', ago: 4 },
      { id: 'terminal', title: 'Terminal session archived', source: 'cli', ago: 5 },
    ],
    layout: { archived: { grouped: archivedAt, pinned: archivedAt, started: archivedAt, terminal: archivedAt } },
  });
  const { token } = await signIn(s);
  const send = (id, text) => request(s, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text } });
  const said = text => cliCalls(s).some(c => c.user === text);
  const records = path.join(s.home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions', 'account', 'org');
  const desktop = () => fs.readdirSync(records).sort().map(name => fs.readFileSync(path.join(records, name), 'utf8'));
  const before = desktop();

  let now = await listing(s, token);
  assert.deepEqual(titles(now.sessions.groups[0].sessions), ['Live one']);
  assert.deepEqual([now.sessions.pinned, now.sessions.started, now.sessions.other].map(titles), [[], [], []]);
  assert.deepEqual(titles(now.archived).sort(), ['Archived and pinned', 'Archived in a group', 'Started here and archived', 'Terminal session archived']);

  const first = await send('grouped', 'the message that brings it back');
  assert.equal(first.body().unarchived, true);
  await until(() => said('the message that brings it back'));
  now = await listing(s, token);
  assert.deepEqual(titles(now.sessions.groups[0].sessions), ['Archived in a group', 'Live one']);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.layout, 'utf8')).archived, { pinned: archivedAt, started: archivedAt, terminal: archivedAt });
  assert.deepEqual(JSON.parse(fs.readFileSync(s.layout, 'utf8')).unarchived, ['grouped']);

  const written = fs.readFileSync(s.layout, 'utf8');
  const later = await send('grouped', 'and a message to it after that');
  assert.equal(later.status, 200);
  assert.equal(later.body().unarchived, undefined, 'the page is not told again');
  await until(() => said('and a message to it after that'));
  assert.equal(fs.readFileSync(s.layout, 'utf8'), written, 'nothing is written for a session that is not archived');

  for (const id of ['pinned', 'started', 'terminal']) assert.equal((await send(id, `a message to ${id}`)).body().unarchived, true, id);
  now = await listing(s, token);
  assert.deepEqual(titles(now.sessions.pinned), ['Archived and pinned']);
  assert.deepEqual(titles(now.sessions.started), ['Started here and archived']);
  assert.deepEqual(titles(now.sessions.other), ['Terminal session archived']);
  assert.deepEqual(now.archived, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.layout, 'utf8')).archived, {});
  assert.deepEqual(JSON.parse(fs.readFileSync(s.layout, 'utf8')).unarchived, ['grouped', 'pinned', 'started', 'terminal']);
  assert.deepEqual(desktop(), before, "Desktop's records are never written");
});

test('a message to an archived session still goes through when layout.json cannot be used, and the file is left as it was', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'archived', title: 'Archived one', archived: true, ago: 1 }] });
  const { token } = await signIn(s);
  fs.writeFileSync(s.layout, '{ not json');
  const sent = await request(s, 'POST', '/api/sessions/archived/send', { headers: as(token), json: { text: 'a message while the layout is broken' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.body().unarchived, undefined, 'the page is not told the session came back');
  await until(() => cliCalls(s).some(c => c.user === 'a message while the layout is broken'));
  await until(() => /Could not unarchive archived: layout\.json cannot be read/.test(s.errors()));
  assert.equal(fs.readFileSync(s.layout, 'utf8'), '{ not json');
});
