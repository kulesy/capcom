// Run with `npm test`. The session list and what a message does to it, over HTTP against the real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { as, request, signIn, start } from './harness.mjs';

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
