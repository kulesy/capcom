// Run with `npm test`. A command run with ! is saved as one user turn of <bash-input>, <bash-stdout> and <bash-stderr> tags, and reads as `bash` items.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bashFrom } from '../lib/notices.mjs';
import { handOffText } from '../lib/terminal.mjs';
import { readAfter, readBefore, readHead } from '../lib/transcripts.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-bash-items-test-'));
const file = (name, entries) => {
  const f = path.join(base, `${name}.jsonl`);
  fs.writeFileSync(f, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return { file: f, size: fs.statSync(f).size };
};
const user = content => ({ type: 'user', timestamp: '2026-10-23T01:00:00.000Z', message: { role: 'user', content } });
const queued = prompt => ({ type: 'attachment', timestamp: '2026-10-23T01:00:01.000Z', attachment: { type: 'queued_command', commandMode: 'prompt', prompt } });
const itemsOf = (t, limit = 8000) => readBefore(t, t.size, t.size, '/work', limit).items;
const shape = items => items.map(i => (i.kind === 'bash' ? ['bash', i.command, i.stdout, i.stderr] : [i.kind, i.text]));

const CLI = '<bash-input>npm run build</bash-input><bash-stdout>&gt; capcom@0.1.0 build &amp;&amp; done</bash-stdout><bash-stderr>warn: slow</bash-stderr>';

test('a command the CLI saved reads as one bash item with its escapes undone', () => {
  const [item, ...more] = itemsOf(file('cli', [user(CLI)]));
  assert.deepEqual(more, []);
  assert.deepEqual({ kind: item.kind, command: item.command, stdout: item.stdout, stderr: item.stderr, at: item.at }, {
    kind: 'bash', command: 'npm run build', stdout: '> capcom@0.1.0 build && done', stderr: 'warn: slow', at: '2026-10-23T01:00:00.000Z',
  });
});

test('system reminders before the tags are dropped, and the text after them is the owner\'s message', () => {
  const held = `<system-reminder>Plan mode is on.</system-reminder>${CLI}\n\nNow fix the warning.`;
  const items = itemsOf(file('held', [user(held)]));
  assert.deepEqual(shape(items), [['bash', 'npm run build', '> capcom@0.1.0 build && done', 'warn: slow'], ['user', 'Now fix the warning.']]);
  assert.deepEqual(items.map(i => i.at), ['2026-10-23T01:00:00.000Z', '2026-10-23T01:00:00.000Z']);
});

test('several commands in one turn are one item each, and output with no command is its own item', () => {
  const two = '<bash-input>pwd</bash-input><bash-stdout>/work</bash-stdout><bash-stderr></bash-stderr><bash-input>false</bash-input><bash-stdout></bash-stdout><bash-stderr></bash-stderr>';
  assert.deepEqual(shape(itemsOf(file('two', [user(two)]))), [['bash', 'pwd', '/work', ''], ['bash', 'false', '', '']]);
  const split = [user('<bash-input>git pull</bash-input>'), user('<bash-stdout>Already up to date.</bash-stdout><bash-stderr></bash-stderr>')];
  assert.deepEqual(shape(itemsOf(file('split', split))), [['bash', 'git pull', '', ''], ['bash', '', 'Already up to date.', '']]);
  assert.deepEqual(shape(bashFrom('<bash-stdout>a</bash-stdout><bash-stdout>b</bash-stdout>').items), [['bash', '', 'a', ''], ['bash', '', 'b', '']]);
});

test('a message queued mid-turn and one read as it is appended read the same', () => {
  const t = file('queued', [user('first prompt'), queued(CLI)]);
  assert.deepEqual(shape(itemsOf(t)), [['user', 'first prompt'], ['bash', 'npm run build', '> capcom@0.1.0 build && done', 'warn: slow']]);
  const from = t.size;
  fs.appendFileSync(t.file, `${JSON.stringify(user(`${CLI}\n\ntyped after`))}\n`);
  assert.deepEqual(shape(readAfter(t, from, '/work', 8000).items), [['bash', 'npm run build', '> capcom@0.1.0 build && done', 'warn: slow'], ['user', 'typed after']]);
});

test('text a person typed that mentions a tag stays their message', () => {
  for (const text of ['why does <bash-input>ls</bash-input> show up?', '<bash-input>unclosed', 'run <bash-stdout>x</bash-stdout>']) {
    assert.deepEqual(shape(itemsOf(file('typed', [user(text)]))), [['user', text]], text);
  }
  assert.equal(bashFrom('plain text'), null);
});

test('output over the limit is cut with a count, and a read with no limit keeps all of it', () => {
  const long = `<bash-input>seq 1 9</bash-input><bash-stdout>${'x'.repeat(50)}</bash-stdout>`;
  const [item] = itemsOf(file('long', [user(long)]), 20);
  assert.equal(item.stdout, `${'x'.repeat(20)}\n... (30 more characters)`);
  assert.equal(bashFrom(long).items[0].stdout.length, 50);
});

test('a session that opens with a command is titled by its first message', () => {
  assert.equal(readHead(file('head-only', [user(CLI), user('Fix the build')])).title, 'Fix the build');
  assert.equal(readHead(file('head-held', [user(`${CLI}\n\nFix the warning`)])).title, 'Fix the warning');
});

test('what Capcom hands Claude reads back as the same command and output', () => {
  const stdout = '\u001b[32mok\u001b[0m <a href="x">&amp;</a>\n';
  const text = handOffText({ command: 'echo "<b>" && grep -r "a&b" .', stdout, stderr: 'x > y\n' });
  const [item] = itemsOf(file('round', [user(text)]));
  assert.deepEqual([item.command, item.stdout, item.stderr], ['echo "<b>" && grep -r "a&b" .', 'ok <a href="x">&amp;</a>', 'x > y']);
});
