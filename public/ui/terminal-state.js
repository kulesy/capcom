// One chat's terminal: the runs the page holds, the folder the panel is in and the line it is typing. It is plain data and functions, so
// the components only draw what is in its store and call what it returns, and node can run it against a fake server.
//
// A command runs only because a caller of run() was told to: the owner's Run click, his Enter in the panel, or the prompt box's ! mode.
// apply() takes the server's events and never starts anything.
import { api } from './api.js';
import { createStore } from './store.js';
import { appendChunks, endedAloud, replaceRuns, upsertRun } from './terminal-rules.js';

const enc = encodeURIComponent;

export function createTerminal({ id, enabled, call = api }) {
  const store = createStore({ ready: false, cwd: '', home: '', runs: [], input: '', error: '', announce: '' });
  const route = tail => `api/sessions/${enc(id)}/terminal${tail}`;
  let sequence = 0;
  let said = 0;
  const fail = err => store.set({ error: err.message });
  const known = runId => store.get().runs.find(r => r.id === runId);
  // A status line is read again only when its words change, so every other one ends in an invisible mark.
  const spoken = text => text + (++said % 2 ? '' : '\u200b');

  function apply(event) {
    if (event.type === 'state') {
      store.set(s => ({ ready: true, cwd: event.cwd, home: event.home, runs: replaceRuns(s.runs, event.runs) }));
    } else if (event.type === 'run') {
      const was = known(event.run.id) ?? store.get().runs.find(r => r.pending && r.command === event.run.command && r.source === event.run.source);
      store.set(s => ({
        runs: upsertRun(s.runs, event.run),
        ...(was?.running && !event.run.running && { announce: spoken(endedAloud(event.run)) }),
      }));
    } else if (event.type === 'output') {
      store.set(s => ({ runs: s.runs.map(r => (r.id === event.run ? { ...r, output: appendChunks(r.output, event.chunks) } : r)) }));
    } else if (event.type === 'cwd') {
      store.set({ cwd: event.cwd });
    } else if (event.type === 'cleared') {
      store.set(s => ({ runs: replaceRuns(s.runs, event.runs) }));
    }
  }

  // The run shows at once, before the server has answered, because the first command after the server starts can wait a couple of seconds.
  // Returns '' once the server has the run, or the server's reason when it refused. The same command from the same source while one is
  // still starting is a double click, and starts nothing.
  async function run(command, source) {
    if (!enabled()) return 'This session has no terminal.';
    if (store.get().runs.some(r => r.pending && r.command === command && r.source === source)) return '';
    const key = `local-${++sequence}`;
    const waiting = {
      key, id: null, pending: true, command, cwd: store.get().cwd, source, startedAt: Date.now(), endedAt: null, exitCode: null,
      signal: null, stopped: false, running: true, truncated: false, delivered: null, output: [],
    };
    store.set(s => ({ runs: [...s.runs, waiting], error: '' }));
    try {
      const { run: started } = await call(route('/run'), { command, source });
      store.set(s => ({ runs: upsertRun(s.runs, started) }));
      return '';
    } catch (err) {
      store.set(s => ({ runs: s.runs.filter(r => r.key !== key) }));
      return err.message;
    }
  }

  async function stop(runId) {
    if (runId == null) return;
    try {
      const { run: stopped } = await call(route('/stop'), { run: runId });
      store.set(s => ({ runs: upsertRun(s.runs, stopped) }));
    } catch (err) { fail(err); }
  }

  // What is typed to a running command goes as written, and the page draws it in the output because the command has no terminal to echo it.
  async function input(runId, text, eof = false) {
    if (runId == null) return;
    store.set(s => ({ error: '', runs: s.runs.map(r => (r.id === runId ? { ...r, output: appendChunks(r.output, [{ stream: 'in', text: eof ? '^D\n' : text }]) } : r)) }));
    try {
      await call(route('/input'), { run: runId, text, eof });
    } catch (err) { fail(err); }
  }

  async function clear() {
    try {
      const reply = await call(route('/clear'), {});
      store.set(s => ({ cwd: reply.cwd ?? s.cwd, runs: replaceRuns(s.runs, reply.runs) }));
    } catch (err) { fail(err); }
  }

  const setInput = text => store.set({ input: text });
  const report = error => store.set({ error });

  return { id, store, apply, run, stop, input, clear, setInput, report };
}
