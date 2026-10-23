// How a group's sessions fall into the parts of its status panel and of the list_group_sessions tool, as rules that need no page, so
// node can test them and the server shares them. The rows are the server's, as they sit in the index.
import { withKids } from './tree.js';

// A session that is not archived, waiting or working counts as recent when it was written to within this long.
export const RECENT_MS = 24 * 3600_000;

export const BUCKETS = [
  { key: 'needs', label: 'Needs you' },
  { key: 'working', label: 'Working' },
  { key: 'recent', label: 'Recent activity' },
  { key: 'idle', label: 'Idle' },
  { key: 'archived', label: 'Archived' },
];

// The sessions of a group as the index lists them, with those nested under each. The archived ones are not in it.
export const membersOf = group => withKids(group.sessions);

export function bucketOf(row, now = Date.now()) {
  if (row.archived) return 'archived';
  if (row.state === 'waiting') return 'needs';
  if (row.state === 'working') return 'working';
  return row.state === 'active' || now - row.lastActivityAt < RECENT_MS ? 'recent' : 'idle';
}

// `rows` is a flat list. Each bucket goes newest first.
export function bucketsOf(rows, now = Date.now()) {
  const buckets = Object.fromEntries(BUCKETS.map(b => [b.key, []]));
  for (const row of rows) buckets[bucketOf(row, now)].push(row);
  for (const list of Object.values(buckets)) list.sort((a, b) => (b.lastActivityAt - a.lastActivityAt) || (a.id < b.id ? -1 : 1));
  return buckets;
}

// "2 need you · 3 working · 12 recent · 140 more", leaving out a part that is empty. Idle and archived sessions are the more, and
// `archived` is given when the archived rows are not in `buckets`, as in the index.
export function summaryOf(buckets, archived = buckets.archived.length) {
  const more = buckets.idle.length + archived;
  const parts = [
    buckets.needs.length && `${buckets.needs.length} ${buckets.needs.length === 1 ? 'needs' : 'need'} you`,
    buckets.working.length && `${buckets.working.length} working`,
    buckets.recent.length && `${buckets.recent.length} recent`,
    more && `${more} more`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No sessions yet';
}
