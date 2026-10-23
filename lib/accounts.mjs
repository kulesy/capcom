// The Claude accounts a session can run on. Each is a Claude Code config folder with its own login, and a session stays on the account it
// started on. Nothing here picks another account for a session, so there is no failover.
// See docs/adr/20261023-a-claude-account-per-kind-of-work.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ABSOLUTE = /^(\/|~\/)/;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// `~` is the home folder. The path is never resolved through links, as the CLI hashes the string it is given.
const expand = (p, home) => path.resolve(p.startsWith('~/') ? path.join(home, p.slice(2)) : p).normalize('NFC');

// The list from config, checked and with its paths made absolute. A bad entry throws an error that names it. Each account says whether it has
// company (`several`), which decides what it inherits from the environment.
export function parseAccounts(list, home = os.homedir()) {
  if (!Array.isArray(list) || !list.length) throw new Error('accounts needs at least one account, such as [{ "name": "Default", "configDir": "~/.claude" }].');
  const names = new Map();
  const dirs = new Map();
  return list.map((entry, i) => {
    const at = `accounts[${i}]${typeof entry?.name === 'string' && entry.name.trim() ? ` ("${entry.name.trim()}")` : ''}`;
    if (!isObject(entry)) throw new Error(`${at} must be an object with a name and a configDir.`);
    if (typeof entry.name !== 'string' || !entry.name.trim()) throw new Error(`${at} needs a name that is not empty.`);
    const name = entry.name.trim();
    if (names.has(name.toLowerCase())) throw new Error(`${at} has the same name as ${names.get(name.toLowerCase())}. Names are compared without regard to case.`);
    names.set(name.toLowerCase(), at);
    if (typeof entry.configDir !== 'string' || !ABSOLUTE.test(entry.configDir)) throw new Error(`${at} needs a configDir that starts with / or ~/, not ${JSON.stringify(entry.configDir)}.`);
    const configDir = expand(entry.configDir, home);
    if (dirs.has(configDir)) throw new Error(`${at} has the same configDir as ${dirs.get(configDir)}.`);
    dirs.set(configDir, at);
    const folders = entry.folders ?? [];
    if (!Array.isArray(folders)) throw new Error(`${at} needs folders to be a list.`);
    for (const folder of folders) if (typeof folder !== 'string' || !ABSOLUTE.test(folder)) throw new Error(`${at} has a folder that does not start with / or ~/: ${JSON.stringify(folder)}.`);
    return { name, configDir, folders: folders.map(folder => expand(folder, home)), several: list.length > 1 };
  });
}

// A projectsDir still set in the config files is refused unless it is the projects folder of a listed account, as it would otherwise name
// sessions that no account lists. `projectsDir` is already made absolute.
export function checkProjectsDir(projectsDir, accounts) {
  if (projectsDir === undefined || projectsDir === null) return;
  const named = typeof projectsDir === 'string' ? path.resolve(projectsDir).normalize('NFC') : null;
  if (named && accounts.some(a => path.join(a.configDir, 'projects') === named)) return;
  const owner = named && path.basename(named) === 'projects' ? `the account with configDir ${JSON.stringify(path.dirname(named))}` : 'the account that holds those sessions';
  throw new Error(`projectsDir in config.json or config.local.json is ${JSON.stringify(projectsDir)}, which is not the projects folder of an account in accounts. Remove projectsDir and list ${owner} in accounts instead.`);
}

// The account in ~/.claude is the one the CLI uses when CLAUDE_CONFIG_DIR is not set, and Claude Desktop's.
export const isDefaultDir = configDir => configDir === path.join(os.homedir(), '.claude').normalize('NFC');

// NOTE: [23 Oct 2026] EK - Each of these overrides the login in a config folder, so with several accounts one left in the environment would put
// every account on one credential. With a single account the owner's setting is left to work as it does in a terminal.
const CREDENTIALS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];

// NOTE: [23 Oct 2026] EK - On macOS the CLI keeps a login in the Keychain under "Claude Code-credentials" when CLAUDE_CONFIG_DIR is unset, and under
// "Claude Code-credentials-" plus the first 8 hex digits of the SHA-256 of the folder string when it is set (read from CLI 2.1.309, and
// CLAUDE_SECURESTORAGE_CONFIG_DIR overrides both). Setting it to ~/.claude would miss the default login, and the string is hashed as given.
export function accountEnv(account, base = process.env) {
  const env = { ...base };
  delete env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  if (account.several) for (const name of CREDENTIALS) delete env[name];
  if (isDefaultDir(account.configDir)) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = account.configDir;
  return env;
}

export const byName = (accounts, name) => (typeof name === 'string' ? accounts.find(a => a.name.toLowerCase() === name.toLowerCase()) : undefined) ?? null;
export const byDir = (accounts, configDir) => accounts.find(a => a.configDir === configDir) ?? null;

// macOS ignores case, so a folder is compared as the disk names it where it exists.
const onDisk = p => {
  try { return fs.realpathSync.native(p).normalize('NFC'); } catch { return path.resolve(p).normalize('NFC'); }
};

const within = (p, folder) => {
  const rel = path.relative(folder, p);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

// The account whose folder is the longest match for `cwd`, on whole path segments, or the first account when none match.
export function forFolder(accounts, cwd) {
  const here = typeof cwd === 'string' && cwd ? onDisk(cwd) : null;
  let best = null;
  let length = -1;
  if (here) {
    for (const account of accounts) {
      for (const folder of account.folders) {
        const real = onDisk(folder);
        if (real.length > length && within(here, real)) { best = account; length = real.length; }
      }
    }
  }
  return best ?? accounts[0];
}

const refuse = (status, message) => Object.assign(new Error(message), { status });

// Which account each session started on, in accounts.json: a session id to the account's configDir. It is written once for a session and never
// changed, so a session that has no transcript yet still cannot be started on another account.
export function makeRecords(stateDir) {
  const file = path.join(stateDir, 'accounts.json');

  // A file that cannot be read is an error and never an empty list, because an empty one would give a session the default account.
  function read() {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return {};
      throw refuse(500, `accounts.json cannot be read: ${e.message}`);
    }
    if (!isObject(data) || Object.values(data).some(dir => typeof dir !== 'string')) throw refuse(500, 'accounts.json cannot be read: expected session ids and the config folder of each.');
    return data;
  }

  return {
    get(id) {
      const data = read();
      return Object.hasOwn(data, id) ? data[id] : null;
    },

    record(id, configDir) {
      const data = read();
      if (Object.hasOwn(data, id)) {
        if (data[id] === configDir) return;
        throw refuse(409, `Session ${id} is recorded on ${data[id]}, so it cannot be recorded on ${configDir}.`);
      }
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(Object.fromEntries([...Object.entries(data), [id, configDir]]), null, 2)}\n`);
      fs.renameSync(temp, file);
    },
  };
}
