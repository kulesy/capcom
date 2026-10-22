// Run with `npm test`. What the prompt box's / list does with the text: which word is being typed, which commands fit it and in what
// order, what picking one does to the text, and when the argument hint shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hintFor, matching, pick, typedCommand } from '../public/ui/command-rules.js';

const command = (name, extra = {}) => ({ name, description: '', hint: '', aliases: [], ...extra });
const names = list => list.map(c => c.name);

test('a word is being typed while the text starts with / and the caret is in that first word or at its end', () => {
  assert.deepEqual(typedCommand('/', 1), { query: '', end: 1 });
  assert.deepEqual(typedCommand('/rev', 4), { query: 'rev', end: 4 });
  assert.deepEqual(typedCommand('/rev', 2), { query: 'rev', end: 4 }, 'with the caret inside the word, the whole word is the query');
  assert.deepEqual(typedCommand('/rev', 1), { query: 'rev', end: 4 }, 'with the caret just after the slash');
  assert.deepEqual(typedCommand('/rev some text', 4), { query: 'rev', end: 4 }, 'with the caret at the end of the word, whatever follows');
  assert.deepEqual(typedCommand('/rev\nsome text', 4), { query: 'rev', end: 4 }, 'a new line ends the word as a space does');
});

test('nothing is being typed with the caret before the slash, after the first word, or when the text does not start with a slash', () => {
  assert.equal(typedCommand('/rev', 0), null);
  assert.equal(typedCommand('/rev ', 5), null, 'the caret after a space');
  assert.equal(typedCommand('/rev some text', 8), null, 'the caret in the arguments');
  assert.equal(typedCommand('/rev\nsome', 5), null, 'the caret on the next line');
  assert.equal(typedCommand('hello /rev', 10), null);
  assert.equal(typedCommand(' /rev', 5), null, 'a space before the slash');
  assert.equal(typedCommand('', 0), null);
  assert.equal(typedCommand('rev', 3), null);
});

test('a path that starts with a slash is a query like any other, which no command fits', () => {
  const at = typedCommand('/home/x/notes', 13);
  assert.deepEqual(at, { query: 'home/x/notes', end: 13 });
  assert.deepEqual(matching([command('init'), command('review-pr'), command('home')], at.query), []);
});

test('commands that fit rank by name, then name start, then alias, then a part of the name, then anywhere in the name, each in the CLI\'s order', () => {
  const commands = [
    command('security-review'),
    command('review-pr'),
    command('code-review', { aliases: ['review'] }),
    command('preview'),
    command('review'),
    command('review-docs'),
    command('init'),
  ];
  assert.deepEqual(names(matching(commands, 'review')), ['review', 'review-pr', 'review-docs', 'code-review', 'security-review', 'preview']);
});

test('a part of a name starts at a hyphen, an underscore, a colon or a dot', () => {
  const commands = [command('plugin:do-thing'), command('run_tests'), command('v1.beta'), command('undo')];
  assert.deepEqual(names(matching(commands, 'do')), ['plugin:do-thing', 'undo'], 'a part after a colon, then a name that only holds the query');
  assert.deepEqual(names(matching(commands, 'tests')), ['run_tests']);
  assert.deepEqual(names(matching(commands, 'beta')), ['v1.beta']);
  assert.deepEqual(names(matching(commands, 'thing')), ['plugin:do-thing']);
});

test('an alias that starts with the query fits, and a command with no aliases is not a problem', () => {
  const commands = [command('code-review', { aliases: ['review', 'cr'] }), { name: 'bare' }];
  assert.deepEqual(names(matching(commands, 'cr')), ['code-review']);
  assert.deepEqual(names(matching(commands, 'rev')), ['code-review']);
  assert.deepEqual(names(matching(commands, 'bar')), ['bare']);
});

test('the query and the names are compared without regard to case', () => {
  const commands = [command('Review-Pr'), command('code-review', { aliases: ['Review'] })];
  assert.deepEqual(names(matching(commands, 'REV')), ['Review-Pr', 'code-review']);
  assert.deepEqual(names(matching(commands, 'review-pr')), ['Review-Pr']);
});

test('an empty query fits every command in the CLI\'s order, and a query nothing fits fits none', () => {
  const commands = [command('b'), command('a'), command('c')];
  assert.deepEqual(names(matching(commands, '')), ['b', 'a', 'c']);
  assert.deepEqual(matching(commands, 'zzz'), []);
  assert.deepEqual(matching([], 'a'), []);
});

test('picking a command replaces the word being typed with the command and one space, and puts the caret after that space', () => {
  assert.deepEqual(pick('/', 'review-pr'), { text: '/review-pr ', caret: 11 });
  assert.deepEqual(pick('/rev', 'review-pr'), { text: '/review-pr ', caret: 11 });
  assert.deepEqual(pick('/review-pr', 'review-pr'), { text: '/review-pr ', caret: 11 }, 'a command typed in full');
});

test('what follows the word is kept, with the space it began with made into the space after the command', () => {
  assert.deepEqual(pick('/rev fix the bug', 'review-pr'), { text: '/review-pr fix the bug', caret: 11 });
  assert.deepEqual(pick('/rev  two spaces', 'x'), { text: '/x  two spaces', caret: 3 }, 'only one of two spaces is taken');
  assert.deepEqual(pick('/rev\tfoo', 'x'), { text: '/x foo', caret: 3 }, 'a tab is taken as a space is');
  assert.deepEqual(pick('/rev\nmore', 'x'), { text: '/x \nmore', caret: 3 }, 'a new line is kept');
});

test('the hint shows for a command or an alias typed in full with one space after it, and for nothing else', () => {
  const commands = [command('review-pr', { hint: '[number]' }), command('code-review', { hint: '[level]', aliases: ['review'] }), command('init')];
  assert.equal(hintFor(commands, '/review-pr '), '[number]');
  assert.equal(hintFor(commands, '/code-review '), '[level]');
  assert.equal(hintFor(commands, '/review '), '[level]', 'an alias shows the hint of its command');
  assert.equal(hintFor(commands, '/review-pr'), '', 'no space yet');
  assert.equal(hintFor(commands, '/review-pr  '), '', 'two spaces');
  assert.equal(hintFor(commands, '/review-pr 12'), '', 'the argument has begun');
  assert.equal(hintFor(commands, '/review-pr \n'), '');
  assert.equal(hintFor(commands, ' /review-pr '), '', 'a space before the slash');
  assert.equal(hintFor(commands, 'review-pr '), '', 'no slash');
  assert.equal(hintFor(commands, '/Review-PR '), '', 'a name is matched exactly');
  assert.equal(hintFor(commands, '/nothing '), '', 'a word that is no command');
  assert.equal(hintFor(commands, '/init '), '', 'a command with no hint');
  assert.equal(hintFor(commands, '/ '), '');
});

test('there is no hint while the commands have not loaded', () => {
  assert.equal(hintFor(undefined, '/review-pr '), '');
  assert.equal(hintFor(null, '/review-pr '), '');
  assert.equal(hintFor([], '/review-pr '), '');
});
