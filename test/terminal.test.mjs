// Run with `npm test`. Most tests run real shells on harmless commands in a temp folder; the ones that need exact timing or exact bytes
// use a fake spawn. Every real process is a descendant of a sleep or a short echo, and each test stops what it starts.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { cutMiddle, handOffText, LIMITS, makeEnvSnapshot, makeTerminal, pickShell, stripAnsi } from '../lib/terminal.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-terminal-test-'));
const folder = name => {
  const dir = path.join(fs.realpathSync(base), name);
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  return dir;
};
const env = async () => ({ PATH: process.env.PATH, HOME: base });
const live = [];
const rig = (options = {}) => {
  const events = [];
  const t = makeTerminal({ shell: '/bin/sh', env, emit: (id, event) => events.push({ id, ...event }), ...options });
  live.push(t);
  return { t, events, runs: id => events.filter(e => e.type === 'run' && e.run.id === id).map(e => e.run) };
};
after(() => { for (const t of live) t.killAll(); });

const until = async (check, ms = 5000) => {
  for (let waited = 0; !(await check()); waited += 10) {
    if (waited > ms) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
const finished = (r, id) => r.runs(id).some(run => !run.running);
const outputOf = (r, id) => r.events.filter(e => e.type === 'output' && e.run === id).flatMap(e => e.chunks);
const text = (chunks, stream) => chunks.filter(c => !stream || c.stream === stream).map(c => c.text).join('');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const runAndWait = async (r, id, command, source = 'panel', dir = folder('main')) => {
  const { id: run } = await r.t.run(id, { command, source, folder: dir });
  await until(() => finished(r, run));
  return r.runs(run).at(-1);
};

// A child process that does nothing until the test drives it.
function fakeSpawn() {
  const calls = [];
  const spawn = (shell, args, opts) => {
    const child = new EventEmitter();
    Object.assign(child, { pid: 424242, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()];
    calls.push({ child, shell, args, opts });
    return child;
  };
  const end = (child, code = 0) => {
    for (const s of [child.stdout, child.stderr, child.stdio[3]]) s.end();
    child.emit('exit', code, null);
    child.emit('close', code, null);
  };
  return { spawn, calls, end };
}

test('the shell is the owner\'s when it is one of the five Capcom knows, and zsh otherwise', () => {
  for (const name of ['zsh', 'bash', 'sh', 'ksh', 'dash']) assert.equal(pickShell({ SHELL: `/usr/local/bin/${name}` }), `/usr/local/bin/${name}`);
  for (const SHELL of ['/usr/bin/fish', 'zsh', '', undefined, '/bin/zsh-evil', '/tmp/zsh/..']) assert.equal(pickShell({ SHELL }), '/bin/zsh', String(SHELL));
});

test('a command streams its output and ends with exit 0, with the two streams kept apart', async () => {
  const r = rig();
  const dir = folder('echo');
  const started = await r.t.run('a', { command: 'echo hello; echo oops >&2', source: 'panel', folder: dir });
  assert.deepEqual([started.running, started.exitCode, started.cwd, started.source, started.delivered, started.output], [true, null, dir, 'panel', null, []]);
  await until(() => finished(r, started.id));
  const done = r.runs(started.id).at(-1);
  assert.deepEqual([done.running, done.exitCode, done.signal, done.stopped, done.truncated], [false, 0, null, false, false]);
  assert.ok(done.endedAt >= done.startedAt);
  assert.deepEqual(done.output, [{ stream: 'out', text: 'hello\n' }, { stream: 'err', text: 'oops\n' }]);
  const streamed = outputOf(r, started.id);
  assert.equal(text(streamed, 'out'), 'hello\n');
  assert.equal(text(streamed, 'err'), 'oops\n');
  assert.equal(r.events.at(-1).type, 'run', 'the end of the run is the last event');
});

test('a failing command reports its exit code, and the same wrapper runs under every shell installed', async () => {
  const r = rig();
  assert.equal((await runAndWait(r, 'a', 'exit 3')).exitCode, 3);
  assert.equal((await runAndWait(r, 'a', 'nonexistent-command-for-the-test')).exitCode, 127);
  for (const shell of ['/bin/zsh', '/bin/bash', '/bin/sh', '/bin/dash', '/bin/ksh'].filter(s => fs.existsSync(s))) {
    const own = rig({ shell });
    const dir = folder(`shell-${path.basename(shell)}`);
    const done = await runAndWait(own, 'a', 'cd sub; pwd; (exit 4)', 'panel', dir);
    assert.equal(done.exitCode, 4, shell);
    assert.equal(fs.realpathSync(text(done.output).trim()), `${dir}/sub`, shell);
    assert.equal(fs.realpathSync(own.t.cwd('a', dir)), `${dir}/sub`, shell);
  }
});

test('the command is an argument and never part of the script, so quotes, substitutions and a stray quote do nothing extra', async () => {
  const r = rig();
  const command = `echo "it's \\"quoted\\" $((1+2))" '; echo injected; '; echo "$0 $# $1"`;
  const done = await runAndWait(r, 'a', command);
  assert.equal(text(done.output), `it's "quoted" 3 ; echo injected; \ncapcom 0 \n`);
  const fake = fakeSpawn();
  const f = rig({ spawn: fake.spawn, shell: '/bin/sh' });
  await f.t.run('a', { command: 'echo "$HOME" # trailing', source: 'panel', folder: folder('argv') });
  const { args, opts, shell } = fake.calls[0];
  assert.equal(shell, '/bin/sh');
  assert.deepEqual([args[0], args[2], args[3]], ['-c', 'capcom', 'echo "$HOME" # trailing']);
  assert.equal(args[1].includes('trailing'), false, 'the script holds none of the command');
  assert.equal(opts.detached, true);
  assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'pipe', 'pipe']);
  assert.deepEqual([opts.env.PAGER, opts.env.GIT_PAGER, opts.env.TERM, opts.env.PATH, opts.env.PWD], ['cat', 'cat', 'xterm-256color', process.env.PATH, opts.cwd]);
});

test('cd moves the panel\'s folder for the next command, and a ! command starts in the session\'s folder and never moves it', async () => {
  const r = rig();
  const dir = folder('cd');
  const first = await runAndWait(r, 'a', 'cd sub', 'panel', dir);
  assert.equal(first.cwd, dir);
  assert.deepEqual(r.events.filter(e => e.type === 'cwd'), [{ id: 'a', type: 'cwd', cwd: `${dir}/sub` }]);
  assert.equal(text((await runAndWait(r, 'a', 'pwd', 'panel', dir)).output), `${dir}/sub\n`, 'a panel run follows the cd');
  assert.equal(text((await runAndWait(r, 'a', 'pwd', 'block', dir)).output), `${dir}/sub\n`, 'and so does a code block run');
  const bang = await runAndWait(r, 'a', 'pwd; cd /; pwd', 'bang', dir);
  assert.equal(bang.cwd, dir);
  assert.equal(text(bang.output), `${dir}\n/\n`, 'a ! run starts in the session\'s folder');
  assert.equal(r.t.cwd('a', dir), `${dir}/sub`, 'and its own cd did not reach the panel');
  assert.equal(r.t.snapshot('a', dir).cwd, `${dir}/sub`);
  assert.equal(r.t.cwd('another', dir), dir, 'each session has its own folder');
});

test('the panel falls back to the session\'s folder when the folder it was in is gone', async () => {
  const r = rig();
  const dir = folder('gone');
  await runAndWait(r, 'a', 'cd sub', 'panel', dir);
  fs.rmdirSync(`${dir}/sub`);
  const done = await runAndWait(r, 'a', 'pwd', 'panel', dir);
  assert.equal(done.cwd, dir);
  assert.equal(text(done.output), `${dir}\n`);
  assert.equal(r.t.cwd('a', dir), dir);
  assert.equal(r.events.filter(e => e.type === 'cwd').at(-1).cwd, dir);
});

test('input reaches a command that reads standard input, and eof ends one that reads to the end', async () => {
  const r = rig();
  const { id } = await r.t.run('a', { command: 'read name; echo "hello $name"; cat; echo done', source: 'panel', folder: folder('input') });
  r.t.input('a', id, 'Eli\n');
  await until(() => text(outputOf(r, id)).includes('hello Eli\n'));
  r.t.input('a', id, 'one\ntwo\n');
  r.t.input('a', id, '', true);
  await until(() => finished(r, id));
  assert.equal(text(r.runs(id).at(-1).output), 'hello Eli\none\ntwo\ndone\n');
  assert.throws(() => r.t.input('a', id, 'late\n'), { status: 409 });
  assert.throws(() => r.t.input('a', 'nope', 'x'), { status: 404 });
  assert.throws(() => r.t.input('b', id, 'x'), { status: 404 }, 'a run of another session is not reachable');
  const open = await r.t.run('a', { command: 'sleep 30', source: 'panel', folder: folder('input') });
  for (const [args, status] of [[[5], 400], [['x', 'yes'], 400], [[], 400], [['', false], 400], [['x'.repeat(LIMITS.input + 1)], 400]]) assert.throws(() => r.t.input('a', open.id, ...args), { status }, JSON.stringify(args).slice(0, 40));
  r.t.stop('a', open.id);
  await until(() => finished(r, open.id));
});

test('Stop ends the whole process group: the shell, a background job and a job started from a subshell', async () => {
  const r = rig();
  const command = 'sleep 30 & echo bg=$!; (sleep 30 & echo nested=$!; wait) & echo shell=$$; sleep 30';
  const { id } = await r.t.run('a', { command, source: 'panel', folder: folder('stop') });
  await until(() => /bg=\d+\n/.test(text(outputOf(r, id))) && /nested=\d+\n/.test(text(outputOf(r, id))) && /shell=\d+\n/.test(text(outputOf(r, id))));
  const out = text(outputOf(r, id));
  const pids = ['bg', 'nested', 'shell'].map(name => Number(new RegExp(`${name}=(\\d+)`).exec(out)[1]));
  assert.ok(pids.every(alive), 'all three are running before the stop');
  assert.equal(r.t.stop('a', id).stopped, true);
  await until(() => finished(r, id));
  await until(() => !pids.some(alive));
  const done = r.runs(id).at(-1);
  assert.deepEqual([done.stopped, done.running], [true, false]);
  assert.ok(done.signal === 'SIGTERM' || done.exitCode === 143, `ended by SIGTERM, got ${done.signal} ${done.exitCode}`);
  assert.deepEqual(r.t.stop('a', id).running, false, 'stopping a finished run changes nothing');
  assert.throws(() => r.t.stop('a', 'nope'), { status: 404 });
});

test('a command that ignores SIGTERM is killed after the grace period, group and all', async () => {
  const r = rig({ grace: 150 });
  const { id } = await r.t.run('a', { command: 'trap "" TERM; sleep 30 & echo bg=$!; echo shell=$$; sleep 30', source: 'panel', folder: folder('kill') });
  await until(() => /shell=\d+\n/.test(text(outputOf(r, id))) && /bg=\d+\n/.test(text(outputOf(r, id))));
  const out = text(outputOf(r, id));
  const pids = [/bg=(\d+)/, /shell=(\d+)/].map(re => Number(re.exec(out)[1]));
  r.t.stop('a', id);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(pids.every(alive), 'still running before the grace period is over');
  await until(() => finished(r, id));
  await until(() => !pids.some(alive));
  assert.equal(r.runs(id).at(-1).signal, 'SIGKILL');
});

test('a run whose pipes are held by something outside its group is closed after the kill, not left open', async () => {
  const fake = fakeSpawn();
  const r = rig({ spawn: fake.spawn, grace: 20, kill: () => {} });
  const { id } = await r.t.run('a', { command: 'x', source: 'panel', folder: folder('stuck') });
  fake.calls[0].child.emit('exit', null, 'SIGTERM');
  r.t.stop('a', id);
  await until(() => finished(r, id), 3000);
  assert.deepEqual([r.runs(id).at(-1).running, r.runs(id).at(-1).signal, fake.calls[0].child.stdout.destroyed], [false, 'SIGTERM', true]);
});

test('a group that has emptied after its shell was reaped is never signalled again, so a reused pid is safe', async () => {
  const fake = fakeSpawn();
  const sent = [];
  let empty = false;
  const kill = (pid, name) => {
    if (name === 0 && empty) throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    sent.push(name);
  };
  const r = rig({ spawn: fake.spawn, grace: 20, kill });
  const { id } = await r.t.run('a', { command: 'x', source: 'panel', folder: folder('reaped') });
  fake.calls[0].child.emit('exit', 0, null);
  empty = true;
  r.t.stop('a', id);
  await until(() => finished(r, id), 3000);
  empty = false;
  r.t.killAll();
  assert.deepEqual(sent, [0]);
});

test('a background job keeps the run open, and Stop still reaches it', async () => {
  const r = rig();
  const { id } = await r.t.run('a', { command: 'sleep 30 & echo bg=$!', source: 'panel', folder: folder('bg') });
  await until(() => /bg=\d+/.test(text(outputOf(r, id))));
  const pid = Number(/bg=(\d+)/.exec(text(outputOf(r, id)))[1]);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(r.runs(id).at(-1).running, true, 'the shell has gone but the job holds the run open');
  r.t.stop('a', id);
  await until(() => finished(r, id));
  await until(() => !alive(pid));
});

test('killAll ends every running command in every session', async () => {
  const r = rig();
  const pids = [];
  for (const session of ['a', 'b']) {
    const { id } = await r.t.run(session, { command: 'echo p=$$; sleep 30', source: 'panel', folder: folder('killall') });
    await until(() => /p=\d+/.test(text(outputOf(r, id))));
    pids.push(Number(/p=(\d+)/.exec(text(outputOf(r, id)))[1]));
  }
  r.t.killAll();
  await until(() => !pids.some(alive));
});

test('a long output keeps the newest characters, and says it was cut', async () => {
  const r = rig({ limits: { output: 100 } });
  const done = await runAndWait(r, 'a', 'i=0; while [ $i -lt 40 ]; do echo "line $i"; i=$((i+1)); done');
  assert.equal(done.truncated, true);
  const kept = text(done.output);
  assert.equal(kept.length, 100);
  assert.ok(kept.endsWith('line 39\n'));
  const small = await runAndWait(r, 'a', 'echo short');
  assert.equal(small.truncated, false);
});

test('a summary carries the end of the output and the cap on what is kept is separate', async () => {
  const r = rig({ limits: { tail: 10 } });
  const done = await runAndWait(r, 'a', 'echo 0123456789abcdef');
  assert.equal(text(done.output), '789abcdef\n');
  assert.equal(text(r.t.snapshot('a', folder('main')).runs.at(-1).output), '789abcdef\n');
});

test('output arriving in a burst leaves as one event, and a character split across reads comes out whole', async () => {
  const fake = fakeSpawn();
  const r = rig({ spawn: fake.spawn, flushMs: 30 });
  const { id } = await r.t.run('a', { command: 'x', source: 'panel', folder: folder('burst') });
  const { child } = fake.calls[0];
  child.stdout.write('first\n');
  await until(() => r.events.some(e => e.type === 'output'));
  const lines = Array.from({ length: 500 }, (_, n) => `line ${n}\n`).join('');
  for (const line of lines.split(/(?<=\n)/)) child.stdout.write(line);
  await until(() => r.events.filter(e => e.type === 'output').length === 2);
  assert.deepEqual(r.events.filter(e => e.type === 'output')[1].chunks, [{ stream: 'out', text: lines }]);
  const bytes = Buffer.from('caf\u00e9 \u{1f600}!');
  const cut = bytes.indexOf(0xc3) + 1;
  for (const piece of [bytes.subarray(0, cut), bytes.subarray(cut, bytes.length - 3), bytes.subarray(bytes.length - 3)]) child.stdout.write(piece);
  fake.end(child);
  await until(() => finished(r, id));
  assert.equal(text(r.events.filter(e => e.type === 'output').flatMap(e => e.chunks)), `first\n${lines}caf\u00e9 \u{1f600}!`);
  assert.equal(text(r.runs(id).at(-1).output).endsWith('caf\u00e9 \u{1f600}!'), true);
});

test('output faster than the page can take pauses the pipe until the next event', async () => {
  const fake = fakeSpawn();
  const r = rig({ spawn: fake.spawn, flushMs: 20, limits: { burst: 100 } });
  await r.t.run('a', { command: 'x', source: 'panel', folder: folder('pause') });
  const { child } = fake.calls[0];
  const calls = [];
  for (const name of ['pause', 'resume']) {
    const original = child.stdout[name].bind(child.stdout);
    child.stdout[name] = () => { calls.push(name); return original(); };
  }
  child.stdout.write('x'.repeat(500));
  await until(() => r.events.some(e => e.type === 'output'));
  assert.deepEqual(calls.slice(0, 2), ['pause', 'resume']);
  assert.equal(text(r.events.find(e => e.type === 'output').chunks), 'x'.repeat(500));
});

test('a session runs 8 commands at once and all sessions 32, and the next is refused', async () => {
  const r = rig({ limits: { perSession: 2, total: 3 } });
  const dir = folder('limits');
  const first = await r.t.run('a', { command: 'sleep 30', source: 'panel', folder: dir });
  await r.t.run('a', { command: 'sleep 30', source: 'panel', folder: dir });
  await assert.rejects(r.t.run('a', { command: 'echo no', source: 'panel', folder: dir }), { status: 429 });
  await r.t.run('b', { command: 'sleep 30', source: 'panel', folder: dir });
  await assert.rejects(r.t.run('c', { command: 'echo no', source: 'panel', folder: dir }), { status: 429 });
  r.t.stop('a', first.id);
  await until(() => finished(r, first.id));
  await r.t.run('c', { command: 'sleep 30', source: 'panel', folder: dir });
  assert.deepEqual([LIMITS.perSession, LIMITS.total], [8, 32]);
  r.t.killAll();
});

test('only the newest runs of a session are kept, and one still running is never dropped', async () => {
  const fake = fakeSpawn();
  const r = rig({ spawn: fake.spawn, limits: { kept: 3, perSession: 10 } });
  const dir = folder('kept');
  await r.t.run('a', { command: 'long', source: 'panel', folder: dir });
  for (let n = 0; n < 5; n++) {
    await r.t.run('a', { command: `c${n}`, source: 'panel', folder: dir });
    fake.end(fake.calls.at(-1).child);
  }
  assert.deepEqual(r.t.snapshot('a', dir).runs.map(run => run.command), ['long', 'c3', 'c4']);
  assert.equal(LIMITS.kept, 100);
});

test('clear drops the finished runs and keeps the running ones', async () => {
  const r = rig();
  const dir = folder('clear');
  await runAndWait(r, 'a', 'echo done', 'panel', dir);
  const open = await r.t.run('a', { command: 'sleep 30', source: 'panel', folder: dir });
  const kept = r.t.clear('a');
  assert.deepEqual(kept.map(run => run.id), [open.id]);
  assert.deepEqual(r.events.at(-1), { id: 'a', type: 'cleared', runs: kept });
  assert.deepEqual(r.t.snapshot('a', dir).runs.map(run => run.id), [open.id]);
  assert.deepEqual(r.t.clear('nobody'), []);
  r.t.stop('a', open.id);
  await until(() => finished(r, open.id));
});

test('a command that is empty, too long, from nowhere, or in a folder that is gone is refused before anything starts', async () => {
  const r = rig();
  const dir = folder('refused');
  for (const [command, source, status] of [['', 'panel', 400], ['   ', 'panel', 400], [5, 'panel', 400], [undefined, 'panel', 400], ['x'.repeat(LIMITS.command + 1), 'panel', 400], ['echo', 'tty', 400], ['echo', undefined, 400]]) {
    await assert.rejects(r.t.run('a', { command, source, folder: dir }), { status }, `${String(command).slice(0, 10)} ${source}`);
  }
  await assert.rejects(r.t.run('a', { command: 'echo', source: 'panel', folder: path.join(dir, 'missing') }), { status: 409 });
  await assert.rejects(r.t.run('a', { command: 'echo', source: 'panel', folder: '' }), { status: 409 });
  assert.deepEqual(r.events, [], 'nothing was started');
  const longest = await r.t.run('a', { command: 'x'.repeat(LIMITS.command), source: 'panel', folder: dir });
  assert.equal(longest.running, true);
  await until(() => finished(r, longest.id));
});

test('a shell that cannot start is reported on the run, not thrown', async () => {
  const r = rig({ shell: '/nonexistent/shell' });
  const done = await runAndWait(r, 'a', 'echo hi');
  assert.deepEqual([done.running, done.exitCode], [false, null]);
  assert.match(text(done.output, 'err'), /Could not start the command/);
});

test('a command run with ! hands its two streams to onEnd, even when it was stopped, and records how it went', async () => {
  const handed = [];
  const r = rig({ onEnd: (id, done) => { handed.push([id, done]); return 'sent'; } });
  const dir = folder('bang');
  const done = await runAndWait(r, 'a', 'echo out; echo err >&2; exit 2', 'bang', dir);
  assert.deepEqual([done.delivered, done.exitCode], ['sent', 2]);
  assert.equal(r.runs(done.id).filter(run => !run.running).length, 1, 'one event carries both the end and the delivery');
  assert.deepEqual([handed[0][0], handed[0][1].run.command, handed[0][1].stdout, handed[0][1].stderr], ['a', 'echo out; echo err >&2; exit 2', 'out\n', 'err\n']);
  const slow = await r.t.run('a', { command: 'echo before; sleep 30', source: 'bang', folder: dir });
  await until(() => text(outputOf(r, slow.id)).includes('before'));
  r.t.stop('a', slow.id);
  await until(() => finished(r, slow.id));
  assert.deepEqual([handed.length, handed[1][1].stdout, r.runs(slow.id).at(-1).stopped], [2, 'before\n', true]);
  await runAndWait(r, 'a', 'echo panel');
  assert.equal(handed.length, 2, 'a panel run is not handed over');
});

test('a result Claude is not to reply to is held, joined in order, and released once', () => {
  const r = rig();
  assert.equal(r.t.held('a'), '');
  r.t.hold('a', 'first');
  r.t.hold('a', 'second');
  assert.equal(r.t.held('a'), 'first\n\nsecond');
  assert.equal(r.t.held('b'), '');
  r.t.release('a');
  assert.equal(r.t.held('a'), '');
});

test('a hand-off that throws costs the run its delivery mark and nothing else', async () => {
  const log = console.error;
  const seen = [];
  console.error = (...a) => { seen.push(a.join(' ')); };
  try {
    const r = rig({ onEnd: () => { throw new Error('no chat'); } });
    const done = await runAndWait(r, 'a', 'echo hi', 'bang');
    assert.deepEqual([done.running, done.delivered, done.exitCode], [false, null, 0]);
    assert.match(seen.join(), /no chat/);
  } finally { console.error = log; }
});

test('the snapshot lists the runs with the folder and the home folder, and a new session starts in its own folder', async () => {
  const r = rig({ home: '/home/test' });
  const dir = folder('snapshot');
  assert.deepEqual(r.t.snapshot('a', dir), { cwd: dir, home: '/home/test', runs: [] });
  const done = await runAndWait(r, 'a', 'echo hi', 'panel', dir);
  assert.deepEqual(r.t.snapshot('a', dir).runs.map(run => run.id), [done.id]);
});

// ---- what Claude is sent ----------------------------------------------------------------------

test('the hand-off has the CLI\'s exact shape, escapes & < > in all three parts, and drops colour', () => {
  assert.equal(handOffText({ command: 'ls', stdout: 'a.txt\n', stderr: '' }), '<bash-input>ls</bash-input><bash-stdout>a.txt</bash-stdout><bash-stderr></bash-stderr>');
  assert.equal(
    handOffText({ command: 'echo "<b>&</b>" > f', stdout: '\u001b[1;31m<red>\u001b[0m & \u001b]0;title\u0007done\n', stderr: 'a < b > c &amp;\n' }),
    '<bash-input>echo "&lt;b&gt;&amp;&lt;/b&gt;" &gt; f</bash-input><bash-stdout>&lt;red&gt; &amp; done</bash-stdout><bash-stderr>a &lt; b &gt; c &amp;amp;</bash-stderr>',
  );
  assert.equal(handOffText({ command: 'x' }), '<bash-input>x</bash-input><bash-stdout></bash-stdout><bash-stderr></bash-stderr>');
  assert.equal(stripAnsi('\u001b[2K\u001b[1Gprogress \u001b[38;5;81mcolour\u001b[0m\u001b(B'), 'progress colour');
});

test('output over 30,000 characters keeps the head and the tail with a line saying how much was cut', () => {
  const long = `${'a'.repeat(15_000)}${'m'.repeat(10_000)}${'z'.repeat(15_000)}`;
  const cut = cutMiddle(long);
  assert.equal(cut, `${'a'.repeat(15_000)}\n[... 10000 characters cut ...]\n${'z'.repeat(15_000)}`);
  assert.equal(cutMiddle('a'.repeat(30_000)).length, 30_000, 'exactly 30,000 is kept whole');
  const text = handOffText({ command: 'seq', stdout: long, stderr: `${'e'.repeat(30_001)}` });
  const [, out, err] = /<bash-stdout>([\s\S]*)<\/bash-stdout><bash-stderr>([\s\S]*)<\/bash-stderr>/.exec(text);
  assert.equal(out, cut);
  assert.equal(err, `${'e'.repeat(15_000)}\n[... 1 characters cut ...]\n${'e'.repeat(15_000)}`);
  assert.equal(LIMITS.handOff, 30_000);
});

test('a cut never splits a character that takes two UTF-16 units', () => {
  const emoji = '\u{1f600}';
  const at = (n, fill) => `${'a'.repeat(n)}${emoji}${'b'.repeat(fill)}`;
  for (const lead of [14_998, 14_999, 15_000]) {
    const cut = cutMiddle(`${at(lead, 20_000)}${emoji}`);
    for (const half of cut.split(/\n\[\.\.\. \d+ characters cut \.\.\.\]\n/)) assert.doesNotMatch(half, /(^[\udc00-\udfff])|([\ud800-\udbff]$)/);
  }
});

// ---- the environment a command starts with ------------------------------------------------------

function fakeProbe(answers) {
  const calls = [];
  const spawn = (shell, args, opts) => {
    calls.push({ shell, args, opts });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    const answer = answers.shift();
    process.nextTick(() => {
      if (answer) child.stdout.write(answer);
      child.emit('close', answer ? 0 : 1);
    });
    return child;
  };
  return { spawn, calls };
}
const envOut = (pairs, noise = '') => `${noise}__CAPCOM_ENV_START__${Object.entries(pairs).map(([k, v]) => `${k}=${v}\0`).join('')}__CAPCOM_ENV_END__`;

test('the environment is the interactive login shell\'s, taken with a minimal one and none of Capcom\'s own', async () => {
  const fake = fakeProbe([envOut({ PATH: '/opt/bin:/usr/bin', NVM_DIR: '/home/n', PWD: '/launchd', SHLVL: '1', _: '/usr/bin/env', MULTI: 'a=b\nc' }, 'p10k noise\n')]);
  const get = makeEnvSnapshot({ spawn: fake.spawn, shell: '/bin/zsh', base: { HOME: '/home/t', USER: 'u', PATH: '/usr/bin', PORT: '4310', CAPCOM_STATE: '/s', LANG: 'C', EXTRA: '1' } });
  assert.deepEqual(await get(), { PATH: '/opt/bin:/usr/bin', NVM_DIR: '/home/n', MULTI: 'a=b\nc' });
  assert.equal(fake.calls[0].shell, '/bin/zsh');
  assert.equal(fake.calls[0].args[0], '-ilc');
  assert.match(fake.calls[0].args[1], /env -0/);
  assert.deepEqual(fake.calls[0].opts.env, { HOME: '/home/t', USER: 'u', PATH: '/usr/bin', LANG: 'C' });
  assert.deepEqual(fake.calls[0].opts.stdio, ['ignore', 'pipe', 'ignore']);
});

test('a shell that will not run interactively is tried as a login shell, and then replaced by a minimal environment', async () => {
  const second = fakeProbe([null, envOut({ PATH: '/login/bin' })]);
  assert.deepEqual(await makeEnvSnapshot({ spawn: second.spawn, shell: '/bin/zsh', base: { PATH: '/p' } })(), { PATH: '/login/bin' });
  assert.deepEqual(second.calls.map(c => c.args[0]), ['-ilc', '-lc']);
  const none = fakeProbe([null, 'garbage with no markers']);
  assert.deepEqual(await makeEnvSnapshot({ spawn: none.spawn, shell: '/bin/zsh', base: { PATH: '/p', HOME: '/h', PORT: '1' } })(), { PATH: '/p', HOME: '/h' });
});

test('the environment is kept for ten minutes, then refreshed behind the commands that use the old one', async () => {
  let clock = 0;
  const fake = fakeProbe([envOut({ V: 'old' }), envOut({ V: 'new' })]);
  const get = makeEnvSnapshot({ spawn: fake.spawn, shell: '/bin/zsh', base: {}, now: () => clock });
  assert.equal((await get()).V, 'old');
  clock = 9 * 60_000;
  assert.equal((await get()).V, 'old');
  assert.equal(fake.calls.length, 1);
  clock = 10 * 60_000;
  assert.equal((await get()).V, 'old', 'the old one is served while the new one is taken');
  await until(() => fake.calls.length === 2);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await get()).V, 'new');
  assert.equal(fake.calls.length, 2, 'asking again while it is fresh takes nothing');
});

test('the real login shell answers with a PATH, and a command started with it can use it', async () => {
  const get = makeEnvSnapshot({ base: { HOME: base, PATH: process.env.PATH, PORT: '4310' } });
  const snapshot = await get();
  assert.ok(snapshot.PATH.length > 0);
  assert.equal(snapshot.PORT, undefined);
  const r = rig({ env: get });
  const done = await runAndWait(r, 'a', 'echo "$PAGER|$GIT_PAGER|$TERM|${PORT:-unset}"');
  assert.equal(text(done.output), 'cat|cat|xterm-256color|unset\n');
});
