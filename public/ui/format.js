// Small text helpers with no DOM in them. The caller passes the home folder where one is needed.

export const tilde = (path, home) => (home ? String(path).replace(home, '~') : String(path));

export function folderName(cwd, home) {
  cwd = cwd || '';
  const wt = cwd.match(/\/([^/]+)\/\.claude\/worktrees\/[^/]+/);
  if (wt) return wt[1];
  if (cwd === home) return '';
  return tilde(cwd, home).split('/').filter(Boolean).slice(-2).join('/');
}

export function when(ms) {
  const t = typeof ms === 'number' ? ms : Date.parse(ms);
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'now';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)} min`;
  const d = new Date(t);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (diff < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export const STATE_LABEL = { working: 'working', waiting: 'needs you', active: 'active', idle: '' };

export function modelLabel(m = '') {
  const long = /\[1m\]$/i.test(m) ? ' (1M)' : '';
  const named = m.match(/(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?/i);
  if (named) return `${named[1][0].toUpperCase()}${named[1].slice(1)} ${named[2]}${named[3] ? `.${named[3]}` : ''}${long}`;
  const alias = m.match(/^(opus|sonnet|haiku|fable)(\[1m\])?$/i);
  if (alias) return `${alias[1][0].toUpperCase()}${alias[1].slice(1)}${long}`;
  return m;
}

export const settingsLine = s => [modelLabel(s?.shownModel || s?.model || ''), s?.effort && `${s.effort} effort`].filter(Boolean).join(', ');

export const toolLabel = name => name.replace(/^mcp__.+?__/, '').replace(/_/g, ' ');

// Text is shown as an HTML parser would show it: CR and CRLF become LF, and one LF right after <pre> is dropped.
export const lf = text => String(text ?? '').replace(/\r\n?/g, '\n');
export const pre = text => lf(text).replace(/^\n/, '');

export const clip = (text, lines = 40) => {
  const all = lf(text).split('\n');
  return all.length > lines ? `${all.slice(0, lines).join('\n')}\n... ${all.length - lines} more lines` : all.join('\n');
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function tokenCount(n) {
  if (n < 1000) return String(n);
  return n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(n / 1000)}k`;
}

export const preview = text => String(text).replace(/[*`]+/g, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim().slice(0, 160);

const HOLD_CAUSES = {
  'mode-mismatch': 'The sender and this chat are in different kinds of permission mode (one bypasses permission prompts and the other asks).',
  'no-mode-asserted': 'The sender did not say which permission mode it is in, and this chat bypasses permission prompts.',
  'bypass-default': 'This chat is not prompting for permissions, and the CLI holds messages from other sessions by default in that case.',
  'mode-unknown': 'The CLI could not tell which permission mode this chat is in.',
  'explicit-setting': 'Your Claude Code setting "crossSessionInbound" is "hold".',
  'managed-setting': `Your organization's managed settings set "crossSessionInbound" to "hold".`,
  'repo-setting': `This project's settings set "crossSessionInbound" to "hold".`,
  'invalid-setting': 'A Claude Code settings file has a "crossSessionInbound" value the CLI does not recognise, so it holds every message.',
};
const HOLD_ENDS = {
  expired: 'Nobody approved in time, so none of it reached Claude.',
  refused: 'The CLI began refusing messages from other sessions before anyone approved.',
  dropped: 'Let through by the CLI, then discarded (a rate limit, a repeat or a full queue).',
  discarded: 'This chat ended before anyone approved.',
};

// Why the CLI holds a message from another session, and how a hold ends without the message arriving.
export const holdCause = cause => HOLD_CAUSES[cause] || 'The CLI gave a reason Capcom does not know.';
export const holdEnd = outcome => HOLD_ENDS[outcome] || 'The CLI ended the hold without delivering.';

// One group per sender and reason; the newest `shown` are returned, and `hidden` counts the messages in the rest.
export function groupHolds(list, whyOf, shown) {
  const by = new Map();
  for (const h of list) {
    const key = `${h.from}\n${whyOf(h)}`;
    by.set(key, { key, from: h.from, why: whyOf(h), ids: [...(by.get(key)?.ids || []), h.id] });
  }
  const groups = [...by.values()].slice(-shown);
  return { groups, hidden: list.length - groups.reduce((n, g) => n + g.ids.length, 0) };
}
