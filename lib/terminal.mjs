// Runs the commands behind the side terminal. Each command is its own process on pipes, with no PTY, so `cd` carries from one
// command to the next but a full-screen program does not run. See docs/adr/20261023-terminal-without-a-pty.md.
import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const SOURCES = ['panel', 'block', 'bang'];
// Sizes are in characters. `tail` is how much of a run's output a summary carries, and `handOff` how much of each stream Claude is sent.
export const LIMITS = { perSession: 8, total: 32, kept: 100, output: 1_000_000, tail: 64 * 1024, command: 100_000, input: 100_000, handOff: 30_000, burst: 256 * 1024 };

const SHELLS = ['zsh', 'bash', 'sh', 'ksh', 'dash'];
// NOTE: [23 Oct 2026] EK - The command is $1 and never part of the script text, so nothing in it can break out of the wrapper.
// fd 3 reports the final $PWD, which is how `cd` reaches the panel. See docs/adr/20261023-terminal-without-a-pty.md.
const WRAPPER = '__capcom_c=$1; shift; eval "$__capcom_c"; __capcom_s=$?; printf \'%s\' "$PWD" >&3; exit $__capcom_s';
const KEPT_VARS = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'LANG', 'TMPDIR'];
// Variables a login shell sets about itself, which would be wrong for the command that inherits them.
const OWN_VARS = ['PWD', 'OLDPWD', 'SHLVL', '_'];
const MARK = '__CAPCOM_ENV_START__';
const END = '__CAPCOM_ENV_END__';

const refuse = (status, message) => Object.assign(new Error(message), { status });

export function pickShell(env = process.env) {
  return path.isAbsolute(env.SHELL || '') && SHELLS.includes(path.basename(env.SHELL)) ? env.SHELL : '/bin/zsh';
}

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const minimalEnv = base => Object.fromEntries(KEPT_VARS.filter(k => base[k]).map(k => [k, base[k]]));
const killGroup = (pid, signal) => process.kill(-pid, signal);

function parseEnv(out) {
  const from = out.indexOf(MARK);
  const to = out.indexOf(END, from);
  if (from === -1 || to === -1) return null;
  const env = {};
  for (const pair of out.slice(from + MARK.length, to).split('\0')) {
    const eq = pair.indexOf('=');
    if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  for (const name of OWN_VARS) delete env[name];
  return Object.keys(env).length ? env : null;
}

// What the shell would hand a command started by hand. The answer ends at the end marker, because a daemon the shell's startup
// file leaves running can hold the pipe open long after the shell has printed everything.
function probe({ spawn, shell, flags, base, timeoutMs }) {
  return new Promise(resolve => {
    let out = '';
    let done = false;
    let child;
    const finish = env => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // A shell that has already been reaped is left alone, because its group id could belong to something else by now.
      if (child?.pid && child.exitCode === null && child.signalCode === null) try { killGroup(child.pid, 'SIGKILL'); } catch {}
      resolve(env);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      child = spawn(shell, [flags, `printf '%s' ${MARK}; env -0; printf '%s' ${END}`], { env: minimalEnv(base), stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    } catch { return finish(null); }
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { out += chunk; if (out.includes(END)) finish(parseEnv(out)); });
    child.on('error', () => finish(null));
    child.on('close', () => finish(parseEnv(out)));
  });
}

// The environment of the owner's interactive login shell, so a command finds the same tools a terminal would. It is taken once, kept
// for ten minutes and then refreshed behind the commands that use the old one. A shell that will not answer falls back to a minimal one.
export function makeEnvSnapshot({ spawn = nodeSpawn, shell = pickShell(), base = process.env, timeoutMs = 10_000, maxAgeMs = 10 * 60_000, retryMs = 60_000, now = Date.now } = {}) {
  let kept = null;
  let inflight = null;
  const refresh = () => inflight ||= (async () => {
    let env = null;
    for (const flags of ['-ilc', '-lc']) {
      env = await probe({ spawn, shell, flags, base, timeoutMs });
      if (env) break;
    }
    kept = env ? { env, expires: now() + maxAgeMs } : { env: minimalEnv(base), expires: now() + retryMs };
    inflight = null;
    return kept.env;
  })();
  return async () => {
    if (!kept) return refresh();
    if (now() >= kept.expires) refresh();
    return kept.env;
  };
}

// ---- what Claude is sent after a command run with ! ----------------------------------------------

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[ -/]+[0-~]|[@-Z\\-_])/g;
export const stripAnsi = text => text.replace(ANSI, '');
const escapeTags = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isHigh = code => code >= 0xd800 && code <= 0xdbff;
const isLow = code => code >= 0xdc00 && code <= 0xdfff;

// Cuts from the front without splitting a character that is a pair of UTF-16 units.
const dropFront = (text, n) => (n > 0 && isLow(text.charCodeAt(n)) ? n + 1 : n);

// The head and the tail of a long text with a line between that says how much was left out.
export function cutMiddle(text, limit = LIMITS.handOff) {
  if (text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  const head = text.slice(0, isHigh(text.charCodeAt(half - 1)) ? half - 1 : half);
  const tail = text.slice(dropFront(text, text.length - half));
  return `${head}\n[... ${text.length - head.length - tail.length} characters cut ...]\n${tail}`;
}

// The text the CLI saves for a command run with ! in a terminal, which is what Claude is sent as the result of one.
export function handOffText({ command, stdout = '', stderr = '' }) {
  const output = text => escapeTags(cutMiddle(stripAnsi(text).trimEnd()));
  return `<bash-input>${escapeTags(command)}</bash-input><bash-stdout>${output(stdout)}</bash-stdout><bash-stderr>${output(stderr)}</bash-stderr>`;
}

// ---- the run store -------------------------------------------------------------------------------

const safeSlice = (text, from) => text.slice(dropFront(text, from));

// Adds output to a list of { stream, text } chunks, dropping the oldest once it is over `cap`. True when something was dropped.
function push(buffer, stream, text, cap) {
  const last = buffer.chunks[buffer.chunks.length - 1];
  if (last?.stream === stream) last.text += text;
  else buffer.chunks.push({ stream, text });
  buffer.size += text.length;
  let cut = false;
  while (buffer.size > cap) {
    const over = buffer.size - cap;
    const first = buffer.chunks[0];
    if (first.text.length <= over) {
      buffer.chunks.shift();
      buffer.size -= first.text.length;
    } else {
      const kept = safeSlice(first.text, over);
      buffer.size -= first.text.length - kept.length;
      first.text = kept;
    }
    cut = true;
  }
  return cut;
}

function tailOf(chunks, limit) {
  const out = [];
  let left = limit;
  for (let i = chunks.length - 1; i >= 0 && left > 0; i--) {
    const { stream, text } = chunks[i];
    out.unshift({ stream, text: text.length > left ? safeSlice(text, text.length - left) : text });
    left -= text.length;
  }
  return out;
}

// `spawn`, `shell`, `env` and `kill` are injectable so a test can run real shells or none. `emit(sessionId, event)` carries the events
// the page follows, and `onEnd(sessionId, { run, stdout, stderr })` hears a command run with ! finish and answers 'sent', 'held' or nothing.
export function makeTerminal({ spawn = nodeSpawn, shell = pickShell(), env, emit = () => {}, onEnd = () => null, kill = killGroup, home = os.homedir(), grace = 2000, flushMs = 50, limits = {} } = {}) {
  const L = { ...LIMITS, ...limits };
  const baseEnv = env || makeEnvSnapshot({ spawn, shell });
  const sessions = new Map();
  const holds = new Map();
  const stateOf = id => {
    if (!sessions.has(id)) sessions.set(id, { cwd: null, runs: [] });
    return sessions.get(id);
  };
  const summary = rec => ({ ...rec.run, output: tailOf(rec.out.chunks, L.tail) });
  const running = list => list.filter(r => r.run.running);
  const all = () => [...sessions.values()].flatMap(s => running(s.runs));
  const find = (id, runId) => {
    const rec = sessions.get(id)?.runs.find(r => r.run.id === runId);
    if (!rec) throw refuse(404, 'No such command in this session.');
    return rec;
  };
  const signal = (rec, name) => {
    if (!rec.proc?.pid) return false;
    try { kill(rec.proc.pid, name); return true; } catch { return false; }
  };

  function flush(rec) {
    clearTimeout(rec.timer);
    rec.timer = null;
    if (rec.pending.length) {
      emit(rec.session, { type: 'output', run: rec.run.id, chunks: rec.pending });
      rec.pending = [];
      rec.burst = 0;
      rec.flushedAt = Date.now();
    }
    rec.proc?.stdout?.resume();
    rec.proc?.stderr?.resume();
  }

  function append(rec, stream, text) {
    if (!text) return;
    if (push(rec.out, stream, text, L.output)) rec.run.truncated = true;
    if (rec.separate) {
      const field = stream === 'out' ? 'stdout' : 'stderr';
      const joined = rec[field] + text;
      rec[field] = joined.length > L.output ? safeSlice(joined, joined.length - L.output) : joined;
    }
    const last = rec.pending[rec.pending.length - 1];
    if (last?.stream === stream) last.text += text;
    else rec.pending.push({ stream, text });
    rec.burst += text.length;
    // A command that prints faster than the page can take is held back, so its output waits in the pipe and not in memory.
    if (rec.burst > L.burst) { rec.proc?.stdout?.pause(); rec.proc?.stderr?.pause(); }
    rec.timer ||= setTimeout(() => flush(rec), Math.max(0, rec.flushedAt + flushMs - Date.now()));
  }

  function settleCwd(rec) {
    if (rec.cwdSettled) return;
    rec.cwdSettled = true;
    const dir = Buffer.concat(rec.reported).toString('utf8');
    if (rec.run.source === 'bang' || !path.isAbsolute(dir) || !isDir(dir)) return;
    const s = stateOf(rec.session);
    if (s.cwd !== dir) {
      s.cwd = dir;
      emit(rec.session, { type: 'cwd', cwd: dir });
    }
  }

  function finish(rec, code, sig) {
    const { run } = rec;
    if (!run.running) return;
    clearTimeout(rec.killTimer);
    clearTimeout(rec.forceTimer);
    clearTimeout(rec.exitTimer);
    settleCwd(rec);
    append(rec, 'out', rec.decoders.out.end());
    append(rec, 'err', rec.decoders.err.end());
    flush(rec);
    Object.assign(run, { running: false, endedAt: Date.now(), exitCode: code, signal: sig });
    if (run.source === 'bang') {
      try {
        run.delivered = onEnd(rec.session, { run: { ...run }, stdout: rec.stdout, stderr: rec.stderr }) || null;
      } catch (e) {
        console.error(`Could not hand the result of a command to Claude: ${e.message}`);
      }
    }
    rec.stdout = rec.stderr = '';
    emit(rec.session, { type: 'run', run: summary(rec) });
  }

  async function run(id, { command, source, folder }) {
    if (typeof command !== 'string' || !command.trim()) throw refuse(400, 'Which command?');
    if (command.length > L.command) throw refuse(400, `A command can be at most ${L.command.toLocaleString('en-US')} characters.`);
    if (!SOURCES.includes(source)) throw refuse(400, 'Where does this command come from?');
    if (!folder || !isDir(folder)) throw refuse(409, 'The session\'s folder does not exist on this Mac.');
    const base = await baseEnv();
    const s = stateOf(id);
    if (running(s.runs).length >= L.perSession) throw refuse(429, `This session already has ${L.perSession} commands running.`);
    if (all().length >= L.total) throw refuse(429, `${L.total} commands are already running.`);
    // The panel carries its folder from one command to the next, and falls back to the session's if that folder is gone.
    const from = source === 'bang' ? folder : s.cwd && isDir(s.cwd) ? s.cwd : folder;
    if (source !== 'bang' && s.cwd !== from) {
      const moved = s.cwd !== null;
      s.cwd = from;
      if (moved) emit(id, { type: 'cwd', cwd: from });
    }
    const rec = {
      session: id, proc: null, out: { chunks: [], size: 0 }, pending: [], burst: 0, flushedAt: 0, timer: null, reported: [], cwdSettled: false,
      separate: source === 'bang', stdout: '', stderr: '', decoders: { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') },
      run: { id: randomBytes(6).toString('hex'), command, cwd: from, source, startedAt: Date.now(), endedAt: null, exitCode: null, signal: null, stopped: false, running: true, truncated: false, delivered: null },
    };
    s.runs.push(rec);
    // Past the number kept, the oldest finished runs go first and a running one is never dropped.
    for (let i = 0; s.runs.length > L.kept && i < s.runs.length; i++) if (!s.runs[i].run.running) s.runs.splice(i--, 1);
    start(rec, base);
    emit(id, { type: 'run', run: summary(rec) });
    return summary(rec);
  }

  function start(rec, base) {
    const { run } = rec;
    let proc;
    try {
      proc = spawn(shell, ['-c', WRAPPER, 'capcom', run.command], { cwd: run.cwd, env: { ...base, PWD: run.cwd, PAGER: 'cat', GIT_PAGER: 'cat', TERM: 'xterm-256color' }, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    } catch (e) {
      setImmediate(() => { append(rec, 'err', `Could not start the command: ${e.message}\n`); finish(rec, null, null); });
      return;
    }
    rec.proc = proc;
    for (const stream of [proc.stdin, proc.stdout, proc.stderr, proc.stdio[3]]) stream?.on('error', () => {});
    proc.stdout.on('data', chunk => append(rec, 'out', rec.decoders.out.write(chunk)));
    proc.stderr.on('data', chunk => append(rec, 'err', rec.decoders.err.write(chunk)));
    proc.stdio[3]?.on('data', chunk => rec.reported.push(chunk));
    proc.stdio[3]?.on('end', () => settleCwd(rec));
    // The shell has printed its folder before it exits, but a job it left running can keep the pipe open, so the folder is taken without waiting for close.
    proc.on('exit', (code, sig) => { rec.exit = { code, sig }; rec.exitTimer = setTimeout(() => settleCwd(rec), 100); });
    proc.on('error', e => { append(rec, 'err', `Could not start the command: ${e.message}\n`); finish(rec, null, null); });
    proc.on('close', (code, sig) => finish(rec, code, sig));
  }

  // Stop asks the whole group to end, and ends it by force if it will not. A job that moved itself out of the group and still holds
  // the pipes cannot be reached, so the run is closed from here instead of staying open for ever.
  function stop(id, runId) {
    const rec = find(id, runId);
    if (!rec.run.running) return summary(rec);
    rec.run.stopped = true;
    signal(rec, 'SIGTERM');
    rec.killTimer = setTimeout(() => {
      if (!rec.run.running) return;
      signal(rec, 'SIGKILL');
      rec.forceTimer = setTimeout(() => {
        for (const stream of [rec.proc?.stdout, rec.proc?.stderr, rec.proc?.stdio[3]]) stream?.destroy();
        finish(rec, rec.exit?.code ?? null, rec.exit?.sig ?? 'SIGKILL');
      }, 1000).unref();
    }, grace).unref();
    emit(id, { type: 'run', run: summary(rec) });
    return summary(rec);
  }

  function input(id, runId, text, eof) {
    const rec = find(id, runId);
    if (text !== undefined && typeof text !== 'string') throw refuse(400, 'Send the text as a string.');
    if (eof !== undefined && typeof eof !== 'boolean') throw refuse(400, 'eof is true or false.');
    if (!text && !eof) throw refuse(400, 'Nothing to send.');
    if (text && text.length > L.input) throw refuse(400, `At most ${L.input.toLocaleString('en-US')} characters at a time.`);
    const stdin = rec.proc?.stdin;
    if (!rec.run.running || !stdin?.writable) throw refuse(409, 'That command is not taking input.');
    if (text) stdin.write(text);
    if (eof) stdin.end();
  }

  function clear(id) {
    const s = sessions.get(id);
    if (!s) return [];
    s.runs = running(s.runs);
    const runs = s.runs.map(summary);
    emit(id, { type: 'cleared', runs });
    return runs;
  }

  return {
    run, stop, input, clear,
    cwd: (id, folder) => sessions.get(id)?.cwd || folder,
    snapshot: (id, folder) => ({ cwd: sessions.get(id)?.cwd || folder, home, runs: (sessions.get(id)?.runs || []).map(summary) }),
    // The result of a command run with ! waits here when Claude is not to reply, and goes in front of the next message sent.
    hold: (id, text) => holds.set(id, [...(holds.get(id) || []), text].slice(-50)),
    held: id => (holds.get(id) || []).join('\n\n'),
    release: id => holds.delete(id),
    killAll: () => { for (const rec of all()) signal(rec, 'SIGKILL'); },
  };
}
