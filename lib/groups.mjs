// A group's own session: the folder it works in, and (further down) what its tools may reach and say.
import fs from 'node:fs';
import path from 'node:path';

// Under the state folder, so the session never edits a repo by accident. A character that cannot sit in a folder name is replaced,
// so a group id read from a hand-edited layout cannot point outside.
export const groupDir = (stateDir, groupId) => path.join(stateDir, 'groups', String(groupId).replace(/[^\w-]/g, '_'));

// Made before the session is booked and before every spawn, because the runner falls back to the home folder for one that is missing.
export function ensureGroupDir(stateDir, groupId) {
  const dir = groupDir(stateDir, groupId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
