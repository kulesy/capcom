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
