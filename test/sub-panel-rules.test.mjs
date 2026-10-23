// Run with `npm test`. What the Sub sessions tab, the header button that opens it and a folded family's row decide with no page: when a chat has the tab,
// the lines and parts in it, the words on the button and for what a session waits on, and which sessions the page has to ask the server about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RECENT_MS } from '../public/ui/group-rules.js';
import {
  batchesOf, drawnRows, familyNote, linesOf, MAX_IDS, partOf, partsOf, pendingLine, splitWaiting, staleIds, stampOf, subsButtonName, subsOffered, subsStatus,
  subStatusOn, summaryLine,
} from '../public/ui/sub-panel-rules.js';

const NOW = Date.parse('2026-10-23T06:00:00.000Z');
const MINUTE = 60_000;
const row = (id, via, state, ago, extra) => ({ id, via, state, dot: null, archived: false, lastActivityAt: NOW - ago, ...extra });
const ids = list => list.map(r => r.id);
const shape = nodes => nodes.map(n => (n.subs.length ? [n.row.id, shape(n.subs)] : n.row.id));
const WORK = 'chat-of-work';

// Under `top`: kid (waiting) with grand (working) below, and quiet (idle). `loner` has nothing below. Work is a group of two sessions, one with a child, and its chat.
const index = (features = { subStatus: true }) => ({
  features,
  pinned: [],
  groups: [{
    id: 'cg-work', name: 'Work', session: { id: WORK }, archived: 3,
    sessions: [
      row('w1', null, 'idle', 5 * MINUTE, { group: 'cg-work', children: [row('w1a', 'w1', 'waiting', MINUTE, { dot: 'awaiting' })] }),
      row('w2', null, 'working', 2 * MINUTE, { group: 'cg-work', dot: 'running' }),
    ],
  }],
  routines: [],
  started: [],
  ungrouped: [
    row('top', null, 'idle', 5 * MINUTE, {
      children: [
        row('kid', 'top', 'waiting', 4 * MINUTE, { dot: 'awaiting' }),
        row('grand', 'kid', 'working', MINUTE, { dot: 'running' }),
        row('quiet', 'top', 'idle', 3 * RECENT_MS),
      ],
    }),
    row('loner', null, 'idle', 9 * MINUTE),
  ],
  other: [],
});

test('only a server that says it can summarise sessions has the tab', () => {
  assert.equal(subStatusOn(index()), true);
  assert.equal(subStatusOn(index({ groupSessions: true })), false);
  assert.equal(subStatusOn(index({})), false);
  assert.equal(subStatusOn({ ...index(), features: undefined }), false);
  assert.equal(subStatusOn(null), false);
});

test('a chat has the tab when a session shows under it, a group\'s chat always has it, and an older server\'s chats never do', () => {
  assert.equal(subsOffered(index(), 'top'), true);
  assert.equal(subsOffered(index(), 'kid'), true, 'a session with one below it');
  assert.equal(subsOffered(index(), 'quiet'), false);
  assert.equal(subsOffered(index(), 'loner'), false);
  assert.equal(subsOffered(index(), WORK), true);
  assert.equal(subsOffered(index({ groupSessions: true }), 'top'), false);
  assert.equal(subsOffered(index({ groupSessions: true }), WORK), false);
  assert.equal(subsOffered(index(), null), false);
  assert.equal(subsOffered(index(), 'nobody'), false);
  assert.equal(subsOffered(null, 'top'), false);
  const archivedBelow = index();
  archivedBelow.ungrouped[1].children = [row('gone', 'loner', 'idle', MINUTE, { archived: true })];
  assert.equal(subsOffered(archivedBelow, 'loner'), true, 'an archived row the list still shows counts as one below');
});

test('an ordinary chat lists the sessions nested under it with the ones that wait on you first, and a group\'s chat lists its sessions with their families', () => {
  assert.deepEqual(shape(linesOf(index(), 'top', NOW)), [['kid', ['grand']], 'quiet']);
  assert.deepEqual(shape(linesOf(index(), 'kid', NOW)), ['grand']);
  assert.deepEqual(linesOf(index(), 'loner', NOW), []);
  assert.deepEqual(shape(linesOf(index(), WORK, NOW)), [['w1', ['w1a']], 'w2'], 'w1 has a session waiting under it, so it comes before the one that is working');
});

test('lines fall in the part of the tab that the most urgent session in them belongs to', () => {
  const lines = linesOf(index(), 'top', NOW);
  assert.deepEqual(lines.map(n => partOf(n, NOW)), ['needs', 'idle']);
  const parts = partsOf(lines, NOW);
  assert.deepEqual(Object.fromEntries(Object.entries(parts).map(([key, nodes]) => [key, ids(nodes.map(n => n.row))])), { needs: ['kid'], working: [], recent: [], idle: ['quiet'] });
  const group = partsOf(linesOf(index(), WORK, NOW), NOW);
  assert.deepEqual([group.needs, group.working].map(nodes => ids(nodes.map(n => n.row))), [['w1'], ['w2']], 'a family is judged by its most urgent session');
});

test('the button counts every session below the chat, or all of a group\'s, and says how many wait on you', () => {
  assert.deepEqual(subsStatus(index(), 'top', NOW), { total: 3, needs: 1 });
  assert.deepEqual(subsStatus(index(), 'kid', NOW), { total: 1, needs: 0 });
  assert.deepEqual(subsStatus(index(), WORK, NOW), { total: 3, needs: 1 });
  assert.deepEqual(subsStatus(index(), 'loner', NOW), { total: 0, needs: 0 });
  assert.deepEqual(subsStatus(null, 'top', NOW), { total: 0, needs: 0 });
  assert.equal(subsButtonName({ total: 3, needs: 1 }), 'Sub sessions: 3, 1 waiting on you');
  assert.equal(subsButtonName({ total: 1, needs: 0 }), 'Sub sessions: 1');
  assert.equal(subsButtonName({ total: 4, needs: 4 }), 'Sub sessions: 4, 4 waiting on you');
});

test('the line at the top of the tab is the roll-up, or the words a group\'s status always had', () => {
  assert.equal(summaryLine(index(), 'top', NOW), '3 sub sessions, 1 waiting on you, 1 working');
  assert.equal(summaryLine(index(), 'loner', NOW), '');
  assert.equal(summaryLine(index(), WORK, NOW), '1 needs you · 1 working · 1 recent · 3 more');
});

test('what a session waits on names the tool and what it would do, or says it is a question, and counts the rest', () => {
  assert.equal(pendingLine([{ tool: 'Bash', summary: 'npm test' }]), 'Waiting for you to approve Bash: npm test');
  assert.equal(pendingLine([{ tool: 'Bash', summary: 'npm test' }, { tool: 'Edit', summary: 'a.js' }]), 'Waiting for you to approve Bash: npm test (and 1 more)');
  assert.equal(pendingLine([{ tool: 'Bash', summary: '' }]), 'Waiting for you to approve Bash');
  assert.equal(pendingLine([{ tool: 'AskUserQuestion', summary: 'Which one?' }]), 'Waiting for your answer');
  assert.equal(pendingLine([{ tool: 'AskUserQuestion', summary: 'Which one?' }, { tool: 'Bash', summary: 'ls' }, { tool: 'Bash', summary: 'pwd' }]), 'Waiting for your answer (and 2 more)');
  assert.equal(pendingLine([{ tool: '', summary: '' }]), 'Waiting for you to approve a request');
  assert.equal(pendingLine([]), '');
  assert.equal(pendingLine(undefined), '');
  assert.equal(pendingLine('Bash'), '');
});

test('a summary is read again for a session that has moved or changed state, and only for the sessions drawn', () => {
  const a = row('a', null, 'idle', MINUTE);
  const b = row('b', null, 'waiting', 2 * MINUTE);
  const kept = new Map([['a', { stamp: stampOf(a) }], ['b', { stamp: stampOf(b) }]]);
  assert.deepEqual(staleIds([a, b], kept), []);
  assert.deepEqual(staleIds([a, b], new Map()), ['a', 'b']);
  assert.deepEqual(staleIds([{ ...a, lastActivityAt: a.lastActivityAt + 1 }, b], kept), ['a'], 'it moved');
  assert.deepEqual(staleIds([a, { ...b, state: 'idle' }], kept), ['b'], 'it was answered, so it waits on nothing now');
  assert.deepEqual(staleIds([a, a, b], new Map([['b', { stamp: stampOf(b) }]])), ['a'], 'each once');
  assert.deepEqual(staleIds([], kept), []);
  assert.notEqual(stampOf(a), stampOf({ ...a, state: 'working' }));
});

test('the sessions drawn are the top lines and the lines inside each that is open, at every depth', () => {
  const lines = linesOf(index(), 'top', NOW);
  assert.deepEqual(ids(drawnRows(lines, {})), ['kid', 'quiet']);
  assert.deepEqual(ids(drawnRows(lines, { kid: true })), ['kid', 'grand', 'quiet']);
  assert.deepEqual(ids(drawnRows(lines, { grand: true })), ['kid', 'quiet'], 'a line inside one that is shut is not drawn');
  assert.deepEqual(ids(drawnRows(lines, { kid: true, grand: true, quiet: true })), ['kid', 'grand', 'quiet']);
});

test('ids go to the server in batches that it will answer', () => {
  const some = n => Array.from({ length: n }, (_, i) => `s${i}`);
  assert.equal(MAX_IDS, 60);
  assert.deepEqual(batchesOf([]), []);
  assert.deepEqual(batchesOf(some(60)).map(b => b.length), [60]);
  assert.deepEqual(batchesOf(some(61)).map(b => b.length), [60, 1]);
  assert.deepEqual(batchesOf(some(150)).map(b => b.length), [60, 60, 30]);
  assert.deepEqual(batchesOf(some(5), 2), [['s0', 's1'], ['s2', 's3'], ['s4']]);
});

test('the words waiting on you are cut out of a roll-up so the page can colour them', () => {
  assert.deepEqual(splitWaiting('3 sub sessions, 1 waiting on you, 2 working'), ['3 sub sessions, 1 ', 'waiting on you', ', 2 working']);
  assert.deepEqual(splitWaiting('2 sub sessions'), ['2 sub sessions', '', '']);
  assert.deepEqual(splitWaiting(''), ['', '', '']);
});

test('a folded family takes the mark of the most urgent session under it, with words for its arrow, only when that outranks its own', () => {
  const top = index().ungrouped[0];
  assert.deepEqual(familyNote(top, NOW), { dot: 'awaiting', label: '3 nested sessions, 1 waiting on you' });
  const running = { ...top, children: [row('busy', 'top', 'working', MINUTE, { dot: 'running' }), row('quiet', 'top', 'idle', 3 * RECENT_MS)] };
  assert.deepEqual(familyNote(running, NOW), { dot: 'running', label: '2 nested sessions, 1 working' });
  assert.equal(familyNote({ ...top, dot: 'awaiting' }, NOW), null, 'the head already shows the most urgent mark');
  assert.equal(familyNote({ ...top, dot: 'error', children: [row('x', 'top', 'working', MINUTE, { dot: 'running' })] }, NOW), null, 'a failure outranks a run');
  assert.equal(familyNote({ ...top, children: [row('x', 'top', 'idle', MINUTE)] }, NOW), null);
  assert.equal(familyNote(index().ungrouped[1], NOW), null, 'nothing nested');
  const unread = { ...top, children: [row('x', 'top', 'idle', MINUTE, { dot: 'ready' })] };
  assert.deepEqual(familyNote(unread, NOW), { dot: 'ready', label: '1 nested session, some unread' });
  const asks = { ...top, children: [row('x', 'top', 'idle', MINUTE, { dot: 'awaiting' })] };
  assert.deepEqual(familyNote(asks, NOW), { dot: 'awaiting', label: '1 nested session, some need input' });
});
