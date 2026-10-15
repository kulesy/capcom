# List sessions from transcripts and Desktop's records, read only

- Status: Accepted, amended 2026-10-15
- Deciders: Eli
- Date: 2026-10-06
- Tags: sessions, claude-desktop, groups, read-only

## Context and Problem Statement

Claude Code saves each session as a JSON lines file under `~/.claude/projects`, whoever started it. Claude Desktop keeps the titles, groups and pins for its own sessions in its app data under `~/Library/Application Support/Claude`. Capcom needs a list that shows all sessions and organises them. The owner did not want sessions grouped by folder.

Should Capcom follow Desktop's groups, and may it write to Desktop's files?

## Decision Drivers

- The list should match the organisation the owner already keeps in Desktop.
- Sessions that Desktop has no record of should still appear.
- Capcom must not damage Desktop's state.
- Desktop's files are internal and undocumented.

## Considered Options

1. Read the transcripts and Desktop's records, groups and pins, and organise by Desktop's groups
2. Group sessions by folder
3. Write to Desktop's files so Capcom's changes show in its sidebar

## Decision Outcome

Chosen option: "Read the transcripts and Desktop's records, groups and pins", because it shows the organisation the owner already keeps and leaves Desktop's files alone.

`lib/transcripts.mjs` reads the session files. `lib/desktop.mjs` reads Desktop's config for groups, pins and per-folder modes, and Desktop's session records for titles, folders, branches and archive state. `server.mjs` joins them: pinned sessions first, then each Desktop group in Desktop's order, then routine runs, then sessions started in Capcom, then the rest. Capcom opens Desktop's files for reading only.

**Amended 2026-10-08.** The owner asked whether Capcom could write to Desktop's sidebar. Desktop's code shows that Desktop loads its session list and sidebar settings at launch, keeps them in memory and writes them back over the files. A write from Capcom would be overwritten or ignored. The check on 8 Oct was a read of Desktop's code, with no live test. Capcom stays read only.

**Amended 2026-10-15.** Capcom now keeps its own groups and pins in `layout.json`, copied once from Desktop's on its first start, so the list no longer follows Desktop's groups after that. Desktop's records are still read, read only, for titles, folders, archive state and routines. See [Capcom keeps its own session layout](20261015-own-session-layout-seeded-from-desktop.md).

### Consequences

- ✅ The list shows Desktop's groups and pins, plus sessions that Desktop has no record of.
- ✅ Capcom cannot corrupt Desktop's records.
- ❌ Desktop's files can change with an update. After a change like that, the list carries on without groups and shows a banner that says why.
- ❌ Capcom cannot rename, group or pin sessions in Desktop.

## Pros and Cons of the Options

### Follow Desktop's groups, read only

- ✅ One organisation to keep, in the app the owner already uses
- ❌ Depends on files that any Desktop update can move

### Group by folder

- ✅ Needs nothing from Desktop
- ❌ The owner did not want it

### Write to Desktop's files

- ✅ Capcom's changes would show in Desktop
- ❌ Desktop writes its in-memory copy back over the files, so the changes would be lost

## Links

- [Headless CLI per chat](20261006-headless-claude-cli-per-chat.md)
- [Hand new sessions to Desktop](20261014-hand-new-sessions-to-desktop.md), the one supported way into Desktop's sidebar
- [Capcom is the only client](20261015-capcom-is-the-only-client.md) planned Capcom's own groups and pins in place of Desktop's
- [Capcom keeps its own session layout, seeded once from Desktop's](20261015-own-session-layout-seeded-from-desktop.md), which put them in place
