// The mark a row shows at its right: 'error', 'awaiting', 'running', 'ready' or null. These are Claude Desktop's own rules, checked on
// Desktop 3.1623.0, and the first line that holds wins. See docs/adr/20261022-list-order-and-row-marks.md.
export const WEEK = 7 * 86400_000;

// `r` holds what the rules ask about a row. `responding` means Capcom runs its turn and `elsewhere` another app, `verdict` is the post-turn
// summary's category, `updatedAt` is when the last turn began or ended and `ackedAt` when the owner last acknowledged the row.
export function dotOf(r, now = Date.now()) {
  const acked = r.ackedAt !== undefined && r.ackedAt >= r.updatedAt;
  const workerActive = r.responding || r.elsewhere;
  const needsInput = r.verdict === 'blocked' || r.verdict === 'need_input';
  const turnError = r.error && now - r.errorAt < WEEK;
  const lapsed = !r.unread && (r.routine || now - r.updatedAt >= WEEK);
  const waits = r.approval || (!workerActive && needsInput && !lapsed);
  const hasFailed = !r.approval && !workerActive && (r.verdict === 'failed' || turnError);

  if (r.archived) return null;
  if (r.approval) return 'awaiting';
  if (r.responding) return 'running';
  // An error with no time of its own is never acknowledged by an ack, as in Desktop, where the comparison with a missing time is false.
  if (hasFailed && !acked && !(r.errorAt > 0 && r.ackedAt >= r.errorAt)) return 'error';
  if (!acked) {
    if (waits) return 'awaiting';
    if (r.elsewhere) return 'running';
  }
  return r.unread ? 'ready' : null;
}
