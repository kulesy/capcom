import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = p => p.replace(/^~(?=\/|$)/, os.homedir());

const readJson = (name, optional) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8')); } catch (e) { if (optional && e.code === 'ENOENT') return {}; throw e; }
};

// config.local.json is git-ignored and wins over config.json, so one machine's values never reach the repo.
const file = { station: os.hostname().split('.')[0], ...readJson('config.json'), ...readJson('config.local.json', true) };

// CAPCOM_STATE points a test instance at its own login and registry, so it never touches the real ones.
export const cfg = {
  ...file,
  port: Number(process.env.PORT || file.port),
  claude: process.env.CAPCOM_CLAUDE || file.claude,
  desktopHandoff: file.desktopHandoff === true,
  desktopDir: home(file.desktopDir),
  projectsDir: home(file.projectsDir),
  stateDir: home(process.env.CAPCOM_STATE || file.stateDir),
};

fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
