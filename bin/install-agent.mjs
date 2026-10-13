// Writes a launchd agent that keeps Capcom running, from launchd/capcom.plist.template.
// It only writes the plist and prints the launchctl commands; it never starts or stops anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cfg, ROOT } from '../lib/config.mjs';

if (process.platform !== 'darwin') { console.error('launchd is macOS only.'); process.exit(1); }

const args = process.argv.slice(2);
const flag = args.findIndex(a => a === '--label' || a.startsWith('--label='));
const label = flag < 0 ? 'local.capcom' : args[flag].includes('=') ? args[flag].split('=')[1] : args[flag + 1];
if (!label || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
  console.error('Usage: npm run install-agent -- [--label <name>]\nA label uses letters, digits, dots, dashes and underscores.');
  process.exit(1);
}

// A bare name such as "claude" is looked up on PATH, the way spawn does it.
function resolveBinary(cmd) {
  const candidates = cmd.includes('/') ? [path.resolve(cmd)] : (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, cmd));
  return candidates.find(f => { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } });
}

// Version managers such as fnm hand each shell a temporary link, so the agent gets the real path behind it.
const real = f => (f ? fs.realpathSync(f) : f);
const node = real(process.execPath);
const claude = real(resolveBinary(cfg.claude));
if (!claude) {
  console.error(`Cannot find "${cfg.claude}". Install Claude Code, or set "claude" to its full path in config.local.json.`);
  process.exit(1);
}

const home = os.homedir();
const logs = path.join(home, 'Library', 'Logs', 'capcom');
const pathDirs = [...new Set([path.dirname(node), path.dirname(claude), '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])];
const values = { label, node, repo: ROOT, home, path: pathDirs.join(':'), logs };

const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plist = fs.readFileSync(path.join(ROOT, 'launchd', 'capcom.plist.template'), 'utf8')
  .replace(/\{\{(\w+)\}\}/g, (_, key) => xml(values[key]));

const agents = path.join(home, 'Library', 'LaunchAgents');
const target = path.join(agents, `${label}.plist`);
fs.mkdirSync(agents, { recursive: true });
fs.mkdirSync(logs, { recursive: true });
fs.writeFileSync(target, plist);

const domain = `gui/${process.getuid()}`;
console.log(`Wrote ${target}\nNode ${node}\nClaude ${claude}\nLogs ${logs}\n\nStart it with:`);
console.log(`  launchctl bootstrap ${domain} ${target}`);
console.log(`  launchctl kickstart -k ${domain}/${label}`);
