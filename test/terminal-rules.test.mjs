// Run with `npm test`. What the terminal panel and the code blocks decide with no page: which blocks have a Run button and what it runs,
// the blocks it refuses, when the prompt box is in command mode, how the input recalls commands, and how the page joins a run's output
// with the summaries the server sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendChunks, bangMode, endedAloud, ending, hasHiddenCharacters, historyOf, inHome, joinBash, KEEP, landedRuns, lastRunning,
  leaveBang, mergeOutput, pendingBangs, recall, replaceRuns, runnableBlock, runOfItem, textOf, took, upsertRun,
} from '../public/ui/terminal-rules.js';

const run = (id, extra = {}) => ({ id, key: id, command: 'ls', cwd: '/h/x', source: 'panel', startedAt: 1000, endedAt: null, exitCode: null, signal: null, stopped: false, running: true, truncated: false, delivered: null, output: [], pending: false, ...extra });
const out = text => ({ stream: 'out', text });

test('a bash, sh, zsh or shell block runs as written, whatever its length', () => {
  for (const lang of ['bash', 'sh', 'zsh', 'shell', 'BASH']) assert.deepEqual(runnableBlock(lang, 'ls -la'), { command: 'ls -la', hidden: false }, lang);
  assert.equal(runnableBlock('bash', 'cd app\nnpm test\n').command, 'cd app\nnpm test');
  assert.equal(runnableBlock('bash', '# list\nls\n').command, '# list\nls');
});

test('a block in another language, or an empty one, has no Run button', () => {
  for (const lang of ['python', 'js', 'json', 'diff', 'yaml', 'bash-session', 'shell-session']) assert.equal(runnableBlock(lang, 'ls'), null, lang);
  assert.equal(runnableBlock('bash', ''), null);
  assert.equal(runnableBlock('bash', '  \n\n'), null);
  assert.equal(runnableBlock('', ''), null);
  assert.equal(runnableBlock('bash', undefined), null);
});

test('a block with no language runs when it holds exactly one line that is not empty', () => {
  assert.equal(runnableBlock('', 'echo hello from the panel').command, 'echo hello from the panel');
  assert.equal(runnableBlock('', '\n  ls -la  \n\n').command, 'ls -la');
  assert.equal(runnableBlock('', 'cd app\nnpm test'), null);
  assert.equal(runnableBlock(undefined, 'pwd').command, 'pwd');
});

test('a console block runs its "$ " lines without the prompt, and its output is not run', () => {
  assert.equal(runnableBlock('console', '$ ls\nREADME.md\nserver.mjs').command, 'ls');
  assert.equal(runnableBlock('console', '$ cd app\n$ npm test\n> ok').command, 'cd app\nnpm test');
  assert.equal(runnableBlock('console', '  $ pwd').command, 'pwd', 'an indented prompt still counts');
  assert.equal(runnableBlock('console', 'README.md\nserver.mjs'), null, 'a console block of output alone is not a command');
  assert.equal(runnableBlock('console', '$ \nout'), null, 'an empty prompt is not a command');
});

test('a console command that ends in a backslash takes the next line as its own', () => {
  assert.equal(runnableBlock('console', '$ docker run \\\n  -it app\nstarted').command, 'docker run \\\n  -it app');
  assert.equal(runnableBlock('console', '$ echo a \\').command, 'echo a \\', 'a backslash on the last line takes nothing');
});

test('a shell block whose every line starts with "$ " is read as a console block, and one that has any other line is not', () => {
  assert.equal(runnableBlock('bash', '$ npm install').command, 'npm install');
  assert.equal(runnableBlock('sh', '$ cd app\n$ npm test').command, 'cd app\nnpm test');
  assert.equal(runnableBlock('bash', '$HOME/bin/x\necho "$ x"').command, '$HOME/bin/x\necho "$ x"');
  assert.equal(runnableBlock('', '$ pwd').command, 'pwd');
  assert.equal(runnableBlock('bash', 'echo $ ').command, 'echo $');
});

test('a command longer than the server takes has no Run button', () => {
  assert.equal(runnableBlock('bash', 'x'.repeat(100_000)).command.length, 100_000);
  assert.equal(runnableBlock('bash', 'x'.repeat(100_001)), null);
});

test('a block holding a character the owner cannot see is marked hidden, and the same block without it is not', () => {
  const hiding = ['‮', '‪', '‭', '⁦', '⁩', '‎', '‏', '؜', '​', '‌', '‍', '⁠', '﻿', '\u0000', '\u0007', '\u001b', '\u007f', '\u0085', '\u009f', '\r'];
  for (const c of hiding) {
    assert.equal(runnableBlock('bash', `echo a${c}b`).hidden, true, JSON.stringify(c));
    assert.equal(hasHiddenCharacters(`a${c}b`), true, JSON.stringify(c));
  }
  assert.equal(runnableBlock('bash', 'echo a\tb\nls').hidden, false, 'a tab and a newline are seen');
  assert.equal(runnableBlock('bash', 'echo "héllo ✓ 日本"').hidden, false);
  assert.equal(runnableBlock('console', '$ ls\nout​').hidden, true, 'a character in the output of a console block hides too');
  assert.equal(runnableBlock('', 'ls​').hidden, true);
});

test('a block is still found runnable when it holds a hidden character, so the page can say why Run is off', () => {
  assert.deepEqual(runnableBlock('bash', 'rm -rf x‮'), { command: 'rm -rf x‮', hidden: true });
});

test('the prompt box is in command mode while its text starts with !, with the command after it', () => {
  const on = { terminal: true, draft: false };
  assert.deepEqual(bangMode({ ...on, text: '!ls -la' }), { command: 'ls -la' });
  assert.deepEqual(bangMode({ ...on, text: '!' }), { command: '' });
  assert.deepEqual(bangMode({ ...on, text: '!  echo hi \n' }), { command: 'echo hi' });
  assert.deepEqual(bangMode({ ...on, text: '!a\nb' }), { command: 'a\nb' });
  assert.equal(bangMode({ ...on, text: ' !ls' }), null, 'a space before the ! is an ordinary message');
  assert.equal(bangMode({ ...on, text: 'hello !ls' }), null);
  assert.equal(bangMode({ ...on, text: '' }), null);
});

test('a new session\'s box and a server with no terminal are never in command mode', () => {
  assert.equal(bangMode({ text: '!ls', terminal: true, draft: true }), null);
  assert.equal(bangMode({ text: '!ls', terminal: false, draft: false }), null);
  assert.equal(bangMode({ text: '!ls', terminal: undefined, draft: false }), null);
  assert.equal(bangMode({ text: undefined, terminal: true, draft: false }), null);
});

test('leaving command mode takes the ! and the spaces after it away and keeps the rest', () => {
  assert.equal(leaveBang('!ls -la'), 'ls -la');
  assert.equal(leaveBang('!  ls'), 'ls');
  assert.equal(leaveBang('!'), '');
  assert.equal(leaveBang('hello'), 'hello');
});

test('the history lists the commands run, oldest first, with a repeat in a row listed once', () => {
  const runs = ['ls', 'ls', 'pwd', 'ls', ''].map((command, n) => run(`r${n}`, { command }));
  assert.deepEqual(historyOf(runs), ['ls', 'pwd', 'ls']);
  assert.equal(historyOf(Array.from({ length: 300 }, (_, n) => run(`r${n}`, { command: `c${n}` }))).length, 200);
});

test('Up walks back through the history from what was typed, and Down walks forward to it again', () => {
  const list = ['a', 'b', 'c'];
  let state = { list, at: null, draft: '' };
  let step = recall(state, 'typed', -1);
  assert.deepEqual(step, { at: 2, draft: 'typed', text: 'c' });
  state = { list, ...step };
  step = recall(state, 'c', -1);
  assert.deepEqual(step, { at: 1, draft: 'typed', text: 'b' });
  state = { list, ...step };
  assert.deepEqual(recall(state, 'b', 1), { at: 2, draft: 'typed', text: 'c' });
  assert.deepEqual(recall({ list, at: 2, draft: 'typed' }, 'c', 1), { at: null, draft: '', text: 'typed' }, 'past the newest comes the draft back');
});

test('Up at the oldest command, Down with nothing recalled, and any key with no history do nothing', () => {
  assert.equal(recall({ list: ['a'], at: 0, draft: '' }, 'a', -1), null);
  assert.equal(recall({ list: ['a'], at: null, draft: '' }, 'x', 1), null);
  assert.equal(recall({ list: [], at: null, draft: '' }, 'x', -1), null);
});

test('a summary\'s output replaces what the page holds only when the page is missing some', () => {
  const held = [out('one\n'), out('two\n'), out('three\n')];
  assert.equal(mergeOutput(held, [out('two\nthree\n')]), held, 'the last words of a longer account leave it as it is');
  assert.equal(mergeOutput(held, [out('one\ntwo\nthree\n')]), held, 'the whole account too');
  const tail = [out('two\nthree\nfour\n')];
  assert.equal(mergeOutput(held, tail), tail, 'an account with more at the end is the better one');
  assert.equal(mergeOutput([], tail), tail);
  assert.equal(mergeOutput(held, []), held, 'a run that has printed nothing yet takes nothing away');
});

test('the page\'s echo of what was typed is left out when two accounts of the output are compared', () => {
  const held = [out('prompt: '), { stream: 'in', text: 'yes\n' }, out('done\n')];
  assert.equal(textOf(held), 'prompt: done\n');
  assert.equal(mergeOutput(held, [out('prompt: done\n')]), held);
});

test('chunks join the last piece when it is the same stream, and the oldest words go past the cap', () => {
  const first = [out('a')];
  const next = appendChunks(first, [out('b'), { stream: 'err', text: 'c' }, { stream: 'err', text: 'd' }, out('')]);
  assert.deepEqual(next, [out('ab'), { stream: 'err', text: 'cd' }]);
  assert.deepEqual(first, [out('a')], 'the list it was given is not changed');
  assert.deepEqual(appendChunks([out('abcdef')], [out('gh')], 5), [out('defgh')]);
  assert.deepEqual(appendChunks([out('ab'), { stream: 'err', text: 'cd' }], [out('ef')], 4), [{ stream: 'err', text: 'cd' }, out('ef')]);
  assert.equal(KEEP, 256 * 1024);
});

test('a summary of a run the page holds updates it and keeps the output it has', () => {
  const held = run('r1', { key: 'local-1', output: [out('a\nb\n')] });
  const [now] = upsertRun([held], run('r1', { running: false, exitCode: 0, endedAt: 2000, output: [out('b\n')] }));
  assert.equal(now.running, false);
  assert.equal(now.exitCode, 0);
  assert.equal(now.key, 'local-1', 'the row keeps its key, so it is not drawn again');
  assert.deepEqual(now.output, [out('a\nb\n')]);
});

test('a summary of a run the page does not know takes the place of the run drawn while the server was asked', () => {
  const waiting = run('local-1', { pending: true, command: 'sleep 30', source: 'panel' });
  const other = run('local-2', { pending: true, command: 'sleep 30', source: 'bang' });
  const [a, b] = upsertRun([waiting, other], run('abc', { command: 'sleep 30', source: 'panel' }));
  assert.equal(a.id, 'abc');
  assert.equal(a.key, 'local-1');
  assert.equal(a.pending, false);
  assert.equal(b, other, 'a run with another source is not taken for it');
});

test('a summary of a run nobody waited for is added at the end, and only the newest hundred are kept', () => {
  const runs = upsertRun([run('r1')], run('r2'));
  assert.deepEqual(runs.map(r => r.id), ['r1', 'r2']);
  assert.equal(runs[1].key, 'r2');
  const many = Array.from({ length: 100 }, (_, n) => run(`m${n}`));
  const next = upsertRun(many, run('new'));
  assert.equal(next.length, 100);
  assert.deepEqual([next[0].id, next.at(-1).id], ['m1', 'new']);
});

test('the server\'s whole list of runs replaces the page\'s, joined to what the page holds, and keeps the runs still waiting', () => {
  const held = [run('r1', { key: 'k1', output: [out('a\nb\n')] }), run('gone'), run('local-1', { pending: true })];
  const list = replaceRuns(held, [run('r1', { output: [out('b\n')] }), run('r2', { output: [out('z')] })]);
  assert.deepEqual(list.map(r => r.id), ['r1', 'r2', 'local-1']);
  assert.equal(list[0].key, 'k1');
  assert.deepEqual(list[0].output, [out('a\nb\n')]);
  assert.equal(list[1].key, 'r2');
});

test('the run that input and Ctrl+C are for is the newest one the server says is running', () => {
  assert.equal(lastRunning([run('a'), run('b', { running: false }), run('c', { pending: true })]).id, 'a');
  assert.equal(lastRunning([run('a', { running: false })]), null);
  assert.equal(lastRunning([]), null);
});

test('the home folder is written ~ only where the path starts with it', () => {
  assert.equal(inHome('/Users/eli', '/Users/eli'), '~');
  assert.equal(inHome('/Users/eli/code/app', '/Users/eli'), '~/code/app');
  assert.equal(inHome('/Users/elias/app', '/Users/eli'), '/Users/elias/app');
  assert.equal(inHome('/tmp/Users/eli/x', '/Users/eli'), '/tmp/Users/eli/x');
  assert.equal(inHome('/tmp/x', ''), '/tmp/x');
  assert.equal(inHome('', '/Users/eli'), '');
});

test('a run\'s time is in tenths of a second under ten seconds and in whole units after that', () => {
  assert.deepEqual([took(0), took(240), took(9940), took(9950), took(10_000), took(59_999), took(61_000), took(3_661_000)], ['0.0s', '0.2s', '9.9s', '9s', '10s', '59s', '1m 01s', '1h 01m']);
  assert.equal(took(NaN), '');
});

test('a run\'s ending is its exit code, or that it was stopped or ended by a signal, and it is spoken the same way', () => {
  assert.equal(ending(run('a', { running: false, exitCode: 0 })), 'Exit 0');
  assert.equal(ending(run('a', { running: false, exitCode: 2 })), 'Exit 2');
  assert.equal(ending(run('a', { running: false, stopped: true, signal: 'SIGTERM' })), 'Stopped');
  assert.equal(ending(run('a', { running: false, signal: 'SIGKILL' })), 'Ended by SIGKILL');
  assert.equal(endedAloud(run('a', { command: 'ls -la', exitCode: 0 })), 'Command finished with exit code 0: ls -la');
  assert.equal(endedAloud(run('a', { command: 'sleep 30', stopped: true })), 'Command was stopped: sleep 30');
  assert.equal(endedAloud(run('a', { command: 'x'.repeat(100), exitCode: 1 })), `Command finished with exit code 1: ${'x'.repeat(80)}...`);
});

test('two bash items from an older CLI, the second with no command, read as one', () => {
  const input = { kind: 'bash', key: 'i1', command: 'ls', stdout: '', stderr: '', at: 't' };
  const output = { kind: 'bash', key: 'i2', command: '', stdout: 'a\nb', stderr: 'warn' };
  const user = { kind: 'user', key: 'i3', text: 'ok' };
  const rows = joinBash([user, input, output, user]);
  assert.equal(rows.length, 3);
  assert.deepEqual({ ...rows[1] }, { kind: 'bash', key: 'i1', command: 'ls', stdout: 'a\nb', stderr: 'warn', at: 't' });
  assert.equal(joinBash([user, input, output, user])[1], rows[1], 'joining again gives the same item, so its row is not drawn again');
});

test('bash items that are whole, or an output item with nothing before it, are left as they are', () => {
  const whole = { kind: 'bash', command: 'ls', stdout: 'a', stderr: '' };
  const items = [whole, { kind: 'bash', command: 'pwd', stdout: '/', stderr: '' }];
  assert.equal(joinBash(items), items, 'a list with no output-only item is returned as it is');
  const alone = { kind: 'bash', command: '', stdout: 'a', stderr: '' };
  assert.deepEqual(joinBash([alone, whole]), [alone, whole]);
  assert.deepEqual(joinBash([{ kind: 'user', text: 'x' }, alone]), [{ kind: 'user', text: 'x' }, alone]);
});

test('a bash item in the transcript takes the earliest run with its command that started before it, once', () => {
  const runs = [
    run('a', { source: 'bang', command: 'echo hi', startedAt: 1000 }),
    run('b', { source: 'bang', command: 'echo hi', startedAt: 5000 }),
    run('c', { source: 'panel', command: 'echo hi', startedAt: 1000 }),
  ];
  const item = (command, at) => ({ kind: 'bash', command, stdout: '', stderr: '', at: new Date(at).toISOString() });
  assert.deepEqual([...landedRuns(runs, [item('echo hi', 6000)])], ['a']);
  assert.deepEqual([...landedRuns(runs, [item('echo hi', 6000), item('echo hi', 7000)])], ['a', 'b']);
  assert.deepEqual([...landedRuns(runs, [item('echo hi', 3000)])], ['a'], 'an item written before the second run began is not for it');
  assert.deepEqual([...landedRuns(runs, [item('echo ho', 6000)])], []);
  assert.deepEqual([...landedRuns(runs, [item('  echo hi\n', 6000)])], ['a'], 'a command is compared without the space round it');
  assert.deepEqual([...landedRuns(runs, [item('echo hi', -10_000)])], [], 'an item that came before any run began is for none');
});

test('a bash item with no time still takes a run by its command', () => {
  const runs = [run('a', { source: 'bang', command: 'ls', startedAt: 9e12 })];
  assert.deepEqual([...landedRuns(runs, [{ kind: 'bash', command: 'ls', stdout: '', stderr: '' }])], ['a']);
});

test('the runs shown after the transcript are the ! runs it does not hold yet', () => {
  const runs = [run('a', { source: 'bang', command: 'ls', startedAt: 1000 }), run('b', { source: 'bang', command: 'pwd', startedAt: 2000 }), run('c', { source: 'block', command: 'ls' })];
  const items = [{ kind: 'bash', command: 'ls', stdout: '', stderr: '', at: new Date(3000).toISOString() }];
  assert.deepEqual(pendingBangs({ runs, items, hasEarlier: false }).map(r => r.id), ['b']);
  assert.deepEqual(pendingBangs({ runs, items: [], hasEarlier: false }).map(r => r.id), ['a', 'b']);
});

test('with earlier messages not loaded, a run that began before the oldest message on show is left out', () => {
  const runs = [run('old', { source: 'bang', startedAt: 1000 }), run('new', { source: 'bang', command: 'pwd', startedAt: 9000 })];
  const items = [{ kind: 'assistant', text: 'hi', at: new Date(5000).toISOString() }];
  assert.deepEqual(pendingBangs({ runs, items, hasEarlier: true }).map(r => r.id), ['new']);
  assert.deepEqual(pendingBangs({ runs, items, hasEarlier: false }).map(r => r.id), ['old', 'new']);
  assert.deepEqual(pendingBangs({ runs, items: [{ kind: 'assistant', text: 'hi' }], hasEarlier: true }).map(r => r.id), ['old', 'new'], 'with no time to compare, none is left out');
});

test('the run a bash item came from is the latest ! run with its command that began before it', () => {
  const runs = [run('a', { source: 'bang', command: 'ls', startedAt: 1000 }), run('b', { source: 'bang', command: 'ls', startedAt: 5000 }), run('c', { source: 'panel', command: 'ls', startedAt: 6000 })];
  const item = at => ({ kind: 'bash', command: 'ls', at: new Date(at).toISOString() });
  assert.equal(runOfItem(runs, item(6000)).id, 'b');
  assert.equal(runOfItem(runs, item(2500)).id, 'a');
  assert.equal(runOfItem(runs, item(-10_000)), null);
  assert.equal(runOfItem(runs, { kind: 'bash', command: 'pwd', at: new Date(6000).toISOString() }), null);
});
