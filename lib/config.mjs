import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProjectsDir, parseAccounts } from './accounts.mjs';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// npm run build-app puts the app here, and the launchd agent runs the server through its executable.
export const APP = path.join(os.homedir(), 'Library', 'Application Support', 'Capcom', 'Capcom.app');
const home = p => p.replace(/^~(?=\/|$)/, os.homedir());

const readJson = (name, optional) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8')); } catch (e) { if (optional && e.code === 'ENOENT') return {}; throw e; }
};

// config.local.json is git-ignored and wins over config.json, so one machine's values never reach the repo.
const file = { station: os.hostname().split('.')[0], ...readJson('config.json'), ...readJson('config.local.json', true) };

// A bad entry stops the start with an error that names it, as running a session on the wrong account is worse than not running.
function accountsFrom() {
  const fromEnv = process.env.CAPCOM_ACCOUNTS;
  try {
    return parseAccounts(fromEnv ? JSON.parse(fromEnv) : file.accounts);
  } catch (e) {
    throw new Error(`${fromEnv ? 'CAPCOM_ACCOUNTS' : 'accounts in config.json or config.local.json'}: ${e.message}`);
  }
}

const accounts = accountsFrom();
// A projectsDir left over from before accounts would name sessions no account lists, so it stops the start unless an account's folder holds it.
checkProjectsDir(typeof file.projectsDir === 'string' ? home(file.projectsDir) : file.projectsDir, accounts);

// CAPCOM_STATE points a test instance at its own login and registry, so it never touches the real ones. CAPCOM_ACCOUNTS does the same for the accounts.
export const cfg = {
  ...file,
  port: Number(process.env.PORT || file.port),
  claude: process.env.CAPCOM_CLAUDE || file.claude,
  desktopHandoff: file.desktopHandoff === true,
  chrome: file.chrome !== false,
  passkeyOrigins: [].concat(file.passkeyOrigins || []),
  desktopDir: home(file.desktopDir),
  accounts,
  stateDir: home(process.env.CAPCOM_STATE || file.stateDir),
};

fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
