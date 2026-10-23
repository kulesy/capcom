// Run with `npm test`. The scheduler is driven by a fake clock and a fake session start, so nothing waits and nothing runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CATCH_UP_MS, dueAction, localIso, makeRoutines, makeScheduler, makeZoneFollower, PREAMBLE, stamp, wrapPrompt } from '../lib/routines.mjs';
import { nextFire } from '../lib/cron.mjs';
import { readHead } from '../lib/transcripts.mjs';

process.env.TZ = 'Australia/Sydney';
const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const HOUR = 3600_000;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-routines-test-'));

// Thursday 15 Oct 2026, 21:43:12. A weekday 07:30 routine with 737 s of jitter next fires at Friday 07:42:17.
const T0 = at(2026, 10, 15, 21, 43, 12);
const FRIDAY = at(2026, 10, 16, 7, 42, 17);
const MONDAY = at(2026, 10, 19, 7, 42, 17);

const exported = (file, cwd, extra = {}) => ({
  id: 'demo', title: 'Demo routine', cron: '30 7 * * 1-5', jitterSeconds: 737, file, cwd, model: 'haiku', effort: 'low', mode: 'bypassPermissions', enabledInDesktop: true, ...extra,
});

// One routine on a real routines.json in a scratch folder, switched on at `armed`, with a scheduler on a clock we move by hand.
function rig({ cron, jitter, armed = T0, enabled = true, patch = {}, body = 'Check the thing.' } = {}) {
  const state = fs.mkdtempSync(path.join(base, 'state-'));
  const file = path.join(state, 'SKILL.md');
  const raw = `---\nname: demo\ndescription: A demo\n---\n\n${body}\n`;
  fs.writeFileSync(file, raw);
  const store = makeRoutines(state);
  store.seed({ routines: [exported(file, state, { ...(cron && { cron }), ...(jitter !== undefined && { jitterSeconds: jitter }) })] }, T0);
  if (enabled) store.update('demo', { enabled: true, armedAt: localIso(armed) });
  if (Object.keys(patch).length) store.update('demo', patch);
  const r = { state, file, raw, store, clock: { t: T0 }, calls: [], logs: [], warns: [], working: new Set(), waiting: new Set(), stops: [], onStart: null };
  r.boot = () => {
    r.sched = makeScheduler({
      store, now: () => r.clock.t, log: l => r.logs.push(l), warn: l => r.warns.push(l),
      start: async (routine, text) => {
        const id = `s${r.calls.length + 1}`;
        r.calls.push({ routine, text, id });
        if (r.onStart) await r.onStart(routine);
        return id;
      },
      working: id => r.working.has(id),
      waiting: id => r.waiting.has(id),
      stop: id => { r.stops.push(id); r.working.delete(id); r.waiting.delete(id); },
      check: routine => (routine.cwd === '/no/such/folder' ? 'The folder does not exist.' : null),
    });
    return r.sched;
  };
  r.boot();
  r.demo = () => store.read().routines.find(x => x.id === 'demo');
  r.tickAt = async t => { r.clock.t = t; await r.sched.tick(); };
  return r;
}

// ---- Desktop's prompt ------------------------------------------------------------------------------

test('the preamble is Desktop\'s own wording, byte for byte, with its one em dash', () => {
  assert.equal(crypto.createHash('sha256').update(PREAMBLE).digest('hex'), 'f6d19dc886dc171a161b741ec1a78d4db158addd366093a74e58016991b95ccc');
  const EM = String.fromCodePoint(0x2014);
  assert.equal([...PREAMBLE].filter(c => c === EM).length, 1);
  assert.ok(PREAMBLE.includes(`clarifying questions ${EM} make reasonable choices`));
  assert.match(PREAMBLE, /"write" actions \(e\.g\. MCP tools/);
});

test('the wrapped prompt is the tag, the preamble, a blank line, the body and the closing tag', () => {
  const text = wrapPrompt('daily-scrum', '/home/x/.claude/scheduled-tasks/daily-scrum/SKILL.md', '---\nname: daily-scrum\ndescription: Weekdays\n---\n\nYou are preparing the email.\n\nSecond paragraph.\n');
  assert.equal(text, `<scheduled-task name="daily-scrum" file="/home/x/.claude/scheduled-tasks/daily-scrum/SKILL.md">\n${PREAMBLE}\n\nYou are preparing the email.\n\nSecond paragraph.\n</scheduled-task>`);
});

test('frontmatter is stripped whatever its line endings, and a body without any is kept whole', () => {
  const body = 'Line one.\n\n---\n\nAfter a rule.';
  const expected = wrapPrompt('x', '/f', `---\nname: x\n---\n${body}`);
  assert.ok(expected.endsWith(`\n\n${body}\n</scheduled-task>`));
  assert.equal(wrapPrompt('x', '/f', `---\r\nname: x\r\ndescription: y\r\n---\r\n\r\n${body}\r\n`).replace(/\r/g, ''), expected);
  assert.equal(wrapPrompt('x', '/f', `\n\n${body}\n\n\n`), expected);
  assert.equal(wrapPrompt('x', '/f', `---\n---\n${body}`), expected);
  assert.equal(wrapPrompt('x', '/f', `---\nname: x\n---`), `<scheduled-task name="x" file="/f">\n${PREAMBLE}\n\n\n</scheduled-task>`);
});

test('Capcom\'s transcript reader recognises the wrapped prompt as a routine run', () => {
  const dir = fs.mkdtempSync(path.join(base, 'transcript-'));
  const file = path.join(dir, 'abc.jsonl');
  const content = wrapPrompt('daily-scrum', '/x/SKILL.md', '---\nname: daily-scrum\n---\n\nDo it.');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'user', cwd: '/home/x', message: { role: 'user', content } })}\n`);
  const head = readHead({ file, size: fs.statSync(file).size });
  assert.equal(head.routine, 'daily-scrum');
  assert.equal(head.cwd, '/home/x');
});

// ---- times -----------------------------------------------------------------------------------------

test('local times read back, with their offset, in any zone', () => {
  const t = at(2026, 10, 16, 7, 42, 17);
  assert.equal(localIso(t), '2026-10-16T07:42:17+11:00');
  assert.equal(stamp(t), '2026-10-16 07:42:17');
  assert.equal(Date.parse(localIso(t)), t);
  for (const [zone, offset] of [['Asia/Kolkata', '+05:30'], ['America/New_York', '-04:00'], ['UTC', '+00:00'], ['Australia/Brisbane', '+10:00']]) {
    process.env.TZ = zone;
    const u = Date.UTC(2026, 9, 16, 12, 0, 0);
    assert.ok(localIso(u).endsWith(offset), `${zone}: ${localIso(u)}`);
    assert.equal(Date.parse(localIso(u)), u);
  }
  process.env.TZ = 'Australia/Sydney';
});

// ---- routines.json ---------------------------------------------------------------------------------

test('seeding copies every routine in switched off, whatever the export says, and keeps Desktop\'s own flag', () => {
  const dir = fs.mkdtempSync(path.join(base, 'seed-'));
  const store = makeRoutines(dir);
  assert.deepEqual(store.read(), { seededAt: null, routines: [] });
  const out = store.seed({ routines: [
    exported('/x/a/SKILL.md', '/home/x', { id: 'a', enabled: true, enabledInDesktop: true, title: undefined }),
    exported('/x/b/SKILL.md', '/home/x', { id: 'b', enabledInDesktop: false, title: 'Bee', model: undefined, effort: undefined, mode: undefined }),
  ] }, T0);
  assert.deepEqual(out, { added: ['a', 'b'], kept: [] });
  const { seededAt, routines } = store.read();
  assert.equal(seededAt, localIso(T0));
  assert.deepEqual(routines.map(r => [r.id, r.title, r.enabled, r.enabledInDesktop]), [['a', 'a', false, true], ['b', 'Bee', false, false]]);
  assert.deepEqual(routines[1], {
    id: 'b', title: 'Bee', cron: '30 7 * * 1-5', jitterSeconds: 737, file: '/x/b/SKILL.md', cwd: '/home/x', model: null, effort: null, mode: null,
    enabledInDesktop: false, enabled: false, armedAt: null, lastRunAt: null, lastSessionId: null, lastError: null, skipped: null,
  });
  assert.deepEqual(fs.readdirSync(dir), ['routines.json'], 'written through a temporary file that is gone');
});

test('seeding again adds new routines, leaves the rest as Capcom has them, and refreshes only what Desktop reports', () => {
  const dir = fs.mkdtempSync(path.join(base, 'reseed-'));
  const store = makeRoutines(dir);
  store.seed({ routines: [exported('/x/a/SKILL.md', '/home/x', { id: 'a' })] }, T0);
  store.update('a', { enabled: true, armedAt: localIso(T0), lastRunAt: localIso(T0), lastSessionId: 's9' });
  const out = store.seed({ routines: [
    exported('/x/a/SKILL.md', '/elsewhere', { id: 'a', cron: '0 0 * * *', enabledInDesktop: false }),
    exported('/x/c/SKILL.md', '/home/x', { id: 'c' }),
  ] }, T0 + HOUR);
  assert.deepEqual(out, { added: ['c'], kept: ['a'] });
  const { seededAt, routines } = store.read();
  assert.equal(seededAt, localIso(T0), 'the first seed stays on record');
  const a = routines.find(r => r.id === 'a');
  assert.deepEqual([a.enabled, a.cron, a.cwd, a.lastSessionId, a.enabledInDesktop], [true, '30 7 * * 1-5', '/home/x', 's9', false]);
  assert.equal(routines.find(r => r.id === 'c').enabled, false);
});

test('an export with any unusable entry changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(base, 'bad-seed-'));
  const store = makeRoutines(dir);
  for (const [bad, why] of [
    [{ id: 'a b' }, /id/], [{ cron: 'nonsense' }, /five fields/], [{ cron: '61 * * * *' }, /outside/], [{ jitterSeconds: -1 }, /jitter/], [{ jitterSeconds: 737.5 }, /whole number of seconds/],
    [{ file: 'SKILL.md' }, /absolute path of its SKILL\.md/], [{ file: '/x/"y"/SKILL.md' }, /absolute path of its SKILL\.md/], [{ cwd: 'home' }, /absolute path of its folder/],
  ]) {
    assert.throws(() => store.seed({ routines: [exported('/x/ok/SKILL.md', '/home/x', { id: 'ok' }), exported('/x/a/SKILL.md', '/home/x', { id: 'a', ...bad })] }), why);
    assert.deepEqual(fs.readdirSync(dir), [], JSON.stringify(bad));
  }
  assert.throws(() => store.seed({}), /"routines" list/);
  assert.throws(() => store.seed(null), /"routines" list/);
});

test('a routines.json that cannot be read is reported and never written over', () => {
  const dir = fs.mkdtempSync(path.join(base, 'broken-'));
  const file = path.join(dir, 'routines.json');
  const store = makeRoutines(dir);
  for (const text of ['{ not json', '[]', '{"routines":"no"}', 'null']) {
    fs.writeFileSync(file, text);
    assert.match(store.read().problem, /^routines\.json cannot be read: /);
    assert.deepEqual(store.read().routines, []);
    assert.throws(() => store.update('a', { enabled: true }), e => e.status === 500 && /cannot be read/.test(e.message));
    assert.throws(() => store.seed({ routines: [exported('/x/SKILL.md', '/home/x')] }), /cannot be read/);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
});

test('entries missing their optional fields are filled in, and a jitter is read as whole seconds', () => {
  const dir = fs.mkdtempSync(path.join(base, 'sparse-'));
  fs.writeFileSync(path.join(dir, 'routines.json'), JSON.stringify({ routines: [{ id: 'a', cron: '0 0 * * *', jitterSeconds: '12' }, { id: 'b', jitterSeconds: 737.5 }, { id: 'c', jitterSeconds: 'x' }] }));
  const { routines } = makeRoutines(dir).read();
  assert.deepEqual(routines.map(r => [r.id, r.title, r.jitterSeconds, r.enabled, r.armedAt, r.lastRunAt]), [['a', 'a', 12, false, null, null], ['b', 'b', 738, false, null, null], ['c', 'c', 0, false, null, null]]);
});

test('a routine without an id, or an id used twice, is a problem with the file, so nothing runs and nothing is written over', async () => {
  for (const [entries, why] of [
    [[{ id: 'a' }, { title: 'no id' }], /every routine needs an id/],
    [[{ id: 'a' }, 'junk'], /every routine needs an id/],
    [[{ id: 'a' }, { id: 7 }], /every routine needs an id/],
    [[{ id: 'a' }, { id: 'b' }, { id: 'a' }], /more than one routine has the id "a"/],
  ]) {
    const r = rig();
    const text = JSON.stringify({ routines: entries.map(e => (typeof e === 'object' ? { cron: '30 7 * * 1-5', jitterSeconds: 737, file: r.file, cwd: r.state, enabled: true, armedAt: localIso(T0), ...e } : e)) });
    fs.writeFileSync(path.join(r.state, 'routines.json'), text);
    assert.match(r.store.read().problem, why);
    assert.deepEqual(r.store.read().routines, []);
    await r.tickAt(FRIDAY + 3000);
    assert.equal(r.calls.length, 0);
    assert.match(r.sched.list().problem, why);
    assert.throws(() => r.store.update('a', { enabled: false }), e => e.status === 500 && why.test(e.message));
    assert.equal(fs.readFileSync(path.join(r.state, 'routines.json'), 'utf8'), text, 'the file is left as it was');
  }
});

test('the real export, when it is on this machine, seeds all ten routines switched off', { skip: !fs.existsSync('/private/tmp/claude-501/capcom-routines-seed.json') }, () => {
  const source = JSON.parse(fs.readFileSync('/private/tmp/claude-501/capcom-routines-seed.json', 'utf8'));
  const store = makeRoutines(fs.mkdtempSync(path.join(base, 'real-')));
  const { added } = store.seed(source, T0);
  assert.equal(added.length, source.routines.length);
  assert.ok(added.length >= 10);
  assert.ok(store.read().routines.every(r => r.enabled === false && r.lastRunAt === null));
  assert.equal(store.read().routines.filter(r => r.enabledInDesktop).length, source.routines.filter(r => r.enabledInDesktop).length);
});

// ---- the rules -------------------------------------------------------------------------------------

test('dueAction: waits until the fire, jitter included, then runs', () => {
  const routine = { cron: '30 7 * * 1-5', jitterSeconds: 737, armedAt: localIso(T0), lastRunAt: null };
  assert.deepEqual(dueAction(routine, FRIDAY - 1000), { action: 'wait' });
  assert.deepEqual(dueAction({ ...routine, jitterSeconds: 0 }, at(2026, 10, 16, 7, 30) - 1000), { action: 'wait' });
  assert.deepEqual(dueAction(routine, FRIDAY), { action: 'run', fireAt: FRIDAY, late: 0 });
  assert.deepEqual(dueAction(routine, FRIDAY + 20_000), { action: 'run', fireAt: FRIDAY, late: 20_000 });
});

test('dueAction: the latest missed fire runs if it is under 12 hours late, and is skipped if not', () => {
  const routine = { cron: '30 7 * * 1-5', jitterSeconds: 737, armedAt: localIso(T0), lastRunAt: null };
  assert.equal(CATCH_UP_MS, 12 * HOUR);
  assert.deepEqual(dueAction(routine, FRIDAY + 3 * HOUR + 12 * 60_000), { action: 'run', fireAt: FRIDAY, late: 3 * HOUR + 12 * 60_000 });
  assert.equal(dueAction(routine, FRIDAY + 12 * HOUR - 1000).action, 'run');
  assert.equal(dueAction(routine, FRIDAY + 12 * HOUR).action, 'skip', 'exactly 12 hours is not under 12 hours');
  assert.deepEqual(dueAction(routine, FRIDAY + 20 * HOUR), { action: 'skip', fireAt: FRIDAY, late: 20 * HOUR });
  const three = dueAction(routine, at(2026, 10, 20, 10));
  assert.deepEqual([three.action, three.fireAt], ['run', at(2026, 10, 20, 7, 42, 17)], 'Friday, Monday and Tuesday were missed; only Tuesday counts');
  const week = dueAction(routine, at(2026, 11, 5, 9));
  assert.deepEqual([week.action, week.fireAt], ['run', at(2026, 11, 5, 7, 42, 17)]);
  assert.equal(dueAction(routine, at(2026, 11, 5, 21)).action, 'skip');
});

test('dueAction: it counts from armedAt alone, which a number or a time both give', () => {
  const on = { cron: '30 7 * * 1-5', jitterSeconds: 737 };
  assert.deepEqual(dueAction({ ...on, armedAt: null }, FRIDAY), { action: 'arm' });
  assert.deepEqual(dueAction({ ...on, armedAt: 'nonsense' }, FRIDAY), { action: 'arm' });
  assert.deepEqual(dueAction({ ...on, armedAt: null, lastRunAt: localIso(T0) }, FRIDAY), { action: 'arm' }, 'a last run on its own is only a record');
  const switchedOnAfterToday = { ...on, armedAt: localIso(at(2026, 10, 16, 10)) };
  assert.equal(dueAction(switchedOnAfterToday, at(2026, 10, 16, 10, 5)).action, 'wait', 'a fire already past when it was switched on is not caught up');
  assert.equal(dueAction(switchedOnAfterToday, MONDAY).action, 'run');
  assert.equal(dueAction({ ...on, armedAt: localIso(T0), lastRunAt: localIso(at(2026, 10, 16, 9)) }, FRIDAY).action, 'run', 'lastRunAt does not move it');
  assert.equal(dueAction({ ...on, armedAt: localIso(at(2026, 10, 15, 8)) }, at(2026, 10, 15, 8, 5)).action, 'wait');
  assert.equal(dueAction({ ...on, armedAt: localIso(at(2027, 1, 1)) }, FRIDAY).action, 'wait', 'a clock that was ahead waits for the real time to catch up');
  assert.equal(dueAction({ ...on, armedAt: FRIDAY - 60_000 }, FRIDAY).action, 'run', 'a time in milliseconds works as well as a string');
  assert.equal(dueAction({ ...on, armedAt: FRIDAY + 3000 }, FRIDAY + 4 * HOUR).action, 'wait');
});

test('dueAction: a schedule that cannot be read throws, and one that never fires waits', () => {
  assert.throws(() => dueAction({ cron: 'nonsense', jitterSeconds: 0, armedAt: localIso(T0) }, FRIDAY), /five fields/);
  assert.deepEqual(dueAction({ cron: '0 0 31 2 *', jitterSeconds: 0, armedAt: localIso(T0) }, FRIDAY), { action: 'wait' });
});

// ---- the scheduler ---------------------------------------------------------------------------------

test('a routine fires once at its time, with Desktop\'s prompt, and not again until its next time', async () => {
  const r = rig();
  await r.tickAt(FRIDAY - 1000);
  assert.equal(r.calls.length, 0);
  await r.tickAt(FRIDAY);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].text, wrapPrompt('demo', r.file, r.raw));
  assert.ok(r.calls[0].text.includes('\nCheck the thing.\n</scheduled-task>'));
  assert.deepEqual([r.calls[0].routine.cwd, r.calls[0].routine.mode, r.calls[0].routine.model, r.calls[0].routine.effort, r.calls[0].routine.title], [r.state, 'bypassPermissions', 'haiku', 'low', 'Demo routine']);
  const saved = r.demo();
  assert.deepEqual([saved.lastSessionId, saved.lastError, Date.parse(saved.lastRunAt)], ['s1', null, FRIDAY]);
  assert.deepEqual(r.logs, ['Routine demo: started session s1 (due 2026-10-16 07:42:17)']);
  for (const later of [FRIDAY + 30_000, FRIDAY + 60_000, FRIDAY + 4 * HOUR, at(2026, 10, 17, 12), at(2026, 10, 18, 12), MONDAY - 1000]) await r.tickAt(later);
  assert.equal(r.calls.length, 1, 'nothing on the rest of Friday or the weekend');
  await r.tickAt(MONDAY + 12_000);
  assert.equal(r.calls.length, 2);
  assert.equal(r.demo().lastSessionId, 's2');
  assert.deepEqual(r.warns, []);
});

test('the tick that runs a little late still counts as on time, and one that runs much later is logged as a catch-up', async () => {
  const late = rig();
  await late.tickAt(FRIDAY + 90_000);
  assert.deepEqual(late.logs, ['Routine demo: started session s1 (due 2026-10-16 07:42:17)']);
  const wake = rig();
  await wake.tickAt(FRIDAY + 3 * HOUR + 12 * 60_000);
  assert.deepEqual(wake.logs, ['Routine demo: started session s1 (catch-up for 2026-10-16 07:42:17, 3 h 12 min late)']);
});

test('a routine that is switched off never fires', async () => {
  const r = rig({ enabled: false });
  for (const t of [FRIDAY, FRIDAY + HOUR, MONDAY]) await r.tickAt(t);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.logs, []);
});

test('switching on starts the schedule from now, so a fire already past is not run on top of Desktop\'s', async () => {
  const r = rig({ enabled: false });
  r.clock.t = at(2026, 10, 16, 10);
  const summary = r.sched.setEnabled('demo', true);
  assert.equal(summary.enabled, true);
  assert.equal(Date.parse(r.demo().armedAt), at(2026, 10, 16, 10));
  await r.tickAt(at(2026, 10, 16, 10, 0, 30));
  await r.tickAt(at(2026, 10, 16, 11));
  assert.equal(r.calls.length, 0);
  await r.tickAt(MONDAY);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.logs, ['Routine demo: switched on', 'Routine demo: started session s1 (due 2026-10-19 07:42:17)']);
});

test('switching on and off is checked, repeated safely, and refused when the routine could not run', async () => {
  const r = rig({ enabled: false });
  assert.throws(() => r.sched.setEnabled('demo', 'yes'), e => e.status === 400 && /true or false/.test(e.message));
  assert.throws(() => r.sched.setEnabled('demo', undefined), e => e.status === 400);
  assert.throws(() => r.sched.setEnabled('nope', true), e => e.status === 404);
  r.sched.setEnabled('demo', true);
  const armed = r.demo().armedAt;
  r.clock.t += HOUR;
  assert.equal(r.sched.setEnabled('demo', true).enabled, true);
  assert.equal(r.demo().armedAt, armed, 'switching on twice does not move the start');
  assert.equal(r.sched.setEnabled('demo', false).enabled, false);
  assert.equal(r.sched.setEnabled('demo', false).enabled, false);
  assert.equal(r.demo().enabled, false);
  r.store.update('demo', { cwd: '/no/such/folder' });
  assert.throws(() => r.sched.setEnabled('demo', true), e => e.status === 400 && /cannot be switched on\. The folder does not exist\./.test(e.message));
  r.store.update('demo', { cwd: r.state, cron: 'nonsense' });
  assert.throws(() => r.sched.setEnabled('demo', true), e => e.status === 400 && /five fields/.test(e.message));
  r.store.update('demo', { cron: '30 7 * * 1-5', file: path.join(r.state, 'gone.md') });
  assert.throws(() => r.sched.setEnabled('demo', true), e => e.status === 400 && /Cannot read .*gone\.md/.test(e.message));
  assert.equal(r.demo().enabled, false);
});

test('a fire missed while the Mac slept runs once on waking, however many were missed', async () => {
  const r = rig();
  await r.tickAt(at(2026, 10, 20, 10));
  assert.equal(r.calls.length, 1);
  assert.match(r.logs[0], /catch-up for 2026-10-20 07:42:17, 2 h 18 min late/);
  await r.tickAt(at(2026, 10, 20, 10, 0, 30));
  await r.tickAt(at(2026, 10, 20, 11));
  assert.equal(r.calls.length, 1, 'no second catch-up');
  await r.tickAt(at(2026, 10, 21, 7, 42, 30));
  assert.equal(r.calls.length, 2, 'and the schedule carries on');
});

test('a fire missed by 12 hours or more is skipped, said so, and not run later', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 12 * HOUR);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.logs, ['Routine demo: skipped the 2026-10-16 07:42:17 run (12 h late, over the 12 h limit)']);
  const saved = r.demo();
  assert.deepEqual(saved.skipped, { fireAt: localIso(FRIDAY), at: localIso(FRIDAY + 12 * HOUR), reason: '12 h late, over the 12 h limit' });
  assert.equal(Date.parse(saved.armedAt), FRIDAY + 12 * HOUR);
  assert.equal(saved.lastRunAt, null);
  await r.tickAt(FRIDAY + 12 * HOUR + 30_000);
  await r.tickAt(FRIDAY + 13 * HOUR);
  assert.equal(r.calls.length, 0);
  assert.equal(r.logs.length, 1, 'said once');
  await r.tickAt(MONDAY + 5000);
  assert.equal(r.calls.length, 1);
  assert.equal(r.demo().skipped, null, 'a run clears the note of the skip');
});

test('after several days off, a stale fire is skipped and a fire inside the window runs', async () => {
  const stale = rig();
  await stale.tickAt(at(2026, 10, 17, 12));
  assert.deepEqual(stale.logs, ['Routine demo: skipped the 2026-10-16 07:42:17 run (28 h 18 min late, over the 12 h limit)']);
  assert.equal(stale.calls.length, 0);
});

test('a run is never started while the one before it is still working', async () => {
  const r = rig({ cron: '0 7 * * *', jitter: 0 });
  await r.tickAt(at(2026, 10, 16, 7));
  assert.equal(r.calls.length, 1);
  r.working.add('s1');
  await r.tickAt(at(2026, 10, 17, 7, 0, 5));
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.logs.at(-1), 'Routine demo: skipped the 2026-10-17 07:00:00 run (the previous run is still working)');
  assert.equal(r.demo().skipped.reason, 'the previous run is still working');
  await r.tickAt(at(2026, 10, 17, 7, 1));
  assert.equal(r.calls.length, 1, 'the skipped fire is not held over for when the run ends');
  r.working.delete('s1');
  await r.tickAt(at(2026, 10, 17, 9));
  assert.equal(r.calls.length, 1);
  await r.tickAt(at(2026, 10, 18, 7, 0, 5));
  assert.equal(r.calls.length, 2);
});

test('a run now is refused while the routine is working, and allowed once it has finished', async () => {
  const r = rig();
  const first = await r.sched.runNow('demo');
  assert.equal(first.sessionId, 's1');
  assert.equal(first.routine.id, 'demo');
  assert.equal(first.routine.lastSessionId, 's1');
  r.working.add('s1');
  assert.equal(r.sched.list().routines[0].running, true);
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 409 && /still running/.test(e.message));
  assert.equal(r.calls.length, 1);
  r.working.delete('s1');
  assert.equal(r.sched.list().routines[0].running, false);
  assert.equal((await r.sched.runNow('demo')).sessionId, 's2');
  await assert.rejects(r.sched.runNow('nope'), e => e.status === 404);
});

test('a session that is still starting counts as running, so a second tick or a run now cannot double it', async () => {
  const r = rig();
  let release;
  r.onStart = () => new Promise(done => { release = done; });
  const first = r.tickAt(FRIDAY);
  assert.equal(r.calls.length, 1);
  assert.equal(r.sched.list().routines[0].running, true);
  const again = r.tickAt(FRIDAY + 30_000);
  await again;
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 409);
  assert.equal(r.calls.length, 1);
  assert.equal(r.demo().lastSessionId, null);
  release();
  await first;
  assert.equal(r.demo().lastSessionId, 's1');
  assert.equal(r.sched.list().routines[0].running, false);
  assert.equal(r.calls.length, 1);
});

test('a run now works for a routine that is switched off, and uses up fires already due but not ones to come', async () => {
  const r = rig({ enabled: false });
  r.clock.t = FRIDAY - 2 * 60_000;
  await r.sched.runNow('demo');
  assert.equal(r.demo().enabled, false);
  r.sched.setEnabled('demo', true);
  await r.tickAt(FRIDAY + 10_000);
  assert.equal(r.calls.length, 2, 'the manual run, then the fire two minutes later');
  const m = rig();
  m.clock.t = FRIDAY - 2 * 60_000;
  await m.sched.runNow('demo');
  await m.tickAt(FRIDAY + 10_000);
  assert.equal(m.calls.length, 2, 'a manual run two minutes before the fire does not stop the fire');
  const late = rig();
  late.clock.t = FRIDAY + 5 * 60_000;
  await late.sched.runNow('demo');
  await late.tickAt(FRIDAY + 6 * 60_000);
  assert.equal(late.calls.length, 1, 'a manual run after the fire time takes its place');
});

test('a session that fails to start is recorded and not retried into a second run', async () => {
  const r = rig();
  r.onStart = async () => { throw new Error('Claude did not start within 60 seconds'); };
  await r.tickAt(FRIDAY);
  assert.equal(r.calls.length, 1);
  const saved = r.demo();
  assert.deepEqual([saved.lastSessionId, saved.lastError], [null, 'Claude did not start within 60 seconds']);
  assert.equal(Date.parse(saved.lastRunAt), FRIDAY);
  assert.deepEqual(r.warns, ['Routine demo: could not start (Claude did not start within 60 seconds)']);
  await r.tickAt(FRIDAY + 30_000);
  await r.tickAt(FRIDAY + HOUR);
  assert.equal(r.calls.length, 1);
  assert.equal(r.sched.list().routines[0].running, false);
  r.onStart = null;
  await r.tickAt(MONDAY + 1000);
  assert.equal(r.calls.length, 2);
  assert.equal(r.demo().lastError, null, 'the next success clears the error');
  r.onStart = async () => { throw new Error('boom'); };
  await assert.rejects(r.sched.runNow('demo'), /boom/);
  assert.equal(r.demo().lastError, 'boom');
});

test('a missing prompt file or a folder that is gone is a clear refusal that does not start anything', async () => {
  const r = rig();
  r.store.update('demo', { file: path.join(r.state, 'gone.md') });
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 400 && /Cannot read .*gone\.md/.test(e.message));
  assert.match(r.demo().lastError, /Cannot read/);
  r.store.update('demo', { file: r.file, cwd: '/no/such/folder' });
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 400 && /The folder does not exist/.test(e.message));
  await r.tickAt(FRIDAY);
  assert.equal(r.calls.length, 0);
  assert.match(r.warns.at(-1), /could not start \(The folder does not exist\.\)/);
});

test('the prompt file is read afresh at each run, so an edit applies at once', async () => {
  const r = rig();
  await r.tickAt(FRIDAY);
  fs.writeFileSync(r.file, '---\nname: demo\ndescription: Edited\n---\n\nA new instruction.\n');
  await r.tickAt(MONDAY);
  assert.ok(r.calls[0].text.includes('Check the thing.'));
  assert.ok(r.calls[1].text.includes('A new instruction.'));
  assert.ok(!r.calls[1].text.includes('Check the thing.'));
});

test('a restart keeps the schedule: nothing runs twice, and a fire missed while down is caught up', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 3000);
  assert.equal(r.calls.length, 1);
  r.boot();
  await r.tickAt(FRIDAY + 60_000);
  await r.tickAt(at(2026, 10, 16, 12));
  assert.equal(r.calls.length, 1, 'a new scheduler on the same file does not run it again');
  assert.equal(r.sched.list().routines[0].next, localIso(MONDAY));
  r.boot();
  await r.tickAt(at(2026, 10, 19, 9, 30));
  assert.equal(r.calls.length, 2, 'down over Monday\'s fire, up at 09:30, so it catches up');
  assert.match(r.logs.at(-1), /catch-up for 2026-10-19 07:42:17, 1 h 48 min late/);
});

test('a run that was working when Capcom stopped is no longer working after it starts again', async () => {
  const r = rig();
  await r.tickAt(FRIDAY);
  r.working.add('s1');
  assert.equal(r.sched.list().routines[0].running, true);
  r.boot();
  r.working.clear();
  assert.equal(r.sched.list().routines[0].running, false);
  assert.equal((await r.sched.runNow('demo')).sessionId, 's2');
});

test('a routine switched on by hand in routines.json is armed from that moment, not caught up', async () => {
  const r = rig({ enabled: false });
  r.store.update('demo', { enabled: true });
  await r.tickAt(FRIDAY + 2 * HOUR);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.logs, ['Routine demo: is on but was never armed, so it counts from 2026-10-16 09:42:17']);
  await r.tickAt(MONDAY + 1000);
  assert.equal(r.calls.length, 1);
});

test('a hand edit to routines.json shows on the next check', async () => {
  const r = rig();
  r.store.update('demo', { cron: '0 9 * * *', jitterSeconds: 0 });
  await r.tickAt(at(2026, 10, 16, 7, 50));
  assert.equal(r.calls.length, 0, 'the old time passes without a run');
  await r.tickAt(at(2026, 10, 16, 9, 0, 10));
  assert.equal(r.calls.length, 1);
});

test('one routine that cannot run does not stop the others, and a bad schedule is said once', async () => {
  const state = fs.mkdtempSync(path.join(base, 'many-'));
  const store = makeRoutines(state);
  const files = ['a', 'b', 'c'].map(id => { const f = path.join(state, `${id}.md`); fs.writeFileSync(f, `---\nname: ${id}\n---\n\nBody ${id}\n`); return f; });
  store.seed({ routines: [
    exported(files[0], state, { id: 'a', cron: '0 7 * * *', jitterSeconds: 0 }),
    exported(files[1], state, { id: 'b', cron: '0 7 * * *', jitterSeconds: 0 }),
    exported(files[2], state, { id: 'c', cron: '0 7 * * *', jitterSeconds: 0 }),
  ] }, T0);
  for (const id of ['a', 'b', 'c']) store.update(id, { enabled: true, armedAt: localIso(T0) });
  store.update('b', { cron: 'nonsense' });
  const clock = { t: at(2026, 10, 16, 7, 0, 5) };
  const started = [];
  const warns = [];
  const sched = makeScheduler({ store, now: () => clock.t, log: () => {}, warn: l => warns.push(l), working: () => false,
    start: async routine => { started.push(routine.id); if (routine.id === 'a') throw new Error('a failed'); return `s-${routine.id}`; } });
  await sched.tick();
  await sched.tick();
  clock.t += 30_000;
  await sched.tick();
  assert.deepEqual(started, ['a', 'c']);
  assert.equal(store.read().routines.find(r => r.id === 'c').lastSessionId, 's-c');
  assert.equal(store.read().routines.find(r => r.id === 'a').lastError, 'a failed');
  assert.equal(warns.filter(w => /five fields/.test(w)).length, 1, 'the bad schedule is said once');
  assert.equal(warns.filter(w => /a failed/.test(w)).length, 1);
});

test('a routines.json that cannot be read stops the check without throwing, and is said once', async () => {
  const r = rig();
  fs.writeFileSync(path.join(r.state, 'routines.json'), '{ broken');
  await r.tickAt(FRIDAY);
  await r.tickAt(FRIDAY + 30_000);
  assert.equal(r.calls.length, 0);
  assert.equal(r.warns.length, 1);
  assert.match(r.warns[0], /routines\.json cannot be read/);
  assert.equal(r.sched.list().problem.includes('cannot be read'), true);
  assert.deepEqual(r.sched.list().routines, []);
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 500);
});

test('the list shows each routine with its next fire in local time, whether it is running, and what is wrong with it', () => {
  const r = rig({ enabled: false });
  const [item] = r.sched.list().routines;
  assert.deepEqual(Object.keys(item), ['id', 'title', 'cron', 'jitterSeconds', 'file', 'cwd', 'model', 'effort', 'mode', 'account', 'enabled', 'enabledInDesktop', 'armedAt', 'lastRunAt', 'lastSessionId', 'lastError', 'skipped', 'running', 'next', 'problem']);
  assert.deepEqual([item.id, item.title, item.enabled, item.enabledInDesktop, item.running, item.problem], ['demo', 'Demo routine', false, true, false, null]);
  assert.equal(item.next, '2026-10-16T07:42:17+11:00');
  r.store.update('demo', { cron: 'nonsense' });
  const bad = r.sched.list().routines[0];
  assert.equal(bad.next, null);
  assert.match(bad.problem, /five fields/);
  r.store.update('demo', { cron: '0 0 31 2 *' });
  assert.equal(r.sched.list().routines[0].next, null);
  r.store.update('demo', { cron: '30 7 * * 1-5', file: '/nope/SKILL.md' });
  assert.equal(r.sched.list().routines[0].problem, 'Cannot read /nope/SKILL.md.');
  r.store.update('demo', { file: r.file, cwd: '/no/such/folder' });
  assert.equal(r.sched.list().routines[0].problem, 'The folder does not exist.');
});

test('when the clocks go back, a routine in the repeated hour runs once', async () => {
  const r = rig({ cron: '30 2 * * *', jitter: 0, armed: at(2027, 4, 3, 12) });
  const first = at(2027, 4, 4, 2, 30, 10);
  const second = first + HOUR;
  assert.equal(stamp(second), stamp(first), 'the same wall-clock time, an hour apart');
  await r.tickAt(first);
  assert.equal(r.calls.length, 1);
  await r.tickAt(second);
  await r.tickAt(second + 30_000);
  assert.equal(r.calls.length, 1);
  await r.tickAt(at(2027, 4, 5, 2, 30, 10));
  assert.equal(r.calls.length, 2);
});

test('only a true switches a routine on, so a hand-written "false" or 1 never runs one, and it is said', async () => {
  const state = fs.mkdtempSync(path.join(base, 'strict-'));
  const file = path.join(state, 'SKILL.md');
  fs.writeFileSync(file, '---\nname: x\n---\n\nBody\n');
  const entry = (id, enabled) => ({ ...exported(file, state, { id, cron: '0 7 * * *', jitterSeconds: 0 }), enabled, armedAt: localIso(T0), lastRunAt: null });
  fs.writeFileSync(path.join(state, 'routines.json'), JSON.stringify({ routines: [entry('a', 'false'), entry('b', 1), entry('c', 'true'), entry('d', null), entry('e', true)] }));
  const store = makeRoutines(state);
  const started = [];
  const warns = [];
  const sched = makeScheduler({ store, now: () => at(2026, 10, 16, 7, 0, 5), log: () => {}, warn: w => warns.push(w), working: () => false, start: async r => { started.push(r.id); return `s-${r.id}`; } });
  await sched.tick();
  await sched.tick();
  assert.deepEqual(started, ['e']);
  assert.equal(warns.filter(w => /enabled flag must be true or false/.test(w)).length, 4, 'said once for each of the four, not once per check');
  const listed = Object.fromEntries(sched.list().routines.map(r => [r.id, r.problem]));
  assert.match(listed.a, /enabled flag must be true or false/);
  assert.equal(listed.e, null);
  assert.equal(store.read().routines.find(r => r.id === 'a').armedAt, null, 'a routine that is not on keeps no place in its schedule');
  assert.equal(sched.setEnabled('a', true).enabled, true, 'switching it on through the API repairs the flag');
  assert.equal(store.read().routines.find(r => r.id === 'a').enabled, true);
});

test('trouble with one routine in a check does not stop the others', async () => {
  const state = fs.mkdtempSync(path.join(base, 'isolate-'));
  const store = makeRoutines(state);
  const files = ['a', 'b'].map(id => { const f = path.join(state, `${id}.md`); fs.writeFileSync(f, `---\nname: ${id}\n---\n\nBody ${id}\n`); return f; });
  store.seed({ routines: [
    exported(files[0], state, { id: 'a', cron: '0 7 * * *', jitterSeconds: 0 }),
    exported(files[1], state, { id: 'b', cron: '0 20 * * *', jitterSeconds: 0 }),
  ] }, T0);
  store.update('a', { enabled: true, armedAt: localIso(at(2026, 10, 14)) });
  store.update('b', { enabled: true, armedAt: localIso(T0) });
  const failing = { ...store, update: (id, patch) => { if (id === 'a') throw new Error('disk full'); return store.update(id, patch); } };
  const warns = [];
  const started = [];
  const sched = makeScheduler({ store: failing, now: () => at(2026, 10, 16, 20, 0, 5), log: () => {}, warn: w => warns.push(w), working: () => false, start: async r => { started.push(r.id); return `s-${r.id}`; } });
  await sched.tick();
  assert.deepEqual(started, ['b'], 'a was 13 hours late, so skipping it needs a write, which fails; b still runs');
  assert.deepEqual(warns, ['Routine a: disk full']);
  assert.equal(store.read().routines.find(r => r.id === 'b').lastSessionId, 's-b');
});

test('a change of the Mac\'s time zone is followed, and an unknown zone is ignored', () => {
  const dir = fs.mkdtempSync(path.join(base, 'zone-'));
  const zones = ['Australia/Sydney', 'Australia/Brisbane', 'Nope/Zone'];
  for (const zone of zones) {
    fs.mkdirSync(path.join(dir, 'zoneinfo', path.dirname(zone)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'zoneinfo', zone), '');
  }
  const link = path.join(dir, 'localtime');
  const point = zone => { try { fs.unlinkSync(link); } catch {} fs.symlinkSync(path.join(dir, 'zoneinfo', zone), link); };
  const offset = () => new Date(2026, 9, 15, 12).getTimezoneOffset();
  const logs = [];
  process.env.TZ = 'Australia/Sydney';
  point('Australia/Sydney');
  const follow = makeZoneFollower({ link, log: l => logs.push(l) });
  follow();
  assert.deepEqual([offset(), logs.length], [-660, 0], 'the zone Node started in is taken as right');
  point('Australia/Brisbane');
  follow();
  assert.deepEqual([offset(), process.env.TZ, logs], [-600, 'Australia/Brisbane', ['The Mac\'s time zone is now Australia/Brisbane, so routines follow it.']]);
  assert.equal(nextFireLocalHour('30 7 * * *'), 7, 'the schedule is now read in Brisbane time');
  follow();
  assert.equal(logs.length, 1, 'said once');
  point('Nope/Zone');
  follow();
  assert.deepEqual([offset(), process.env.TZ, logs.length], [-600, 'Australia/Brisbane', 1], 'a zone Intl refuses is not applied');
  fs.unlinkSync(link);
  follow();
  assert.equal(offset(), -600, 'a missing link changes nothing');
  assert.doesNotThrow(() => makeZoneFollower({ link: path.join(dir, 'no-such-link') })());
  process.env.TZ = 'Australia/Sydney';
});

function nextFireLocalHour(cron) {
  return new Date(nextFire(cron, at(2026, 10, 15, 12))).getHours();
}

test('a routine switched on by hand starts from then, whatever it did before, so it never repeats a run Desktop made', async () => {
  // A trial run on Monday afternoon while it is off, then Desktop runs Tuesday's fire, then it is switched on by hand at 09:00.
  const trial = rig({ enabled: false });
  trial.clock.t = at(2026, 10, 19, 16);
  await trial.sched.runNow('demo');
  assert.equal(trial.demo().armedAt, null, 'a run now on a routine that is off does not give it a place in its schedule');
  trial.store.update('demo', { enabled: true });
  await trial.tickAt(at(2026, 10, 20, 9));
  assert.equal(trial.calls.length, 1, 'Tuesday 07:42:17 is not caught up');
  assert.deepEqual(trial.logs.slice(-1), ['Routine demo: is on but was never armed, so it counts from 2026-10-20 09:00:00']);
  await trial.tickAt(at(2026, 10, 21, 7, 42, 30));
  assert.equal(trial.calls.length, 2, 'and the next fire is its own');

  // Switched off through the API and on again by hand.
  const api = rig();
  await api.tickAt(FRIDAY + 3000);
  api.sched.setEnabled('demo', false);
  assert.equal(api.demo().armedAt, null);
  api.store.update('demo', { enabled: true });
  await api.tickAt(at(2026, 10, 19, 9));
  assert.equal(api.calls.length, 1, 'Monday 07:42:17 is not caught up');

  // Switched off by hand and on again by hand, with a check in between.
  const hand = rig();
  await hand.tickAt(FRIDAY + 3000);
  hand.store.update('demo', { enabled: false });
  await hand.tickAt(FRIDAY + 60_000);
  assert.equal(hand.demo().armedAt, null, 'the check lets go of its place in the schedule');
  hand.store.update('demo', { enabled: true });
  await hand.tickAt(at(2026, 10, 19, 9));
  assert.equal(hand.calls.length, 1);
});

test('an older copy of routines.json saved over it does not run a fire again, or forget a session that is working', async () => {
  const r = rig();
  const before = fs.readFileSync(path.join(r.state, 'routines.json'), 'utf8');
  await r.tickAt(FRIDAY + 3000);
  assert.equal(r.calls.length, 1);
  r.working.add('s1');
  fs.writeFileSync(path.join(r.state, 'routines.json'), before);
  assert.equal(r.demo().lastSessionId, null, 'the editor put the old record back');
  assert.equal(r.sched.list().routines[0].running, true, 'the session this process started still counts');
  await assert.rejects(r.sched.runNow('demo'), e => e.status === 409);
  await r.tickAt(FRIDAY + 3 * 60_000);
  await r.tickAt(FRIDAY + HOUR);
  assert.equal(r.calls.length, 1, 'no second run of the same fire, working or not');
  r.working.clear();
  await r.tickAt(FRIDAY + 2 * HOUR);
  assert.equal(r.calls.length, 1);
  await r.tickAt(MONDAY + 5000);
  assert.equal(r.calls.length, 2, 'the next fire still comes');
});

test('a routine that is off keeps no place in its schedule, and one that is on keeps the place its last run gave it', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 3000);
  assert.equal(Date.parse(r.demo().armedAt), FRIDAY + 3000, 'a run while on moves the place to the run');
  assert.equal(Date.parse(r.demo().lastRunAt), FRIDAY + 3000);
  r.sched.setEnabled('demo', false);
  assert.deepEqual([r.demo().enabled, r.demo().armedAt], [false, null]);
  assert.equal(r.demo().lastRunAt !== null, true, 'the record of the last run stays');
});

// ---- the limit and stuck runs ----------------------------------------------------------------------

// Four routines due at the same moment, Friday 07:00, all switched on the evening before.
function crowd(limit) {
  const state = fs.mkdtempSync(path.join(base, 'crowd-'));
  const file = path.join(state, 'SKILL.md');
  fs.writeFileSync(file, '---\nname: x\n---\n\nDo it.\n');
  const store = makeRoutines(state);
  const ids = ['a', 'b', 'c', 'd'];
  store.seed({ routines: ids.map(id => exported(file, state, { id, title: id, cron: '0 7 * * 5', jitterSeconds: 0 })) }, T0);
  for (const id of ids) store.update(id, { enabled: true, armedAt: localIso(T0) });
  const c = { store, clock: { t: T0 }, started: [], running: new Set(), logs: [] };
  c.sched = makeScheduler({
    store, limit, now: () => c.clock.t, log: l => c.logs.push(l), warn: () => {},
    start: async routine => { const id = `run-${routine.id}`; c.started.push(routine.id); c.running.add(id); return id; },
    working: id => c.running.has(id),
  });
  c.tickAt = async t => { c.clock.t = t; await c.sched.tick(); };
  return c;
}

test('no more than the limit start at once, and the rest wait their turn without being skipped', async () => {
  const c = crowd(3);
  await c.tickAt(at(2026, 10, 16, 7, 0, 5));
  assert.deepEqual(c.started, ['a', 'b', 'c']);
  await c.tickAt(at(2026, 10, 16, 7, 1, 0));
  assert.deepEqual(c.started, ['a', 'b', 'c']);
  assert.equal(c.store.read().routines.find(r => r.id === 'd').skipped, null);
  assert.equal(c.logs.filter(l => /waiting for a free place/.test(l)).length, 1);
  c.running.delete('run-b');
  await c.tickAt(at(2026, 10, 16, 7, 9, 0));
  assert.deepEqual(c.started, ['a', 'b', 'c', 'd']);
  await c.tickAt(at(2026, 10, 16, 7, 10, 0));
  assert.deepEqual(c.started, ['a', 'b', 'c', 'd']);
});

test('with no limit, every routine due starts on time', async () => {
  const c = crowd(Infinity);
  await c.tickAt(at(2026, 10, 16, 7, 0, 5));
  assert.deepEqual(c.started, ['a', 'b', 'c', 'd']);
});

test('a run only waiting for an answer is stopped and replaced when its routine is next due', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 5_000);
  assert.equal(r.calls.length, 1);
  r.working.add('s1');
  r.waiting.add('s1');
  await r.tickAt(MONDAY + 5_000);
  assert.deepEqual(r.stops, ['s1']);
  assert.equal(r.calls.length, 2);
  assert.ok(r.logs.some(l => /stopped s1, which was waiting for an answer/.test(l)));
});

test('a run still working is left alone and the next fire is skipped, as before', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 5_000);
  r.working.add('s1');
  await r.tickAt(MONDAY + 5_000);
  assert.deepEqual(r.stops, []);
  assert.equal(r.calls.length, 1);
  assert.match(r.demo().skipped.reason, /still working/);
});

test('run now replaces a stuck run, and refuses while the run is working', async () => {
  const r = rig();
  await r.tickAt(FRIDAY + 5_000);
  r.working.add('s1');
  await assert.rejects(r.sched.runNow('demo'), /still running/);
  r.waiting.add('s1');
  await r.sched.runNow('demo');
  assert.deepEqual(r.stops, ['s1']);
  assert.equal(r.calls.length, 2);
});
