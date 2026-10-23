// Capcom's routine scheduler. Desktop's own schedule file is internal to it and has no jitter in it, so the schedules are copied
// once into routines.json and run from here, each from the prompt file Desktop keeps. See docs/adr/20261015-capcom-runs-routines-itself.md.
import fs from 'node:fs';
import path from 'node:path';
import { nextFire, parseCron } from './cron.mjs';

// A fire time that has passed is run once if it is under this late, and skipped if it is not.
export const CATCH_UP_MS = 12 * 3600_000;
// The check comes round every 30 seconds, so a run later than this is logged as a catch-up.
const ON_TIME_MS = 2 * 60_000;
// After a long stop the search for missed fires starts no further back than this, which keeps it short.
const LOOKBACK_MS = 7 * 86400_000;

// ---- Desktop's prompt -----------------------------------------------------------------------------

// NOTE: [15 Oct 2026] EK - Desktop's own wording for a routine run, copied byte for byte from its runs. It is the one place
// in this repo with an em dash. The routines were written against this text, so leave it exactly as it is.
export const PREAMBLE = 'This is an automated run of a scheduled task. The user is not present to answer questions. For implementation details, execute autonomously without asking clarifying questions — make reasonable choices and note them in your output. "write" actions (e.g. MCP tools that send, post, create, update, or delete), only take them if the task file asks for that specific action. When in doubt, producing a report of what you found is the correct output.';

const FRONTMATTER = /^---[ \t]*\r?\n(?:---|[\s\S]*?\r?\n---)[ \t]*(?:\r?\n|$)/;

// The first message of a run: the body of SKILL.md without its frontmatter, inside the tag Capcom's transcript reader looks for.
export const wrapPrompt = (id, file, text) => `<scheduled-task name="${id}" file="${file}">\n${PREAMBLE}\n\n${text.replace(FRONTMATTER, '').trim()}\n</scheduled-task>`;

// ---- times ----------------------------------------------------------------------------------------

const pad = n => String(n).padStart(2, '0');

// Local time as 2026-10-16 07:42:17, for the log.
export function stamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Local time with its offset, as 2026-10-16T07:42:17+11:00, for routines.json and the API. Date.parse reads it back.
export function localIso(ms) {
  const offset = -new Date(ms).getTimezoneOffset();
  return `${stamp(ms).replace(' ', 'T')}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

function span(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

const time = value => (typeof value === 'number' ? value : Date.parse(value)) || 0;

// Node keeps the time zone it started in, so a change of zone (a trip) is followed by watching the link macOS keeps at
// /etc/localtime. A name Intl refuses is ignored, because Node would read it as UTC.
export function makeZoneFollower({ link = '/etc/localtime', log = console.log } = {}) {
  const read = () => { try { return fs.readlinkSync(link); } catch { return null; } };
  let seen = read();
  return () => {
    const target = read();
    if (!target || target === seen) return;
    seen = target;
    const zone = target.split('/zoneinfo/')[1];
    if (!zone) return;
    try { new Intl.DateTimeFormat(undefined, { timeZone: zone }); } catch { return; }
    process.env.TZ = zone;
    log(`The Mac's time zone is now ${zone}, so routines follow it.`);
  };
}

// ---- routines.json --------------------------------------------------------------------------------

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const refuse = (status, message) => Object.assign(new Error(message), { status });

// What Capcom adds to each routine Desktop exported. `armedAt` is where the schedule counts from: the moment it was switched
// on, then each run or skipped fire. It is empty while the routine is off. `lastRunAt` is the last start or try, for the record.
const BLANK = { enabled: false, armedAt: null, lastRunAt: null, lastSessionId: null, lastError: null, skipped: null };

// The keys in the order a person reading routines.json wants them: what the routine is, then what has happened to it.
const KEYS = ['id', 'title', 'cron', 'jitterSeconds', 'file', 'cwd', 'model', 'effort', 'mode', 'account', 'enabledInDesktop', ...Object.keys(BLANK)];
const ordered = r => ({ ...Object.fromEntries(KEYS.filter(k => k in r).map(k => [k, r[k]])), ...r });

function seedProblem(s) {
  if (!isObject(s) || !/^[\w-]+$/.test(s.id ?? '')) return 'it needs an id of letters, digits, dashes and underscores.';
  try { parseCron(s.cron); } catch (e) { return e.message; }
  if (s.jitterSeconds !== undefined && !(Number.isInteger(s.jitterSeconds) && s.jitterSeconds >= 0)) return 'the jitter must be a whole number of seconds, 0 or more.';
  if (!/^\/[^"\r\n]+$/.test(s.file ?? '')) return 'it needs the absolute path of its SKILL.md.';
  if (!/^\/[^\r\n]+$/.test(s.cwd ?? '')) return 'it needs the absolute path of its folder.';
  return null;
}

// Every routine comes in switched off, whatever the export says, so a routine Desktop still runs is never run by both.
const fromSeed = s => ({
  id: s.id, title: typeof s.title === 'string' && s.title.trim() ? s.title : s.id, cron: s.cron, jitterSeconds: Number(s.jitterSeconds) || 0,
  file: s.file, cwd: s.cwd, model: s.model || null, effort: s.effort || null, mode: s.mode || null, enabledInDesktop: s.enabledInDesktop === true, ...BLANK,
});

export function makeRoutines(stateDir) {
  const file = path.join(stateDir, 'routines.json');

  // Read from disk each time, so a hand edit or a seed run from another terminal shows on the next check. A missing file is an
  // empty list. A file that cannot be read, has a routine without an id or has an id twice is reported and left alone, so a
  // typo is never written over and a copied routine never runs twice.
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!isObject(data) || !Array.isArray(data.routines)) throw new Error('expected an object with a list of routines');
      const ids = data.routines.map(r => (isObject(r) ? r.id : undefined));
      if (ids.some(id => typeof id !== 'string')) throw new Error('every routine needs an id');
      const twice = ids.find((id, i) => ids.indexOf(id) !== i);
      if (twice !== undefined) throw new Error(`more than one routine has the id "${twice}"`);
      const routines = data.routines.map(r => ({ ...BLANK, ...r, enabledInDesktop: r.enabledInDesktop === true, title: r.title || r.id, jitterSeconds: Math.round(Number(r.jitterSeconds)) || 0 }));
      return { seededAt: data.seededAt ?? null, routines };
    } catch (e) {
      return { seededAt: null, routines: [], ...(e.code === 'ENOENT' ? {} : { problem: `routines.json cannot be read: ${e.message}` }) };
    }
  }

  function write(data) {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ ...data, routines: data.routines.map(ordered) }, null, 2)}\n`);
    fs.renameSync(temp, file);
  }

  function editable() {
    const data = read();
    if (data.problem) throw refuse(500, data.problem);
    return data;
  }

  return {
    read,

    update(id, patch) {
      const data = editable();
      const routine = data.routines.find(r => r.id === id);
      if (!routine) throw refuse(404, 'No routine with that id.');
      const changed = { ...routine, ...patch };
      write({ ...data, routines: data.routines.map(r => (r === routine ? changed : r)) });
      return changed;
    },

    // Adds the routines in an export of Desktop's list that Capcom does not have, all switched off, and refreshes only the
    // note of whether Desktop still runs the ones it has. It writes nothing if any entry is unusable.
    seed(source, at = Date.now()) {
      const data = editable();
      if (!Array.isArray(source?.routines)) throw new Error('The export needs a "routines" list.');
      const problems = source.routines.map(s => [s?.id, seedProblem(s)]).filter(([, why]) => why).map(([id, why]) => `${id ?? '(no id)'}: ${why}`);
      if (problems.length) throw new Error(`Nothing was changed. ${problems.join(' ')}`);
      const have = new Set(data.routines.map(r => r.id));
      const added = [];
      const kept = [];
      const fresh = [];
      for (const s of source.routines) {
        if (have.has(s.id)) kept.push(s.id);
        else if (!added.includes(s.id)) { added.push(s.id); fresh.push(fromSeed(s)); }
      }
      const known = new Map(source.routines.map(s => [s.id, s.enabledInDesktop === true]));
      write({
        seededAt: data.seededAt || localIso(at),
        routines: [...data.routines.map(r => (known.has(r.id) ? { ...r, enabledInDesktop: known.get(r.id) } : r)), ...fresh],
      });
      return { added, kept };
    },
  };
}

// ---- when a routine fires -------------------------------------------------------------------------

// What to do about one routine at `now`. It counts from `armedAt`, so a run uses up the fires already due but not the ones to
// come. Of several missed fires only the latest matters, and only if it is under 12 hours late.
export function dueAction(routine, now) {
  const since = time(routine.armedAt);
  if (!since) return { action: 'arm' };
  const after = fire => nextFire(routine.cron, fire, routine.jitterSeconds);
  let fireAt = null;
  for (let t = after(Math.max(since, now - LOOKBACK_MS)); t !== null && t <= now; t = after(t)) fireAt = t;
  if (fireAt === null) return { action: 'wait' };
  return { action: now - fireAt < CATCH_UP_MS ? 'run' : 'skip', fireAt, late: now - fireAt };
}

// ---- the scheduler --------------------------------------------------------------------------------

// `start(routine, text)` starts a session with the wrapped prompt and resolves with its id. `working(sessionId)` says whether it is
// still busy, `waiting(sessionId)` whether that is only waiting for an answer, and `stop(sessionId)` ends it. `check(routine)`
// may name a reason the routine cannot run. `now`, `log` and `warn` let a test use a fake clock.
// At most `limit` routines run at once, as in Desktop, which keeps fewer of them fighting over one Chrome. A run that is only
// waiting for an answer does not count, and is replaced when its routine is next due.
export function makeScheduler({ store, start, working, waiting = () => false, stop = () => {}, limit = Infinity, check = () => null, now = Date.now, log = console.log, warn = console.error }) {
  const starting = new Set();
  const warned = new Map();
  const told = new Map();
  // What this process launched while a routine was on, kept apart from routines.json because a person can save an older copy of
  // that file over it. `at` is a place in the schedule that the file cannot take back, and zero once the routine is off.
  const launched = new Map();

  // A routine that cannot be read is said once, not on every check.
  const complain = (key, message) => { if (warned.get(key) !== message) { warned.set(key, message); warn(message); } };

  // The same thing said again on the next check is not logged twice.
  const tell = (key, message) => { if (told.get(key) !== message) { told.set(key, message); log(message); } };

  const runs = r => [...new Set([r.lastSessionId, launched.get(r.id)?.sessionId])].filter(id => !!id && !!working(id));
  const busy = r => starting.has(r.id) || runs(r).length > 0;
  const stuck = r => !starting.has(r.id) && runs(r).length > 0 && runs(r).every(id => waiting(id));
  const occupying = r => starting.has(r.id) || runs(r).some(id => !waiting(id));

  function replaceStuck(r) {
    const old = runs(r);
    for (const id of old) stop(id);
    log(`Routine ${r.id}: stopped ${old.join(', ')}, which was waiting for an answer, to start the new run`);
  }

  function problemWith(r) {
    try { parseCron(r.cron); } catch (e) { return e.message; }
    try { fs.accessSync(r.file, fs.constants.R_OK); } catch { return `Cannot read ${r.file}.`; }
    return check(r);
  }

  function summary(r, at = now()) {
    let next = null;
    let problem = null;
    try {
      const fire = nextFire(r.cron, at, r.jitterSeconds);
      next = fire === null ? null : localIso(fire);
      problem = problemWith(r);
    } catch (e) {
      problem = e.message;
    }
    if (!problem && typeof r.enabled !== 'boolean') problem = 'The enabled flag must be true or false, so this routine is treated as off.';
    const { id, title, cron, jitterSeconds, file, cwd, model, effort, mode, account, enabled, enabledInDesktop, armedAt, lastRunAt, lastSessionId, lastError, skipped } = r;
    return { id, title, cron, jitterSeconds, file, cwd, model, effort, mode, account: account ?? null, enabled, enabledInDesktop, armedAt, lastRunAt, lastSessionId, lastError, skipped, running: busy(r), next, problem };
  }

  function find(id) {
    const data = store.read();
    if (data.problem) throw refuse(500, data.problem);
    const routine = data.routines.find(r => r.id === id);
    if (!routine) throw refuse(404, 'No routine with that id.');
    return routine;
  }

  // The attempt is written down before the session starts, so a crash or a failed start is never retried into a second run.
  async function launch(r, how) {
    starting.add(r.id);
    try {
      let id;
      try {
        const at = now();
        store.update(r.id, { lastRunAt: localIso(at), lastSessionId: null, lastError: null, skipped: null, ...(r.enabled === true && { armedAt: localIso(at) }) });
        launched.set(r.id, { at: r.enabled === true ? at : 0, sessionId: null });
        const problem = problemWith(r);
        if (problem) throw refuse(400, problem);
        id = await start(r, wrapPrompt(r.id, r.file, fs.readFileSync(r.file, 'utf8')));
      } catch (e) {
        try { store.update(r.id, { lastError: e.message }); } catch {}
        warn(`Routine ${r.id}: could not start (${e.message})`);
        throw e;
      }
      launched.get(r.id).sessionId = id;
      try { store.update(r.id, { lastSessionId: id }); } catch (e) { warn(`Routine ${r.id}: started session ${id} but could not save it (${e.message})`); }
      log(`Routine ${r.id}: started session ${id} (${how})`);
      return id;
    } finally {
      starting.delete(r.id);
    }
  }

  function skip(r, d, t, why) {
    store.update(r.id, { armedAt: localIso(t), skipped: { fireAt: localIso(d.fireAt), at: localIso(t), reason: why } });
    log(`Routine ${r.id}: skipped the ${stamp(d.fireAt)} run (${why})`);
  }

  // What to do about one switched-on routine at `t`. It returns the promise of the run it started, if it started one. `room`
  // counts the free places under the limit, and a routine due while there are none stays due until one frees up.
  function consider(r, t, room) {
    const last = launched.get(r.id);
    const d = dueAction(last && last.at > time(r.armedAt) ? { ...r, armedAt: last.at } : r, t);
    warned.delete(r.id);
    if (d.action === 'wait') return null;
    if (d.action === 'arm') {
      store.update(r.id, { armedAt: localIso(t) });
      log(`Routine ${r.id}: is on but was never armed, so it counts from ${stamp(t)}`);
    } else if (d.action === 'skip') {
      skip(r, d, t, `${span(d.late)} late, over the ${span(CATCH_UP_MS)} limit`);
    } else if (busy(r) && !stuck(r)) {
      skip(r, d, t, 'the previous run is still working');
    } else if (room.free <= 0) {
      tell(`slot:${r.id}`, `Routine ${r.id}: waiting for a free place, with ${limit} routines already running`);
    } else {
      if (stuck(r)) replaceStuck(r);
      room.free -= 1;
      told.delete(`slot:${r.id}`);
      return launch(r, d.late < ON_TIME_MS ? `due ${stamp(d.fireAt)}` : `catch-up for ${stamp(d.fireAt)}, ${span(d.late)} late`).catch(() => {});
    }
    return null;
  }

  // A routine that is off keeps no place in its schedule, so a hand edit that switches it on starts it from then, as the API does.
  function release(r) {
    if (typeof r.enabled !== 'boolean') complain(r.id, `Routine ${r.id}: the enabled flag must be true or false, so it is treated as off`);
    if (launched.has(r.id)) launched.get(r.id).at = 0;
    if (r.armedAt) store.update(r.id, { armedAt: null });
  }

  return {
    // Fires whatever has come due. Safe to call while an earlier call is still starting a session.
    async tick() {
      const t = now();
      const data = store.read();
      if (data.problem) complain('routines.json', data.problem);
      else warned.delete('routines.json');
      const jobs = [];
      const room = { free: limit - data.routines.filter(occupying).length };
      for (const r of data.routines) {
        try {
          if (r.enabled !== true) {
            release(r);
          } else {
            const job = consider(r, t, room);
            if (job) jobs.push(job);
          }
        } catch (e) {
          complain(r.id, `Routine ${r.id}: ${e.message}`);
        }
      }
      await Promise.all(jobs);
    },

    // Runs a routine now, switched on or not, and over the limit if need be. On a routine that is on it uses up the fires
    // already due, as any run does. A run of it that is only waiting for an answer is replaced.
    async runNow(id) {
      const r = find(id);
      if (busy(r) && !stuck(r)) throw refuse(409, `${r.title} is still running.`);
      if (stuck(r)) replaceStuck(r);
      const sessionId = await launch(r, 'run now');
      return { sessionId, routine: summary(find(id)) };
    },

    // Switching on starts the schedule from now, so a fire time already past today is not run on top of Desktop's own run.
    setEnabled(id, enabled) {
      const r = find(id);
      if (typeof enabled !== 'boolean') throw refuse(400, 'Send enabled as true or false.');
      if (r.enabled === enabled) return summary(r);
      if (enabled) {
        const problem = problemWith(r);
        if (problem) throw refuse(400, `${r.title} cannot be switched on. ${problem}`);
      }
      const changed = store.update(id, enabled ? { enabled: true, armedAt: localIso(now()), skipped: null } : { enabled: false, armedAt: null });
      if (!enabled && launched.has(id)) launched.get(id).at = 0;
      log(`Routine ${id}: switched ${enabled ? 'on' : 'off'}`);
      return summary(changed);
    },

    list() {
      const data = store.read();
      return { routines: data.routines.map(r => summary(r)), problem: data.problem || null };
    },
  };
}
