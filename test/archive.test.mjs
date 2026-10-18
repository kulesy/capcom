// Run with `npm test`. Archiving from Capcom: which sessions the list and the archive show, and what wins over Desktop's flag.
// Over HTTP against the real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, request, signIn, start, until } from './harness.mjs';

const MINUTE = 60_000;
const minutesAgo = minutes => new Date(Date.now() - minutes * MINUTE).toISOString();
const titles = list => list.map(r => r.title);
const onDisk = s => JSON.parse(fs.readFileSync(s.layout, 'utf8'));
const index = async (s, token) => (await request(s, 'GET', '/api/sessions', { headers: as(token) })).body();
const archive = async (s, token) => (await request(s, 'GET', '/api/archived', { headers: as(token) })).body().archived;
const record = (s, id) => path.join(s.home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions', 'account', 'org', `local_${id}.json`);

// The titles in each place the list shows a session.
const places = ix => ({
  routines: ix.routines.map(r => r.latest.title),
  pinned: titles(ix.pinned),
  groups: Object.fromEntries(ix.groups.map(g => [g.id, titles(g.sessions)])),
  started: titles(ix.started),
  ungrouped: titles(ix.ungrouped),
  other: titles(ix.other),
});

test('the archive lists the newest first, by when Capcom archived a session or when Desktop last changed the record of one it archived', async () => {
  const s = await start({
    sessions: [
      { id: 'd-old', title: 'Desktop, a week ago', archived: true, archivedAgo: 7 * 24 * 60, ago: 1 },
      { id: 'd-new', title: 'Desktop, 2 minutes ago', archived: true, archivedAgo: 2, ago: 600 },
      { id: 'c-old', title: 'Capcom, 60 minutes ago', ago: 2 },
      { id: 'c-new', title: 'Capcom, 1 minute ago', ago: 800 },
      { id: 'started', title: 'Started here, 30 minutes ago', source: 'capcom', ago: 3 },
      { id: 'terminal', title: 'Terminal, 90 minutes ago', source: 'cli', ago: 4 },
      { id: 'kept', title: 'Not archived', ago: 5 },
    ],
    layout: { archived: { 'c-old': minutesAgo(60), 'c-new': minutesAgo(1), started: minutesAgo(30), terminal: minutesAgo(90) } },
  });
  const { token } = await signIn(s);
  const listed = await archive(s, token);
  assert.deepEqual(titles(listed), ['Capcom, 1 minute ago', 'Desktop, 2 minutes ago', 'Started here, 30 minutes ago', 'Capcom, 60 minutes ago', 'Terminal, 90 minutes ago', 'Desktop, a week ago']);
  assert.ok(listed.every(r => r.archived === true));
  const times = Object.fromEntries(listed.map(r => [r.id, r.archivedAt]));
  const kept = onDisk(s).archived;
  for (const id of ['c-old', 'c-new', 'started', 'terminal']) assert.equal(times[id], Date.parse(kept[id]), `${id} is dated by Capcom's time`);
  assert.ok(Math.abs(times['d-new'] - (Date.now() - 2 * MINUTE)) < 30_000, "and a Desktop session by its record's file time");
  assert.deepEqual(places(await index(s, token)), { routines: [], pinned: [], groups: {}, started: [], ungrouped: ['Not archived'], other: [] });
});

test("a session in neither of Capcom's lists follows Desktop's flag, and Capcom's choice wins when they differ, in either direction", async () => {
  const s = await start({
    sessions: [
      { id: 'follows-on', title: 'Archived in Desktop', archived: true, ago: 1 },
      { id: 'follows-off', title: 'Not archived in Desktop', ago: 2 },
      { id: 'hidden', title: 'Archived here, not in Desktop', ago: 3 },
      { id: 'shown', title: 'Brought back here, archived in Desktop', archived: true, ago: 4 },
      { id: 'both', title: 'Named in both lists', archived: true, ago: 5 },
    ],
    layout: { archived: { hidden: minutesAgo(5), both: minutesAgo(5) }, unarchived: ['shown', 'both'] },
  });
  const { token } = await signIn(s);
  assert.deepEqual(places(await index(s, token)).ungrouped, ['Not archived in Desktop', 'Brought back here, archived in Desktop']);
  assert.deepEqual(titles(await archive(s, token)).sort(), ['Archived here, not in Desktop', 'Archived in Desktop', 'Named in both lists']);
});

test("Capcom's choice still wins when Desktop's flag changes to the other way afterwards", async () => {
  const s = await start({
    sessions: [
      { id: 'hidden', title: 'Archived here and in Desktop', archived: true, ago: 1 },
      { id: 'shown', title: 'Brought back here, not archived in Desktop', ago: 2 },
      { id: 'follows', title: 'Follows Desktop', ago: 3 },
    ],
    layout: { archived: { hidden: minutesAgo(5) }, unarchived: ['shown'] },
  });
  const { token } = await signIn(s);
  assert.deepEqual(places(await index(s, token)).ungrouped, ['Brought back here, not archived in Desktop', 'Follows Desktop']);
  assert.deepEqual(titles(await archive(s, token)), ['Archived here and in Desktop']);

  const setFlag = (id, isArchived) => fs.writeFileSync(record(s, id), JSON.stringify({ ...JSON.parse(fs.readFileSync(record(s, id), 'utf8')), isArchived }));
  setFlag('hidden', false);
  setFlag('shown', true);
  setFlag('follows', true);
  // Desktop's records are read at most every four seconds, and the session that has no choice of Capcom's shows when they have been.
  await until(async () => (await archive(s, token)).some(r => r.id === 'follows'), 8000);
  assert.deepEqual(places(await index(s, token)).ungrouped, ['Brought back here, not archived in Desktop']);
  assert.deepEqual(titles(await archive(s, token)).sort(), ['Archived here and in Desktop', 'Follows Desktop']);
});

test('an archive time that is not a date still archives the session, dated by its last activity instead', async () => {
  const s = await start({
    sessions: [
      { id: 'odd', title: 'Hand-edited time', source: 'capcom', ago: 90 },
      { id: 'text', title: 'Time that is a word', source: 'cli', ago: 120 },
    ],
    layout: { archived: { odd: 'last Tuesday', text: true } },
  });
  const { token } = await signIn(s);
  assert.deepEqual(places(await index(s, token)), { routines: [], pinned: [], groups: {}, started: [], ungrouped: [], other: [] });
  const listed = await archive(s, token);
  assert.deepEqual(titles(listed), ['Hand-edited time', 'Time that is a word']);
  for (const [r, minutes] of [[listed[0], 90], [listed[1], 120]]) assert.ok(Math.abs(r.archivedAt - (Date.now() - minutes * MINUTE)) < 30_000, r.title);
});
