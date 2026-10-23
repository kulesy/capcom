// What the prompt box's / list does with the text, with no page in it so node can test it.
const NAME_PARTS = /[-_:.]/;

// A message that opens with /name is a slash command for the CLI. A mention of a file or a quote in front of it would stop that.
export const isSlashCommand = text => /^\s*\/[A-Za-z][\w:.-]*(?=\s|$)/.test(text);

const wordEnd = text => {
  const space = text.search(/\s/);
  return space < 0 ? text.length : space;
};

// The word being typed: the text starts with / and the caret is inside that first word or at its end. `query` is what follows the /
// and `end` is where the word stops. Null for anything else.
export function typedCommand(text, caret) {
  if (!text.startsWith('/') || caret < 1 || /\s/.test(text.slice(0, caret))) return null;
  const end = wordEnd(text);
  return { query: text.slice(1, end), end };
}

// How well a command fits the query, best first: its name is the query, its name starts with it, an alias starts with it, a part of
// its name starts with it, or its name holds it. -1 when none does.
function rank(command, query) {
  const name = command.name.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (command.aliases?.some(alias => alias.toLowerCase().startsWith(query))) return 2;
  if (name.split(NAME_PARTS).some(part => part.startsWith(query))) return 3;
  return name.includes(query) ? 4 : -1;
}

// The commands that fit the query, best first and in the CLI's order within a rank. An empty query fits them all.
export function matching(commands, query) {
  const q = query.toLowerCase();
  if (!q) return commands;
  return commands.map(command => ({ command, rank: rank(command, q) })).filter(m => m.rank >= 0).sort((a, b) => a.rank - b.rank).map(m => m.command);
}

// The text with its first word replaced by the command, one space after it, and the caret just past that space.
export function pick(text, name) {
  const rest = text.slice(wordEnd(text));
  const head = `/${name} `;
  return { text: head + (/^[ \t]/.test(rest) ? rest.slice(1) : rest), caret: head.length };
}

// The argument hint to show after the text, which is only a command typed in full with a single space after it.
export function hintFor(commands, text) {
  const word = /^\/(\S+) $/.exec(text)?.[1];
  if (!word) return '';
  return commands?.find(c => c.name === word || c.aliases?.includes(word))?.hint || '';
}
