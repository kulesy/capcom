// A click on Run is how text on the page becomes a command, and the command is the one the owner can see: the text is read when the
// button is pressed, and one holding characters he cannot see is refused here as well as at the button.
import { showPanel } from './panel-state.js';
import { hasHiddenCharacters, MAX_COMMAND } from './terminal-rules.js';

export async function runFromClick(term, command, source, from) {
  if (!command || command.length > MAX_COMMAND) return;
  showPanel(term.id, 'terminal', from);
  if (hasHiddenCharacters(command)) {
    term.report('That command holds characters you cannot see, so it was not run.');
    return;
  }
  const problem = await term.run(command, source);
  if (problem) term.report(problem);
}
