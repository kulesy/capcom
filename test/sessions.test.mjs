// Run with `npm test`. The session list, what a message does to it and the turn a working row shows, over HTTP against the real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findRow } from '../public/ui/tree.js';
import { as, cliCalls, listen, request, signIn, start, until } from './harness.mjs';

const titles = list => list.map(r => r.title);

async function listing(s, token) {
  const sessions = (await request(s, 'GET', '/api/sessions', { headers: as(token) })).body();
  const archived = (await request(s, 'GET', '/api/archived', { headers: as(token) })).body().archived;
  return { sessions, archived };
}

test('every list goes newest first when Desktop holds no sort for it, whatever the titles say', async () => {
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
  assert.deepEqual(titles(sessions.groups[0].sessions), ['zeta report', '🟨 yellow check', 'Alpha plan', '10 items', '2 items', '🛢️ oil']);
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

// ---- the turn each working row shows ---------------------------------------------------------------------------

const MINUTE = 60_000;
const rowOf = async (s, token, id) => findRow((await request(s, 'GET', '/api/sessions', { headers: as(token) })).body(), id);
const turnKeys = row => Object.keys(row).filter(key => key.startsWith('turn'));
const send = (s, token, id, text) => request(s, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text } });

// A transcript Desktop or a terminal wrote. `ago` is in minutes, and a session made with the same `ago` has the same last write
// before and after, because the server keeps the times it read first for a few seconds.
const entry = (ago, entrypoint, extra) => ({ cwd: '/test-folder', isSidechain: false, entrypoint, timestamp: new Date(Date.now() - ago * MINUTE).toISOString(), ...extra });
const prompted = (ago, entrypoint = 'cli') => entry(ago, entrypoint, { type: 'user', message: { role: 'user', content: 'Check the build' } });
const answered = (ago, entrypoint = 'cli') => entry(ago, entrypoint, { type: 'assistant', message: { id: 'end', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Passed.' }] } });

const transcriptOf = (s, id) => path.join(s.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);

function rewrite(s, id, ago, entries) {
  const file = transcriptOf(s, id);
  fs.writeFileSync(file, entries.map(e => `${JSON.stringify(e)}\n`).join(''));
  const at = (Date.now() - ago * MINUTE) / 1000;
  fs.utimesSync(file, at, at);
}

test('a chat Capcom is working on lists when its turn began and how long it has run, and neither once the turn ends', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'busy', title: 'Busy one', ago: 1 }] });
  const { token } = await signIn(s);
  const asked = Date.now();
  await send(s, token, 'busy', 'keep going');
  await until(() => cliCalls(s).some(c => c.user === 'keep going'));
  const first = await rowOf(s, token, 'busy');
  const listed = Date.now();
  assert.equal(first.state, 'working');
  assert.ok(first.turnStartedAt >= asked && first.turnStartedAt <= listed, 'it began when the message was sent');
  assert.ok(first.turnMs >= 0 && first.turnMs <= listed - first.turnStartedAt, 'its age was read when the list was');

  await new Promise(resolve => setTimeout(resolve, 100));
  const later = await rowOf(s, token, 'busy');
  assert.equal(later.turnStartedAt, first.turnStartedAt);
  assert.ok(later.turnMs >= first.turnMs + 50);

  await send(s, token, 'busy', 'finish the turn');
  await until(async () => (await rowOf(s, token, 'busy')).state === 'idle');
  assert.deepEqual(turnKeys(await rowOf(s, token, 'busy')), []);
});

test('a chat Capcom is working on lists its own turn, though its transcript holds one that another app left open', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'mixed', title: 'Mixed one', ago: 1 }] });
  const { token } = await signIn(s);
  rewrite(s, 'mixed', 1, [prompted(3, 'claude-desktop')]);
  const asked = Date.now();
  await send(s, token, 'mixed', 'keep going');
  await until(() => cliCalls(s).some(c => c.user === 'keep going'));
  const row = await rowOf(s, token, 'mixed');
  assert.equal(row.state, 'working');
  assert.ok(row.turnStartedAt >= asked, "Desktop's prompt from three minutes ago does not set it");
});

test('a chat another app runs lists the start of its open turn and reads as active for ten minutes after its last write, though two make a chat idle', async () => {
  const s = await start({ sessions: [{ id: 'term', title: 'Terminal one', source: 'cli', ago: 5 }, { id: 'desk', title: 'Desktop one', ago: 9 }] });
  const { token } = await signIn(s);
  const typed = prompted(5);
  const asked = prompted(9, 'claude-desktop');
  rewrite(s, 'term', 5, [typed]);
  rewrite(s, 'desk', 9, [asked]);
  for (const [id, began, minutes] of [['term', typed, 5], ['desk', asked, 9]]) {
    const row = await rowOf(s, token, id);
    assert.equal(row.state, 'active', id);
    assert.equal(row.turnStartedAt, Date.parse(began.timestamp), id);
    assert.ok(row.turnMs >= minutes * MINUTE && row.turnMs < minutes * MINUTE + 30_000, `${id} has run ${row.turnMs} ms`);
  }
});

test('an idle row, and a row whose turn has finished, carry no turn', async () => {
  const s = await start({ sessions: [{ id: 'quiet', title: 'Quiet one', ago: 30 }, { id: 'done', title: 'Done one', source: 'cli', ago: 1 }] });
  const { token } = await signIn(s);
  rewrite(s, 'done', 1, [prompted(2), answered(1.5)]);
  for (const [id, state] of [['quiet', 'idle'], ['done', 'active']]) {
    const row = await rowOf(s, token, id);
    assert.equal(row.state, state, id);
    assert.deepEqual(turnKeys(row), [], id);
  }
});

test('a transcript last written more than ten minutes ago carries no turn, though its last entry is a prompt', async () => {
  const s = await start({ sessions: [{ id: 'old', title: 'Old one', source: 'cli', ago: 11 }] });
  const { token } = await signIn(s);
  rewrite(s, 'old', 11, [prompted(11)]);
  const row = await rowOf(s, token, 'old');
  assert.equal(row.state, 'idle');
  assert.deepEqual(turnKeys(row), []);
});

test('a chat that is open lists the turn another app begins in it at once, though the list still holds the write its transcript had 30 minutes ago', async () => {
  const s = await start({ sessions: [{ id: 'open', title: 'Open one', source: 'cli', ago: 30 }] });
  const { token } = await signIn(s);
  rewrite(s, 'open', 30, [prompted(31), answered(30)]);
  assert.deepEqual(turnKeys(await rowOf(s, token, 'open')), [], 'its last turn has ended');

  const viewer = listen(s, token, 'open');
  await until(() => viewer.events.length);
  // The server keeps the last write it read for a few seconds, so the list is still on the one from 30 minutes ago.
  const prompt = prompted(0);
  fs.appendFileSync(transcriptOf(s, 'open'), `${JSON.stringify(prompt)}\n`);
  const row = await rowOf(s, token, 'open');
  assert.equal(row.turnStartedAt, Date.parse(prompt.timestamp));
  assert.ok(row.turnMs >= 0 && row.turnMs < 30_000, `it has run ${row.turnMs} ms`);
  viewer.close();
});
