// How a quote is cleaned, sent and read back, and where its button goes, with no page in it so node can test it.
// A quote travels as a markdown blockquote ahead of the message's text, so the CLI gets plain text and the server needs no change.
import { isSlashCommand } from './command-rules.js';

// Selected text as one tidy block: LF line ends, plain spaces, no trailing spaces, at most one blank line in a row, and no blank line at
// either end. A single line loses its indent too, but the first line of several keeps it, so a code quote stays aligned.
export function quoteText(raw) {
  const text = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd();
  return text.includes('\n') ? text : text.trimStart();
}

const named = title => String(title ?? '').replace(/\s+/g, ' ').trim();
const fromLine = title => (named(title) ? `From the session "${named(title)}":` : 'From another session:');

// `here` is the id of the session the message goes to, null for a new one. A quote from another session says which.
export function quotedMessage(quotes, text, here) {
  if (!quotes.length) return text;
  const blocks = quotes.map(({ text: body, from }) => [
    ...(from.id !== here ? [fromLine(from.title)] : []),
    ...body.split('\n').map(line => (line ? `> ${line}` : '>')),
  ].join('\n'));
  return [...blocks, ...(text ? [text] : [])].join('\n\n');
}

// What a send writes and which quotes stay in the draft. The CLI runs a slash command only when it opens the message, so a command goes
// alone and the quotes wait for the next message.
export function messageFor(quotes, text, here) {
  if (quotes.length && isSlashCommand(text)) return { message: text, kept: quotes };
  return { message: quotedMessage(quotes, text, here), kept: [] };
}

const FROM = /^From (?:the session "(.*)"|another session):$/;
const isBlank = line => line.trim() === '';

// The reverse of quotedMessage: the quotes a message opens with, each { text, from }, and the rest. `from` is null for a quote with no
// From line, the session's title for one from a titled session, and '' for one from another session that had no title.
export function splitQuotes(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const quotes = [];
  let at = 0;
  while (at < lines.length) {
    const from = FROM.exec(lines[at]);
    const start = from ? at + 1 : at;
    if (!lines[start]?.startsWith('>')) break;
    let end = start;
    while (lines[end]?.startsWith('>')) end++;
    quotes.push({ text: lines.slice(start, end).map(line => line.replace(/^> ?/, '')).join('\n'), from: from ? (from[1] ?? '') : null });
    at = end;
    while (at < lines.length && isBlank(lines[at])) at++;
  }
  return quotes.length ? { quotes, text: lines.slice(at).join('\n') } : { quotes: [], text };
}

// What names a session that was started with these words: the text after the quotes, or the first quote when nothing follows.
export function titleText(text) {
  const { quotes, text: rest } = splitQuotes(text);
  return quotes.length ? rest.trim() || quotes[0].text : text;
}

const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

// Where the Quote button goes, all in the window's coordinates: below the last line of the selection with its left edge at the line's end,
// or above the first line when there is no room below, and inside `view`, the part of the transcript on show. `fade` is the strip at the
// bottom of the transcript where its text fades out.
export function placeButton({ first, last, view }, size, gap = 6, fade = 40) {
  const below = last.bottom + gap + size.height <= view.bottom - fade;
  return {
    left: clamp(below ? last.right : first.left, view.left + gap, view.right - size.width - gap),
    top: clamp(below ? last.bottom + gap : first.top - gap - size.height, view.top + gap, view.bottom - fade - size.height),
  };
}
