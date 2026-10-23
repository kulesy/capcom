// Run with `npm test`. The accounts a session can run on: the config that lists them, the environment each is spawned with, which one a folder
// belongs to, the record of where a session started, and the transcripts found under each account's config folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { accountEnv, byDir, byName, checkProjectsDir, forFolder, isDefaultDir, makeRecords, parseAccounts } from '../lib/accounts.mjs';
import { findTranscripts, indexTranscripts, transcriptFor, unreadableAccounts } from '../lib/transcripts.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-accounts-test-'));
const HOME = '/Users/someone';
const DEFAULT = path.join(os.homedir(), '.claude');

test('a list of accounts has its paths made absolute, with ~/ meaning the home folder', () => {
  const list = parseAccounts([{ name: 'Default', configDir: '~/.claude' }, { name: ' SSW ', configDir: '/data/claude-ssw/', folders: ['~/work', '/srv/ssw/'] }], HOME);
  assert.deepEqual(list, [
    { name: 'Default', configDir: '/Users/someone/.claude', folders: [], several: true },
    { name: 'SSW', configDir: '/data/claude-ssw', folders: ['/Users/someone/work', '/srv/ssw'], several: true },
  ]);
});

test('an account knows whether it has company', () => {
  assert.equal(parseAccounts([{ name: 'Default', configDir: '~/.claude' }], HOME)[0].several, false);
  assert.deepEqual(parseAccounts([{ name: 'One', configDir: '~/.one' }, { name: 'Two', configDir: '~/.two' }], HOME).map(a => a.several), [true, true]);
});

test('a bad list is refused with the entry named', () => {
  const entry = (extra = {}) => ({ name: 'One', configDir: '~/.claude-one', ...extra });
  for (const [list, why] of [
    [undefined, /at least one account/], [[], /at least one account/], ['x', /at least one account/],
    [[null], /accounts\[0\] must be an object/], [[{ configDir: '~/.c' }], /accounts\[0\] needs a name/], [[entry({ name: '  ' })], /accounts\[0\] needs a name/],
    [[entry(), entry({ name: 'ONE', configDir: '~/.other' })], /accounts\[1\] \("ONE"\) has the same name as accounts\[0\] \("One"\)/],
    [[entry({ configDir: '.claude' })], /accounts\[0\] \("One"\) needs a configDir that starts with/],
    [[entry({ configDir: undefined })], /needs a configDir that starts with/],
    [[entry(), entry({ name: 'Two', configDir: '~/.claude-one/' })], /accounts\[1\] \("Two"\) has the same configDir as accounts\[0\] \("One"\)/],
    [[entry({ folders: 'work' })], /needs folders to be a list/],
    [[entry({ folders: ['work'] })], /a folder that does not start with/],
    [[entry({ folders: [3] })], /a folder that does not start with/],
  ]) assert.throws(() => parseAccounts(list, HOME), why, JSON.stringify(list));
});

test('a projectsDir left in the config is accepted only as the projects folder of a listed account', () => {
  const list = parseAccounts([{ name: 'Default', configDir: '~/.claude' }, { name: 'SSW', configDir: '/data/claude-ssw' }], HOME);
  for (const unset of [undefined, null]) assert.doesNotThrow(() => checkProjectsDir(unset, list), String(unset));
  for (const named of ['/Users/someone/.claude/projects', '/Users/someone/.claude/projects/', '/data/claude-ssw/projects']) assert.doesNotThrow(() => checkProjectsDir(named, list), named);
  assert.throws(() => checkProjectsDir('/data/claude-work/projects', list), /^Error: projectsDir in config\.json or config\.local\.json is "\/data\/claude-work\/projects", which is not the projects folder of an account in accounts\. Remove projectsDir and list the account with configDir "\/data\/claude-work" in accounts instead\.$/);
  assert.throws(() => checkProjectsDir('/Users/someone/.claude/projects/-a-folder', list), /list the account that holds those sessions in accounts/);
  for (const odd of ['', 3, ['/Users/someone/.claude/projects'], false]) assert.throws(() => checkProjectsDir(odd, list), /which is not the projects folder of an account/, JSON.stringify(odd));
});

// config.mjs reads config.json and config.local.json from the folder above lib/, so it is run from a copy that has the files this test wants.
function configFrom(local, accounts) {
  const root = fs.mkdtempSync(path.join(base, 'config-'));
  fs.mkdirSync(path.join(root, 'lib'));
  for (const name of ['config.mjs', 'accounts.mjs']) fs.copyFileSync(new URL(`../lib/${name}`, import.meta.url), path.join(root, 'lib', name));
  fs.copyFileSync(new URL('../config.json', import.meta.url), path.join(root, 'config.json'));
  fs.writeFileSync(path.join(root, 'config.local.json'), JSON.stringify(local));
  const home = path.join(root, 'home');
  const env = { PATH: process.env.PATH, HOME: home, CAPCOM_STATE: path.join(root, 'state'), ...(accounts && { CAPCOM_ACCOUNTS: JSON.stringify(accounts) }) };
  return { home, ...spawnSync(process.execPath, ['--input-type=module', '-e', "const { cfg } = await import('./lib/config.mjs'); console.log(JSON.stringify(cfg.accounts.map(a => a.configDir)));"], { cwd: root, env, encoding: 'utf8' }) };
}

test('the server does not start on a projectsDir no account lists, and says which account to list instead, and one that an account holds is ignored', () => {
  const left = configFrom({ projectsDir: '~/.claude-old/projects' });
  assert.notEqual(left.status, 0);
  const old = path.join(left.home, '.claude-old');
  assert.ok(left.stderr.includes(`projectsDir in config.json or config.local.json is ${JSON.stringify(path.join(old, 'projects'))}, which is not the projects folder of an account in accounts.`), left.stderr);
  assert.ok(left.stderr.includes(`list the account with configDir ${JSON.stringify(old)} in accounts instead`), left.stderr);
  const held = configFrom({ projectsDir: '~/.claude/projects' });
  assert.equal(held.status, 0, held.stderr);
  const listed = configFrom({ projectsDir: '~/.claude-old/projects', accounts: [{ name: 'Old', configDir: '~/.claude-old' }] });
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout), [path.join(listed.home, '.claude-old')]);
  const fromEnv = configFrom({ projectsDir: '~/.claude-old/projects' }, [{ name: 'Default', configDir: '~/.claude' }]);
  assert.notEqual(fromEnv.status, 0, 'the accounts from the environment are no excuse either');
});

test('the account in ~/.claude is the default, and nothing else is', () => {
  assert.equal(isDefaultDir(DEFAULT), true);
  for (const dir of [`${DEFAULT}-ssw`, path.join(DEFAULT, 'projects'), '/elsewhere/.claude']) assert.equal(isDefaultDir(dir), false, dir);
});

test('the default account is spawned with no config folder, even one inherited, and any other with exactly its own', () => {
  const inherited = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/inherited', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/inherited-storage' };
  const normal = accountEnv({ configDir: DEFAULT }, inherited);
  assert.deepEqual(normal, { PATH: '/bin' });
  const other = accountEnv({ configDir: '/data/.claude-ssw' }, inherited);
  assert.deepEqual(other, { PATH: '/bin', CLAUDE_CONFIG_DIR: '/data/.claude-ssw' });
  assert.equal(inherited.CLAUDE_CONFIG_DIR, '/inherited', 'the environment it was given is left alone');
});

test('with more than one account the API key and tokens that override a login are not passed on, and with one they are left as they are', () => {
  const ambient = { PATH: '/bin', ANTHROPIC_API_KEY: 'key', ANTHROPIC_AUTH_TOKEN: 'token', CLAUDE_CODE_OAUTH_TOKEN: 'oauth', ANTHROPIC_BASE_URL: 'https://proxy.example' };
  for (const configDir of [DEFAULT, '/data/.claude-ssw']) {
    assert.deepEqual(Object.keys(accountEnv({ configDir, several: true }, ambient)).sort(), configDir === DEFAULT ? ['ANTHROPIC_BASE_URL', 'PATH'] : ['ANTHROPIC_BASE_URL', 'CLAUDE_CONFIG_DIR', 'PATH'], configDir);
    assert.equal(accountEnv({ configDir, several: false }, ambient).ANTHROPIC_API_KEY, 'key', configDir);
    assert.equal(accountEnv({ configDir, several: false }, ambient).CLAUDE_CODE_OAUTH_TOKEN, 'oauth', configDir);
  }
  assert.equal(ambient.ANTHROPIC_AUTH_TOKEN, 'token', 'the environment it was given is left alone');
});

test('lookup by name ignores case and by folder is exact', () => {
  const list = parseAccounts([{ name: 'Default', configDir: '~/.claude' }, { name: 'SSW', configDir: '~/.claude-ssw' }], HOME);
  assert.equal(byName(list, 'ssw'), list[1]);
  assert.equal(byName(list, 'nobody'), null);
  assert.equal(byName(list, undefined), null);
  assert.equal(byName(list, 3), null);
  assert.equal(byDir(list, list[1].configDir), list[1]);
  assert.equal(byDir(list, '/Users/someone/.claude-ssw/'), null);
});

test('a folder belongs to the account with the longest folder around it, on whole path segments, and otherwise to the first account', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(base, 'folders-')));
  const made = name => { const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); return dir; };
  const [work, deep, similar] = [made('Work'), made('Work/Client'), made('Workshop')];
  const list = parseAccounts([
    { name: 'Default', configDir: path.join(root, '.d') },
    { name: 'SSW', configDir: path.join(root, '.s'), folders: [work] },
    { name: 'Client', configDir: path.join(root, '.c'), folders: [deep] },
  ], root);
  const nameFor = cwd => forFolder(list, cwd).name;
  assert.equal(nameFor(work), 'SSW');
  assert.equal(nameFor(path.join(work, 'repo', 'src')), 'SSW');
  assert.equal(nameFor(deep), 'Client');
  assert.equal(nameFor(path.join(deep, 'app')), 'Client');
  assert.equal(nameFor(similar), 'Default', 'Workshop is not inside Work');
  assert.equal(nameFor(path.join(root, 'elsewhere')), 'Default');
  assert.equal(nameFor(undefined), 'Default');
  assert.equal(nameFor(''), 'Default');
  const link = path.join(root, 'link');
  fs.symlinkSync(work, link);
  assert.equal(nameFor(link), 'SSW', 'a link is followed to the folder it names');
  if (fs.existsSync(path.join(root, 'WORK'))) assert.equal(nameFor(path.join(root, 'WORK')), 'SSW', 'a disk that ignores case names the folder as it is on disk');
});

// ---- the record of where a session started ---------------------------------------------------------

const recordsIn = name => {
  const dir = fs.mkdtempSync(path.join(base, `${name}-`));
  return { dir, file: path.join(dir, 'accounts.json'), records: makeRecords(dir) };
};

test('a session is recorded once, the same again changes nothing, and another account is refused with a 409', () => {
  const { dir, file, records } = recordsIn('record');
  assert.equal(records.get('a'), null);
  records.record('a', '/one');
  records.record('a', '/one');
  records.record('b', '/two');
  assert.equal(records.get('a'), '/one');
  assert.equal(records.get('b'), '/two');
  assert.throws(() => records.record('a', '/two'), { status: 409, message: /recorded on \/one, so it cannot be recorded on \/two/ });
  assert.equal(records.get('a'), '/one');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: '/one', b: '/two' });
  assert.deepEqual(fs.readdirSync(dir), ['accounts.json'], 'written through a temporary file that is gone');
});

test('an id that is a name on every object is only ever an id', () => {
  const { records } = recordsIn('names');
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(records.get(id), null, id);
    records.record(id, '/one');
    assert.equal(records.get(id), '/one', id);
  }
  assert.equal(records.get('other'), null);
});

test('a file that cannot be read is an error and is never read as empty, and is not written over', () => {
  for (const text of ['{ not json', '[]', '"x"', 'null', '{"a":3}']) {
    const { file, records } = recordsIn('corrupt');
    fs.writeFileSync(file, text);
    assert.throws(() => records.get('a'), { status: 500, message: /accounts\.json cannot be read/ }, text);
    assert.throws(() => records.record('a', '/one'), { status: 500, message: /accounts\.json cannot be read/ }, text);
    assert.equal(fs.readFileSync(file, 'utf8'), text, text);
  }
});

// ---- transcripts under each account ----------------------------------------------------------------

const transcript = (configDir, slug, id) => {
  fs.mkdirSync(path.join(configDir, 'projects', slug), { recursive: true });
  fs.writeFileSync(path.join(configDir, 'projects', slug, `${id}.jsonl`), `${JSON.stringify({ type: 'user', message: { role: 'user', content: id } })}\n`);
};

test('a transcript is found under each account\'s config folder and says which, and a folder that is not there is skipped', () => {
  const root = fs.mkdtempSync(path.join(base, 'index-'));
  const [one, two, absent] = ['one', 'two', 'absent'].map(n => path.join(root, n));
  transcript(one, '-a', 'in-one');
  transcript(two, '-b', 'in-two');
  const files = indexTranscripts([{ configDir: one }, { configDir: absent }, { configDir: two }], 0);
  assert.equal(transcriptFor('in-one').account, one);
  assert.equal(transcriptFor('in-two').account, two);
  assert.equal(transcriptFor('in-two').file, path.join(two, 'projects', '-b', 'in-two.jsonl'));
  assert.equal(transcriptFor('in-one').alsoIn, undefined);
  assert.equal(files.get('in-one'), transcriptFor('in-one'));
  assert.equal(transcriptFor('nobody'), null);
});

test('an id under two accounts keeps the first and names the other, and a transcript that goes away is dropped', () => {
  const root = fs.mkdtempSync(path.join(base, 'twice-'));
  const [one, two] = ['one', 'two'].map(n => path.join(root, n));
  transcript(one, '-a', 'both');
  transcript(two, '-b', 'both');
  transcript(two, '-b', 'gone-soon');
  indexTranscripts([{ configDir: one }, { configDir: two }], 0);
  assert.equal(transcriptFor('both').account, one);
  assert.deepEqual(transcriptFor('both').alsoIn, [two]);
  assert.equal(transcriptFor('gone-soon').account, two);
  fs.rmSync(path.join(two, 'projects', '-b', 'both.jsonl'));
  fs.rmSync(path.join(two, 'projects', '-b', 'gone-soon.jsonl'));
  indexTranscripts([{ configDir: one }, { configDir: two }], 0);
  assert.equal(transcriptFor('both').alsoIn, undefined, 'moving one away settles it');
  assert.equal(transcriptFor('gone-soon'), null);
});

// A folder with no permissions reads as an error other than ENOENT, which is what a disk fault or a lost mount looks like.
function unreadableFolder(dir, check) {
  fs.chmodSync(dir, 0o000);
  try {
    check();
  } finally {
    fs.chmodSync(dir, 0o755);
  }
}

test('an account whose projects folder cannot be read keeps its last good sessions and is listed, and one that is not there is not', { skip: process.getuid?.() === 0 && 'root reads any folder' }, () => {
  const root = fs.mkdtempSync(path.join(base, 'unreadable-'));
  const [one, two, absent] = ['one', 'two', 'absent'].map(n => path.join(root, n));
  transcript(one, '-a', 'in-one');
  transcript(two, '-b', 'in-two');
  const accounts = [{ configDir: one }, { configDir: two }, { configDir: absent }];
  indexTranscripts(accounts, 0);
  assert.deepEqual(unreadableAccounts(), [], 'an account never logged in holds nothing and is not a fault');
  unreadableFolder(path.join(two, 'projects'), () => {
    transcript(one, '-a', 'new-in-one');
    indexTranscripts(accounts, 0);
    assert.deepEqual(unreadableAccounts(), [two]);
    assert.equal(transcriptFor('in-two').account, two, 'it is not read as empty');
    assert.equal(transcriptFor('new-in-one').account, one, 'and the others carry on');
  });
  indexTranscripts(accounts, 0);
  assert.deepEqual(unreadableAccounts(), []);
  assert.equal(transcriptFor('in-two').account, two);
});

test('an account that cannot be read the first time it is scanned has no sessions to keep, and is listed', { skip: process.getuid?.() === 0 && 'root reads any folder' }, () => {
  const root = fs.mkdtempSync(path.join(base, 'first-'));
  const one = path.join(root, 'one');
  transcript(one, '-a', 'hidden');
  unreadableFolder(path.join(one, 'projects'), () => {
    indexTranscripts([{ configDir: path.join(root, 'other') }, { configDir: one }], 0);
    assert.deepEqual(unreadableAccounts(), [one]);
    assert.equal(transcriptFor('hidden'), null);
  });
});

test('a session is looked for in the projects folders named, read now, with a folder that is not there skipped and one that cannot be read an error', { skip: process.getuid?.() === 0 && 'root reads any folder' }, () => {
  const root = fs.mkdtempSync(path.join(base, 'find-'));
  const [one, two, absent] = ['one', 'two', 'absent'].map(n => path.join(root, n));
  transcript(one, '-a', 'wanted');
  transcript(one, '-b', 'wanted');
  transcript(two, '-a', 'other');
  assert.deepEqual(findTranscripts('wanted', [one, two, absent]).map(f => f.file), [path.join(one, 'projects', '-a', 'wanted.jsonl'), path.join(one, 'projects', '-b', 'wanted.jsonl')]);
  assert.deepEqual(findTranscripts('wanted', [one, two]).map(f => f.configDir), [one, one]);
  assert.deepEqual(findTranscripts('nothing', [one, two, absent]), []);
  transcript(two, '-new', 'later');
  assert.equal(findTranscripts('later', [two]).length, 1, 'a file written since the index was made is found');
  fs.symlinkSync(path.join(two, 'projects', '-new'), path.join(two, 'projects', '-linked'));
  assert.equal(findTranscripts('later', [two]).length, 2, 'a link to a folder is followed');
  unreadableFolder(path.join(two, 'projects'), () => assert.throws(() => findTranscripts('wanted', [one, two]), { code: 'EACCES' }));
  unreadableFolder(path.join(one, 'projects', '-b'), () => assert.throws(() => findTranscripts('wanted', [one]), { code: 'EACCES' }));
});
