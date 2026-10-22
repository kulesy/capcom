// Shared by the tests that read a stylesheet as text, with no page and no CSS library: its style rules in order, found by walking the braces.
const CONTAINERS = new Set(['media', 'supports']);
const DESCRIPTORS = new Set(['keyframes', 'font-face', 'property']);

const squash = text => text.replace(/\s+/g, ' ').trim();

function endOfString(text, start) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === text[start]) return i;
  }
  throw new Error(`The string that starts at ${start} is never closed.`);
}

// The pieces of `text` between the `separator`s that sit outside brackets and strings, each on one line.
function splitOutside(text, separator) {
  const pieces = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") i = endOfString(text, i);
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === separator && depth === 0) {
      pieces.push(text.slice(from, i));
      from = i + 1;
    }
  }
  pieces.push(text.slice(from));
  return pieces.map(squash).filter(Boolean);
}

const declarationsIn = body => Object.fromEntries(splitOutside(body, ';').map(declaration => {
  const colon = declaration.indexOf(':');
  if (colon < 0) throw new Error(`${declaration} is not a declaration.`);
  return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
}));

// What a block opens: a style rule, an at-rule that holds style rules, or one whose contents are not (the steps of a keyframes, a font's descriptors).
function kindOf(prelude, parent) {
  if (parent?.kind === 'style') throw new Error(`${prelude} is nested in a style rule, which this reader does not follow.`);
  if (parent?.kind === 'opaque') return 'opaque';
  if (!prelude.startsWith('@')) return 'style';
  const name = /^@([\w-]+)/.exec(prelude)?.[1];
  if (CONTAINERS.has(name)) return 'at';
  if (DESCRIPTORS.has(name)) return 'opaque';
  throw new Error(`${prelude} is an at-rule this reader does not know.`);
}

// The style rules of `css`, each { selectors, declarations, within }: the selector list split at its commas, the declarations by property with a later one
// replacing an earlier, and the at-rules it sits inside, outermost first. A construct it cannot follow throws, so no rule goes unseen.
export function styleRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const open = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") i = endOfString(text, i);
    else if (c === '{') {
      const prelude = squash(text.slice(from, i));
      open.push({ prelude, kind: kindOf(prelude, open.at(-1)), body: i + 1 });
      from = i + 1;
    } else if (c === '}') {
      const block = open.pop();
      if (!block) throw new Error(`The } at ${i} closes nothing.`);
      if (block.kind === 'style') {
        rules.push({
          selectors: splitOutside(block.prelude, ','),
          declarations: declarationsIn(text.slice(block.body, i)),
          within: open.filter(b => b.kind === 'at').map(b => b.prelude),
        });
      }
      from = i + 1;
    } else if (c === ';' && open.at(-1)?.kind !== 'style') from = i + 1;
  }
  if (open.length) throw new Error(`${open.at(-1).prelude} is never closed.`);
  return rules;
}
