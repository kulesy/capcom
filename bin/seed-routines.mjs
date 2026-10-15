// Copies the routines exported from Claude Desktop into routines.json in Capcom's state folder, every one switched off.
// Run it again with a newer export to add the routines that are new. The ones already there are left as they are.
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from '../lib/config.mjs';
import { nextFire } from '../lib/cron.mjs';
import { makeRoutines, stamp } from '../lib/routines.mjs';

const source = process.argv[2];
if (!source) {
  console.error('Usage: npm run seed-routines -- <export.json>\nThe export is the list of routines Claude Desktop runs, as JSON with a "routines" list.');
  process.exit(1);
}

let exported;
try {
  exported = JSON.parse(fs.readFileSync(source, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${source}: ${e.message}`);
  process.exit(1);
}

const store = makeRoutines(cfg.stateDir);
let result;
try {
  result = store.seed(exported);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

console.log(`${result.added.length} added and ${result.kept.length} already there, in ${path.join(cfg.stateDir, 'routines.json')}. Every new routine is switched off.`);
const { routines } = store.read();
const width = Math.max(0, ...routines.map(r => r.id.length));
for (const r of routines) {
  let next = 'never';
  try {
    const fire = nextFire(r.cron, Date.now(), r.jitterSeconds);
    if (fire !== null) next = `${new Date(fire).toLocaleDateString('en-AU', { weekday: 'short' })} ${stamp(fire)}`;
  } catch (e) {
    next = e.message;
  }
  console.log(`  ${r.id.padEnd(width)}  ${r.enabled ? 'on ' : 'off'}  next ${next}  (${r.cron} + ${r.jitterSeconds} s, Desktop ${r.enabledInDesktop ? 'on' : 'off'})`);
}
