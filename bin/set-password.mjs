// Sets Capcom's password from a terminal on the Mac. The typed password is never echoed or written down.
// Setting a new one signs out every browser and removes every passkey.
import readline from 'node:readline';
import { cfg } from '../lib/config.mjs';
import { writePassword } from '../lib/auth.mjs';

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.startsWith(question)) process.stdout.write(s); };
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const first = await ask('New GhostShell password: ');
if (first.length < 12) { console.error('Use at least 12 characters.'); process.exit(1); }
const second = await ask('Type it again: ');
if (first !== second) { console.error('Those did not match. Nothing was changed.'); process.exit(1); }
writePassword(cfg.stateDir, first);
console.log(`Saved. Every browser has been signed out and every passkey removed. (${cfg.stateDir}/auth.json)`);
