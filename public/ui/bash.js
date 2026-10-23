// A command run with ! as the transcript shows it: the command, its output and how it ended, with the actions that belong to it. A run
// the transcript does not hold yet is drawn from the panel's run, and one it holds is drawn from the bash item, with the run's output
// and ending when the panel still has the run, so the one replaces the other with nothing changing on screen.
import { copyText } from './clipboard.js';
import { useClock, useStore } from './hooks.js';
import { html, memo, useMemo } from './html.js';
import { draw, icons } from './menu.js';
import { Output } from './output.js';
import { goToRun, showPanel } from './panel-state.js';
import { runFromClick } from './run.js';
import { createStore } from './store.js';
import { hasHiddenCharacters, pendingBangs, runOfItem, runStanding, runState } from './terminal-rules.js';
import { toast } from './toast.js';

const LINES = 200;

const NO_RUNS = createStore({ runs: [] });

function Tool({ label, tip = label, icon, onClick, disabled }) {
  return html`<button class="btn" type="button" data-variant="ghost" data-size="icon-xs" aria-label=${label} aria-disabled=${disabled ? 'true' : undefined} data-tip=${tip} onClick=${disabled ? undefined : onClick}>${draw(icons[icon], 'icon')}</button>`;
}

function Block({ command, chunks, state, foot, tools }) {
  const first = command.split('\n')[0];
  return html`<li class="bash" data-state=${state}>
    <div class="bash-head">
      <span class="bash-mark" aria-hidden="true">!</span>
      <code class="bash-command"><span class="sr">Command </span>${command}</code>
      <span class="bash-tools">${tools}</span>
    </div>
    ${chunks.length ? html`<${Output} class="bash-out" chunks=${chunks} maxLines=${LINES} role="region" tabindex="0" aria-label=${`Output of ${first}`} />` : null}
    ${foot ? html`<p class="bash-foot">${state === 'running' ? html`<span class="lamp" data-state="working" aria-hidden="true"></span>` : null}${foot}</p>` : null}
  </li>`;
}

const copyCommand = command => async () => toast((await copyText(command)) ? 'Command copied' : 'Could not copy the command', { duration: 2000 });

// The actions every block has: copy the command, and run it again where there is a terminal. A command with characters the owner
// cannot see is not run again.
function tools({ command, term, terminal, run }) {
  const hidden = hasHiddenCharacters(command);
  return html`${run && terminal ? html`<${Tool} label="Open in terminal" icon="terminal" onClick=${e => { showPanel(term.id, 'terminal', e.currentTarget); goToRun(run.key); }} />` : null}
    <${Tool} label="Copy command" icon="copy" onClick=${copyCommand(command)} />
    ${terminal ? html`<${Tool} label=${hidden ? 'Run again, unavailable because the command holds hidden characters' : 'Run again'} tip=${hidden ? 'This command holds hidden characters, so it cannot be run' : 'Run again'} icon="play" disabled=${hidden} onClick=${e => runFromClick(term, command, 'block', e.currentTarget)} />` : null}`;
}

// A run in the panel that the transcript does not hold yet, with its output as it arrives.
const BangRun = memo(function BangRun({ run, term }) {
  useClock(run.running && !run.pending, run.startedAt);
  const stop = run.running && !run.pending
    ? html`<${Tool} label="Stop command" icon="square" onClick=${() => term.stop(run.id)} />`
    : null;
  return html`<${Block} command=${run.command} chunks=${run.output} state=${runState(run)} foot=${runStanding(run)} tools=${html`${stop}${tools({ command: run.command, term, terminal: true, run })}`} />`;
}, (a, b) => a.run === b.run && a.term === b.term);

export function BangRuns({ ctrl, items, hasEarlier }) {
  const runs = useStore(ctrl.term.store, s => s.runs);
  const shown = useMemo(() => pendingBangs({ runs, items, hasEarlier }), [runs, items, hasEarlier]);
  return shown.map(run => html`<${BangRun} key=${run.key} run=${run} term=${ctrl.term} />`);
}

// A bash item the transcript holds. The run it came from, when the panel still has it, gives it the output with its colours and how it ended.
export const BashItem = memo(function BashItem({ item, term, terminal }) {
  const run = useStore(term?.store ?? NO_RUNS, s => runOfItem(s.runs, item));
  useClock(!!run?.running, run?.startedAt);
  const chunks = run && !run.running ? run.output : [...(item.stdout ? [{ stream: 'out', text: item.stdout }] : []), ...(item.stderr ? [{ stream: 'err', text: item.stderr }] : [])];
  return html`<${Block} command=${item.command} chunks=${chunks} state=${run ? runState(run) : ''} foot=${run ? runStanding(run) : ''} tools=${tools({ command: item.command, term, terminal, run })} />`;
}, (a, b) => a.item === b.item && a.term === b.term && a.terminal === b.terminal);
