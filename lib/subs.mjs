// The tools of an ordinary chat that reach the sessions nested under it, at any depth. As with a group's tools, the server hands each chat
// callbacks for what it may reach, so nothing here imports the server or the runner.
import { descendantsOf, rollupLine, rollupOf, treeOf } from '../public/ui/sub-rules.js';
import { count, listLine, LIST_LIMIT, oneLine, readSession, refusal, whole } from './groups.mjs';

const NOT_BELOW = 'That session is not one of the sub sessions of this session. Use list_sub_sessions to see the ones you can reach.';

// What a session waits on, one line each, for the page and the tools to show.
export const pendingLines = pending => pending.map(p => ({ tool: oneLine(p.tool, 80), summary: oneLine(p.summary, 200) }));

// `subs.lookup({ archived })` gives this session's own row (null when it has none yet) and the rows of the index, with `via` running
// through the archived sessions only when `archived` is set.
export function listSubSessions(args, subs, now = Date.now()) {
  const asked = args.include_archived === true;
  const { self, rows } = subs.lookup({ archived: asked });
  const below = self ? descendantsOf(rows, self.id) : [];
  const name = self ? `Session "${oneLine(self.title, 80) || 'Untitled'}"` : 'This session';
  if (!below.length) return `${name} has no sub sessions.`;
  const roll = rollupOf(rows, self.id, now);
  const flags = [roll.needs && `${roll.needs} ${roll.needs === 1 ? 'needs' : 'need'} you`, roll.working && `${roll.working} working`].filter(Boolean);
  const archived = below.filter(row => row.archived).length;
  const head = `${name}: ${count(roll.total, 'sub session')}${flags.length ? ` (${flags.join(', ')})` : ''}${archived ? `, ${archived} archived` : ''}`;

  const limit = whole(args.limit, LIST_LIMIT);
  const lines = [];
  let shown = 0;
  const walk = (nodes, depth) => {
    for (const { row, subs: under } of nodes) {
      if (shown >= limit) return;
      shown++;
      const pad = '  '.repeat(depth);
      lines.push(`${pad}${listLine(row, now)}`);
      const rolled = rollupLine(rollupOf(rows, row.id, now));
      if (rolled) lines.push(`${pad}  ${rolled}`);
      const said = subs.summary(row.id, row.cwd)?.line;
      if (said) lines.push(`${pad}  "${oneLine(said, 200)}"`);
      walk(under, depth + 1);
    }
  };
  walk(treeOf(rows, self.id, now), 0);
  const cut = below.length - shown;
  return [head, lines.join('\n'), cut && `… and ${cut} more, past the limit of ${limit}.`].filter(Boolean).join('\n\n');
}

// Any session below this one at any depth, archived ones included. Every other id gets one answer, so the reply tells nothing about it.
export function readSubSession(args, subs, now = Date.now()) {
  const { self, rows } = subs.lookup({ archived: true });
  const row = self && typeof args.session_id === 'string' ? descendantsOf(rows, self.id).find(r => r.id === args.session_id) : null;
  if (!row) throw refusal(NOT_BELOW);
  return readSession(row, args, subs.pending(row.id), now);
}
