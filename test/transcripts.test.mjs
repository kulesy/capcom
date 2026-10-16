// Run with `npm test`. The samples are the shapes the CLI wrote in real transcripts, trimmed to what the parser reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { noticeFrom } from '../lib/notices.mjs';
import { readAfter, readBefore, readHead, readImage } from '../lib/transcripts.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-transcripts-test-'));

const AGENT = `<task-notification>
<task-id>ab2459b937be68d30</task-id>
<tool-use-id>toolu_01B34e3V5dordKYVPdwpDocb</tool-use-id>
<output-file>/private/tmp/tasks/ab2459b937be68d30.output</output-file>
<status>completed</status>
<summary>Agent "Architecture lane for PR #144" finished</summary>
<note>A task-notification fires each time this agent stops with no live background children of its own.</note>
<result>Use &lt;b&gt; for bold &amp; keep it short.</result>
<usage><subagent_tokens>72590</subagent_tokens><tool_uses>10</tool_uses><duration_ms>42520</duration_ms></usage>
</task-notification>`;

const ORPHANS = `<task-notification>
<task-id>bougel110</task-id>
<task-id>bfvjkdpxq</task-id>
<task-id>bmqgx5aeg</task-id>
<task-id>__orphan_summary__:shell</task-id>
<status>stopped</status>
<summary>3 background shell command task(s) from the previous session have no completion record.</summary>
</task-notification>`;

const MONITOR = `<task-notification>
<task-id>b1huq9a9z</task-id>
<summary>Monitor event: "CI checks on PR 149"</summary>
<event>phpstan: fail</event>
If this event is something the user would act on now, send a PushNotification.
</task-notification>`;

const file = (name, entries) => {
  const f = path.join(base, `${name}.jsonl`);
  fs.writeFileSync(f, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return { file: f, size: fs.statSync(f).size };
};
const user = content => ({ type: 'user', timestamp: '2026-10-16T01:00:00.000Z', message: { role: 'user', content } });
const queued = (prompt, commandMode) => ({ type: 'attachment', timestamp: '2026-10-16T01:00:01.000Z', attachment: { type: 'queued_command', commandMode, prompt } });
const itemsOf = (t, limit = 8000) => readBefore(t, t.size, t.size, '/work', limit).items;

test('a finished task is a green notice with its summary, and the ids, output file, note and result behind the details', () => {
  const n = noticeFrom(AGENT);
  assert.equal(n.kind, 'system');
  assert.equal(n.state, 'done');
  assert.equal(n.title, 'Background task finished');
  assert.equal(n.text, 'Agent "Architecture lane for PR #144" finished');
  assert.deepEqual(n.details.map(d => d.label), ['Task', 'Tool call', 'Output file', 'Note', 'Result', 'Usage']);
  assert.equal(n.details[0].value, 'ab2459b937be68d30');
  assert.equal(n.details[4].value, 'Use <b> for bold & keep it short.', 'the CLI escapes what it writes, so the page shows it unescaped');
  assert.equal(n.details[5].value, 'Subagent tokens: 72590\nTool uses: 10\nDuration ms: 42520');
});

test('failed is red, and stopped and killed both read as stopped', () => {
  const failed = noticeFrom('<task-notification>\n<task-id>bi9ejho1p</task-id>\n<status>failed</status>\n<summary>Monitor "x" script failed (exit 144)</summary>\n</task-notification>');
  assert.deepEqual([failed.state, failed.title], ['failed', 'Background task failed']);
  for (const status of ['stopped', 'killed']) {
    const n = noticeFrom(`<task-notification>\n<task-id>b1</task-id>\n<status>${status}</status>\n<summary>Stopped</summary>\n</task-notification>`);
    assert.deepEqual([n.state, n.title], ['stopped', 'Background task stopped'], status);
  }
});

test('several tasks make one notice that counts them, and the CLI\'s orphan marker is never shown', () => {
  const n = noticeFrom(ORPHANS);
  assert.equal(n.title, '3 background tasks stopped');
  assert.deepEqual(n.details, [{ label: 'Tasks', value: 'bougel110, bfvjkdpxq, bmqgx5aeg' }]);
  assert.equal(JSON.stringify(n).includes('__orphan_summary__'), false);
});

test('a monitor line has no status, so it is a plain update that shows the line itself, and the model-only text waits in the details', () => {
  const n = noticeFrom(MONITOR);
  assert.equal(n.state, undefined);
  assert.equal(n.title, 'Background update');
  assert.equal(n.text, 'Monitor event: "CI checks on PR 149"');
  assert.equal(n.output, 'phpstan: fail');
  assert.deepEqual(n.details, [
    { label: 'Task', value: 'b1huq9a9z' },
    { label: 'Also sent to Claude', value: 'If this event is something the user would act on now, send a PushNotification.' },
  ]);
});

test('text after the closing tag is kept in the details, and a tag with no closing tag stays typed text', () => {
  const n = noticeFrom(`<task-notification>\n<task-id>bz10yqun4</task-id>\n<summary>Background command "gh auth" appears to be waiting</summary>\n</task-notification>\nLast output:\nPress Enter`);
  assert.deepEqual(n.details.at(-1), { label: 'Also sent to Claude', value: 'Last output:\nPress Enter' });
  assert.equal(noticeFrom('<task-notification>\n<task-id>b1</task-id>'), null);
});

test('something a person typed is never a notice, even when it mentions the tag', () => {
  assert.equal(noticeFrom('Why does <task-notification> show up in my chat?'), null);
  assert.equal(noticeFrom('fix the <agent-message> parser'), null);
  assert.equal(noticeFrom('<div>pasted markup</div>'), null);
});

test('a long field is cut at the output limit, with the count of what was left out', () => {
  const n = noticeFrom(`<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Done</summary>\n<result>${'x'.repeat(50)}</result>\n</task-notification>`, 20);
  assert.equal(n.details.at(-1).value, `${'x'.repeat(20)}\n... (30 more characters)`);
});

test('a command run with ! shows the command and what it printed, escapes undone', () => {
  const n = noticeFrom('<bash-input>npm run build</bash-input><bash-stdout>&gt; capcom@0.1.0 build &amp;&amp; done</bash-stdout><bash-stderr>warn: slow</bash-stderr>');
  assert.equal(n.title, 'You ran a command');
  assert.equal(n.text, 'npm run build');
  assert.equal(n.output, '> capcom@0.1.0 build && done\nwarn: slow');
  const out = noticeFrom('<bash-stdout></bash-stdout><bash-stderr>sudo: a password is required\n</bash-stderr>');
  assert.deepEqual([out.title, out.text, out.output], ['Command output', undefined, 'sudo: a password is required']);
});

test('a message from another session shows its text and keeps the sender in the details; one written for Claude alone is all details', () => {
  const m = noticeFrom('<cross-session-message from="uds:/tmp/cc.sock" from-name="Write the rule" from-mode="bypass">\nI will stop my dev server soon.\n</cross-session-message>');
  assert.equal(m.title, 'Message from another session');
  assert.equal(m.text, 'I will stop my dev server soon.');
  assert.deepEqual(m.details, [{ label: 'From', value: 'uds:/tmp/cc.sock' }, { label: 'From name', value: 'Write the rule' }, { label: 'From mode', value: 'bypass' }]);
  const idle = noticeFrom('<side-sessions-event>None of the sessions you started is working now.</side-sessions-event>');
  assert.equal(idle.text, undefined);
  assert.deepEqual(idle.details, [{ label: 'Also sent to Claude', value: 'None of the sessions you started is working now.' }]);
  assert.equal(noticeFrom('<ci-monitor-event>Auto-fix is watching PR 7710.</ci-monitor-event>').title, 'Pull request monitor');
  assert.equal(noticeFrom('<agent-message from="a09d">[Subagent hand-back] Report.</agent-message>').title, 'Message from a subagent');
});

test('a task that ends while Claude is idle (a user entry) and one that ends mid-turn (a queued attachment) both show as notices', () => {
  const t = file('shapes', [user('first prompt'), user(AGENT), queued(ORPHANS, 'task-notification'), queued('redirect the work', 'prompt')]);
  const items = itemsOf(t);
  assert.deepEqual(items.map(i => [i.kind, i.title || i.text]), [
    ['user', 'first prompt'],
    ['system', 'Background task finished'],
    ['system', '3 background tasks stopped'],
    ['user', 'redirect the work'],
  ]);
  assert.equal(items[1].at, '2026-10-16T01:00:00.000Z');
});

test('the same two shapes read the same on the live path, which reads only what was appended', () => {
  const t = file('live', [user('first prompt')]);
  const from = t.size;
  fs.appendFileSync(t.file, [user(MONITOR), queued(AGENT, 'task-notification')].map(e => JSON.stringify(e)).join('\n') + '\n');
  const r = readAfter(t, from, '/work', 8000);
  assert.deepEqual(r.items.map(i => [i.kind, i.title]), [['system', 'Background update'], ['system', 'Background task finished']]);
});

test('a notice from a sidechain or a meta entry is not shown', () => {
  const t = file('skipped', [{ ...user(AGENT), isSidechain: true }, { ...user(AGENT), isMeta: true }, user('hello')]);
  assert.deepEqual(itemsOf(t).map(i => i.kind), ['user']);
});

test('pasted text loses the CLI\'s paste tags and stays a message from the person', () => {
  const t = file('pasted', [user('<pasted_content id="3852">\nName: Ryon\n</pasted_content id="3852">'), user('see <pasted_content id="1">the log</pasted_content> please')]);
  assert.deepEqual(itemsOf(t).map(i => i.text), ['Name: Ryon', 'see the log please']);
});

test('a session whose first entry is a notice is titled by its first real prompt', () => {
  const t = file('head', [{ ...user(ORPHANS), cwd: '/work' }, { ...user('Fix the login bug'), cwd: '/work' }]);
  assert.equal(readHead(t).title, 'Fix the login bug');
});

const assistant = (id, content) => ({ type: 'assistant', timestamp: '2026-10-16T01:00:02.000Z', message: { id, role: 'assistant', content } });

test('a thinking block that has text is a thinking item beside the reply it belongs to, and a redacted one shows nothing', () => {
  const t = file('thinking', [
    user('is 2027 prime?'),
    assistant('msg_1', [{ type: 'thinking', thinking: 'Checking divisors up to 45.', signature: 'sig' }]),
    assistant('msg_1', [{ type: 'thinking', thinking: '', signature: 'sig' }]),
    assistant('msg_1', [{ type: 'text', text: 'Yes.' }]),
  ]);
  assert.deepEqual(itemsOf(t).map(i => [i.kind, i.msgId, i.text]), [
    ['user', undefined, 'is 2027 prime?'],
    ['thinking', 'msg_1', 'Checking divisors up to 45.'],
    ['assistant', 'msg_1', 'Yes.'],
  ]);
});

test('a long thinking summary is cut at the output limit', () => {
  const t = file('long-thinking', [assistant('msg_2', [{ type: 'thinking', thinking: 'y'.repeat(30) }])]);
  assert.equal(itemsOf(t, 10)[0].text, `${'y'.repeat(10)}\n... (20 more characters)`);
});

const picture = (bytes, media_type = 'image/png') => ({ type: 'image', source: { type: 'base64', media_type, data: Buffer.from(bytes).toString('base64') } });
const toolResult = (id, content) => ({ type: 'tool_result', tool_use_id: id, content });
const line = (uuid, content) => ({ ...user(content), uuid });
// Where the second entry of a file starts, which is the number its refs begin with.
const startOfSecond = first => Buffer.byteLength(JSON.stringify(first)) + 1;
const resultsOf = items => items.filter(i => i.kind === 'result');

test('a tool result lists the pictures the page can draw and keeps its text, marking only a picture it cannot draw', () => {
  const t = file('tool-pictures', [line('u1', [
    toolResult('toolu_1', [{ type: 'text', text: 'Took a screenshot.' }, picture([1, 2, 3]), picture([4, 5, 6], 'image/bmp')]),
    toolResult('toolu_2', [picture([7, 8, 9], 'image/jpeg')]),
    toolResult('toolu_3', [{ type: 'text', text: 'Only words.' }]),
    toolResult('toolu_4', 'A plain string.'),
  ])]);
  const [mixed, alone, words, plain] = resultsOf(itemsOf(t));
  assert.equal(mixed.output, 'Took a screenshot.\n[image]');
  assert.deepEqual(mixed.images, [{ ref: '0.r0.u1', type: 'image/png' }]);
  assert.equal(alone.output, '', 'a picture that is listed leaves no placeholder behind');
  assert.deepEqual(alone.images, [{ ref: '0.r1.u1', type: 'image/jpeg' }]);
  assert.equal(words.output, 'Only words.');
  assert.equal(plain.output, 'A plain string.');
  assert.equal('images' in words || 'images' in plain, false, 'a result with no picture carries no list');
});

test('pictures are numbered across every result on a line, and the live path reads them the same way', () => {
  const first = line('u0', 'hello');
  const second = line('u2', [
    toolResult('toolu_a', [picture([1]), { type: 'text', text: 'A' }, picture([2])]),
    toolResult('toolu_b', [{ type: 'text', text: 'B' }, picture([3])]),
  ]);
  const t = file('numbering', [first, second]);
  const at = startOfSecond(first);
  const [a, b] = resultsOf(itemsOf(t));
  assert.deepEqual(a.images.map(i => i.ref), [`${at}.r0.u2`, `${at}.r1.u2`]);
  assert.deepEqual(b.images.map(i => i.ref), [`${at}.r2.u2`]);
  const live = readAfter(t, at, '/work', 8000);
  assert.deepEqual(resultsOf(live.items).flatMap(r => r.images.map(i => i.ref)), [`${at}.r0.u2`, `${at}.r1.u2`, `${at}.r2.u2`]);
});

const TOOL_A = [0, 1, 2, 250, 255];
const TOOL_B = [9, 8, 7, 128];
const SENT_0 = [10, 11, 12, 200];
const SENT_1 = [13, 14, 15, 201];

test('readImage gives back the picture a ref names, an r ref the tool\'s and a plain one the user\'s, on a line that holds both', () => {
  const first = line('u0', 'hello');
  const second = line('u1', [
    toolResult('toolu_a', [{ type: 'text', text: 'A' }, picture(TOOL_A)]),
    picture(SENT_0),
    toolResult('toolu_b', [picture(TOOL_B, 'image/jpeg')]),
    picture(SENT_1, 'image/webp'),
  ]);
  const t = file('mixed-line', [first, second]);
  const at = startOfSecond(first);
  const items = itemsOf(t);
  const sent = items.find(i => i.kind === 'user' && i.images);
  assert.deepEqual(sent.images, [{ ref: `${at}.0.u1`, type: 'image/png' }, { ref: `${at}.1.u1`, type: 'image/webp' }], 'a sent picture is still named by its plain number');
  assert.deepEqual(resultsOf(items).flatMap(r => r.images.map(i => i.ref)), [`${at}.r0.u1`, `${at}.r1.u1`]);
  const bytes = ref => { const got = readImage(t, ref); return got && [got.type, [...got.bytes]]; };
  assert.deepEqual(bytes(`${at}.r0.u1`), ['image/png', TOOL_A]);
  assert.deepEqual(bytes(`${at}.r1.u1`), ['image/jpeg', TOOL_B]);
  assert.deepEqual(bytes(`${at}.0.u1`), ['image/png', SENT_0]);
  assert.deepEqual(bytes(`${at}.1.u1`), ['image/webp', SENT_1]);
  assert.equal(readImage(t, `${at}.r2.u1`), null, 'there is no third tool picture');
  assert.equal(readImage(t, `${at}.2.u1`), null, 'and no third sent one');
});

test('readImage gives nothing for the wrong uuid, a ref that is badly formed, a line that is not a user entry, or a picture of the other kind', () => {
  const first = line('u0', 'hello');
  const second = line('u1', [toolResult('toolu_a', [picture(TOOL_A)])]);
  const third = line('u2', [picture(SENT_0)]);
  const queuedWithPicture = { ...queued([{ type: 'text', text: 'redirect' }, picture(SENT_1)], 'prompt'), uuid: 'u3' };
  const notUser = { type: 'assistant', uuid: 'u4', message: { role: 'assistant', content: [toolResult('toolu_z', [picture(TOOL_B)])] } };
  const t = file('refusals', [first, second, third, queuedWithPicture, notUser]);
  const at2 = startOfSecond(first);
  const at3 = at2 + Buffer.byteLength(JSON.stringify(second)) + 1;
  const at4 = at3 + Buffer.byteLength(JSON.stringify(third)) + 1;
  const at5 = at4 + Buffer.byteLength(JSON.stringify(queuedWithPicture)) + 1;
  assert.notEqual(readImage(t, `${at2}.r0.u1`), null);
  assert.notEqual(readImage(t, `${at3}.0.u2`), null);
  assert.notEqual(readImage(t, `${at4}.0.u3`), null, 'a queued message\'s picture is still reached by its plain ref');
  assert.equal(readImage(t, `${at2}.r0.u9`), null, 'wrong uuid, tool picture');
  assert.equal(readImage(t, `${at3}.0.u9`), null, 'wrong uuid, sent picture');
  assert.equal(readImage(t, `${at2}.0.u1`), null, 'a plain ref never reaches a tool picture');
  assert.equal(readImage(t, `${at3}.r0.u2`), null, 'an r ref never reaches a sent picture');
  assert.equal(readImage(t, `${at4}.r0.u3`), null, 'an r ref never reaches a queued message');
  assert.equal(readImage(t, `${at5}.r0.u4`), null, 'an r ref reads only a user entry, whatever else holds a tool_result');
  assert.equal(readImage(t, `${at2 + 1}.r0.u1`), null, 'an offset that is not the start of a line');
  for (const bad of ['', undefined, null, 'abc', `${at2}`, `${at2}.u1`, `${at2}.r.u1`, `${at2}.R0.u1`, `${at2}.rr0.u1`, `${at2}.r-1.u1`, `${at2}.r0.u1.x`, `${at2}.r0`, `-1.r0.u1`, `${at2}.r0.u 1`, `${at2}.r0.u1/..`]) {
    assert.equal(readImage(t, bad), null, String(bad));
  }
});
