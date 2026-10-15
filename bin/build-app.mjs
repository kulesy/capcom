// Builds Capcom.app from macos/, the small app the launchd agent runs the server through, so that macOS
// asks about permissions for Capcom. It replaces an earlier build and never starts or stops anything.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP, ROOT } from '../lib/config.mjs';

if (process.platform !== 'darwin') { console.error('Capcom.app is macOS only.'); process.exit(1); }

const args = process.argv.slice(2);
const flag = args.findIndex(a => a === '--id' || a.startsWith('--id='));
const id = flag < 0 ? 'local.capcom' : args[flag].includes('=') ? args[flag].split('=')[1] : args[flag + 1];
if (!id || !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(id)) {
  console.error('Usage: npm run build-app -- [--id <bundle id>]\nA bundle id is dotted parts of letters, digits and dashes, such as com.example.capcom.');
  process.exit(1);
}

const run = (cmd, ...rest) => execFileSync(cmd, rest, { stdio: ['ignore', 'ignore', 'inherit'] });
fs.mkdirSync(path.dirname(APP), { recursive: true });
const work = fs.mkdtempSync(path.join(path.dirname(APP), '.build-'));
const bundle = path.join(work, 'Capcom.app');
const contents = path.join(bundle, 'Contents');
fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
fs.mkdirSync(path.join(contents, 'Resources'));

try {
  run('xcrun', 'swiftc', '-O', '-o', path.join(contents, 'MacOS', 'capcom'), path.join(ROOT, 'macos', 'capcom.swift'));
} catch {
  fs.rmSync(work, { recursive: true, force: true });
  console.error('Building Capcom.app needs Swift. Install the Xcode command line tools with xcode-select --install.');
  process.exit(1);
}

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const info = fs.readFileSync(path.join(ROOT, 'macos', 'Info.plist'), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, key) => ({ id, version })[key]);
fs.writeFileSync(path.join(contents, 'Info.plist'), info);

const icons = path.join(work, 'Capcom.iconset');
fs.mkdirSync(icons);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2].filter(s => size * s <= 512)) {
    const name = `icon_${size}x${size}${scale > 1 ? '@2x' : ''}.png`;
    run('sips', '-z', String(size * scale), String(size * scale), path.join(ROOT, 'public', 'icon-512.png'), '--out', path.join(icons, name));
  }
}
run('iconutil', '-c', 'icns', icons, '-o', path.join(contents, 'Resources', 'Capcom.icns'));

// macOS keeps permissions against the signature, and an ad-hoc one changes with every different build.
run('codesign', '--force', '--sign', '-', bundle);

fs.rmSync(APP, { recursive: true, force: true });
fs.renameSync(bundle, APP);
fs.rmSync(work, { recursive: true, force: true });

console.log(`Built ${APP} as ${id}.\n\nOpen it once and click Allow on each question macOS asks:`);
console.log(`  open "${APP}"`);
console.log('\nThen run npm run install-agent, or restart the agent if it already runs through the app.');
