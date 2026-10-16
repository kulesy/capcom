// Messages the CLI saves as user turns although nobody typed them: a background task finishing, a message from another
// session, a command run with "!". Each becomes one `system` item, which the page draws as a compact notice.

export const capText = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}\n... (${text.length - limit} more characters)` : text);

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", '#39': "'" };
const unescape = s => s.replace(/&(lt|gt|amp|quot|apos|#39);/g, (_, name) => ENTITIES[name]);

const ELEMENT = /<([A-Za-z][\w-]*)>([\s\S]*?)<\/\1>/g;

function humanise(name) {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
}

const flatten = raw => raw.replace(ELEMENT, (_, tag, value) => `${humanise(tag)}: ${value.trim()}\n`);

const notice = ({ state, title, text = '', output = '', details = [] }, limit) => ({
  kind: 'system',
  ...(state && { state }),
  title,
  ...(text && { text: capText(text, limit) }),
  ...(output && { output: capText(output, limit) }),
  details: details.map(([label, value]) => ({ label, value: capText(value, limit) })),
});

const ORPHAN = '__orphan_summary__';
const ENDED = { completed: ['finished', 'done'], failed: ['failed', 'failed'], stopped: ['stopped', 'stopped'], killed: ['stopped', 'stopped'] };
const LABELS = { 'task-id': 'Task', 'tool-use-id': 'Tool call', 'output-file': 'Output file', 'task-type': 'Type' };
const SHOWN = new Set(['task-id', 'summary', 'event']);

// A finished, failed or stopped task, or a line from a monitor. Ids that start with __orphan_summary__ are the CLI's own markers.
function taskNotice(block, after, limit) {
  const fields = [...block.matchAll(ELEMENT)].map(([, tag, raw]) => [tag, unescape(/<[A-Za-z][\w-]*>/.test(raw) ? flatten(raw) : raw).trim()]);
  const first = tag => fields.find(([t]) => t === tag)?.[1] || '';
  const ids = fields.filter(([tag, value]) => tag === 'task-id' && !value.startsWith(ORPHAN)).map(([, value]) => value);
  const [verb, state] = ENDED[first('status')] || [];
  const details = ids.length ? [[ids.length > 1 ? 'Tasks' : 'Task', ids.join(', ')]] : [];
  for (const [tag, value] of fields) {
    if (value && !SHOWN.has(tag) && !(tag === 'status' && verb)) details.push([LABELS[tag] || humanise(tag), value]);
  }
  const aside = [block.replace(ELEMENT, ''), after].map(s => s.trim()).filter(Boolean).join('\n\n');
  if (aside) details.push(['Also sent to Claude', aside]);
  const title = verb ? `${ids.length > 1 ? `${ids.length} background tasks` : 'Background task'} ${verb}` : 'Background update';
  return notice({ state, title, text: first('summary'), output: first('event'), details }, limit);
}

function shellNotice(text, limit) {
  const part = tag => unescape((new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text) || [])[1] || '').trim();
  const command = part('bash-input');
  return notice({ title: command ? 'You ran a command' : 'Command output', text: command, output: [part('bash-stdout'), part('bash-stderr')].filter(Boolean).join('\n') }, limit);
}

// A sender chooses its own name and address, so line breaks, bidi marks and zero-width characters become a space and a long one is cut.
export const label = (text, limit = Infinity) => {
  const plain = String(text ?? '').replace(/[\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim();
  const chars = [...plain];
  return chars.length > limit ? `${chars.slice(0, limit).join('')}...` : plain;
};

const peerMessage = ({ from, name, mode, body }, limit) => notice({
  title: `Message from ${label(name, 60) || 'another session'}`,
  text: body,
  details: [['From', label(from)], ['From name', label(name)], ['From mode', label(mode)]].filter(([, value]) => value),
}, limit);

const MESSAGES = {
  'cross-session-message': {},
  'ci-monitor-event': { title: 'Pull request monitor' },
  'agent-message': { title: 'Message from a subagent' },
  'side-sessions-event': { title: 'Side sessions are idle', aside: true },
};
const MESSAGE = new RegExp(`^<(${Object.keys(MESSAGES).join('|')})((?:\\s[^>]*)?)>([\\s\\S]*?)</\\1>$`);

// An aside is written for Claude alone, so it waits behind the details.
function messageNotice([, tag, attrs, body], limit) {
  const { title, aside } = MESSAGES[tag];
  const pairs = [...attrs.matchAll(/([\w-]+)="([^"]*)"/g)];
  if (tag === 'cross-session-message') {
    const at = Object.fromEntries(pairs.map(([, name, value]) => [name, value]));
    return peerMessage({ from: at.from, name: at['from-name'], mode: at['from-mode'], body: body.trim() }, limit);
  }
  const details = pairs.map(([, name, value]) => [humanise(name), value]);
  if (aside) details.push(['Also sent to Claude', body.trim()]);
  return notice({ title, text: aside ? '' : body.trim(), details }, limit);
}

const REPORT = /^\[Cross-session delivery notice\] (?:Do not resend now: )?(?:Your message|one of your messages|(\d+) of your messages) to another session (?:was|were) ([\s\S]*)$/;
const REPORTS = [
  { match: /^held by that session/, title: 'held by the other session', text: 'Not delivered yet. It waits for the other session\'s owner to approve it.' },
  { match: /^approved and released/, state: 'done', title: 'delivered' },
  { match: /^denied by the recipient/, state: 'stopped', title: 'denied by the other session', text: 'Not delivered.' },
  { match: /^not approved before expiry/, state: 'failed', title: 'not delivered', text: 'It expired before the other session approved it.' },
  { match: /^refused/, state: 'failed', title: 'refused by the other session', text: 'It does not accept messages from other sessions.' },
  { match: /^dropped at that session's inbox/, state: 'failed', title: 'dropped by the other session', text: 'Not delivered.' },
];

function deliveryReport([, count, rest], text, limit) {
  const report = REPORTS.find(r => r.match.test(rest));
  if (!report) return null;
  const reason = /NOT delivered \(([^)]*)\)/.exec(rest)?.[1];
  const to = /\(recipient: ([^;)]*)(?:; msg_id: ([^)]*))?\)/.exec(rest) || [];
  return notice({
    state: report.state,
    title: `${Number(count) > 1 ? `${count} messages` : 'Message'} ${report.title}`,
    text: reason ? `${reason[0].toUpperCase()}${reason.slice(1)}.` : report.text,
    details: [['Recipient', label(to[1])], ['Message', label(to[2])], ['Also sent to Claude', text]].filter(([, value]) => value),
  }, limit);
}

// The two turns the CLI saves for Claude alone that are worth showing: a message that came from another session, and the
// report on one this session sent. Anything else of that kind stays hidden.
export function metaNotice(origin, text, limit) {
  if (origin?.kind === 'peer') {
    return peerMessage({ from: origin.from, name: origin.name, mode: origin.fromMode, body: typeof origin.body === 'string' ? origin.body.trim() : '' }, limit);
  }
  const report = REPORT.exec(text.trim());
  return report ? deliveryReport(report, text.trim(), limit) : null;
}

// The item for a user turn the CLI wrote, or null when `text` is something a person typed.
export function noticeFrom(text, limit) {
  const task = /^<task-notification>([\s\S]*?)<\/task-notification>([\s\S]*)$/.exec(text);
  if (task) return taskNotice(task[1], task[2], limit);
  if (/^<bash-(input|stdout|stderr)>/.test(text)) return shellNotice(text, limit);
  const message = MESSAGE.exec(text);
  return message ? messageNotice(message, limit) : null;
}
