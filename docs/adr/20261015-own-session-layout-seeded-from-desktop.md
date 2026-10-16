# Capcom keeps its own session layout, seeded once from Desktop's

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-15
- Tags: sessions, groups, pins, claude-desktop, drag-and-drop

## Context and Problem Statement

Capcom listed sessions under Desktop's groups and pins, read only, because Desktop keeps its sidebar in memory and writes over its files (see the [read-only list record](20261006-read-only-session-list.md)). On 15 Oct the owner chose to use Capcom alone (see the [only-client decision](20261015-capcom-is-the-only-client.md)) and picked "Organise sessions" as the next piece of work. A layout that Capcom can only read leaves the owner organising sessions in an app they no longer open.

Where should the groups and pins live, and how does the layout Desktop holds today get into Capcom?

## Decision Drivers

- The owner uses Capcom alone, including from a phone, so the layout has to change there.
- Desktop's files are off limits for writes, and Desktop writes over them.
- The groups the owner built in Desktop should not be rebuilt by hand.
- Desktop's files are internal, and a Desktop update can move them.

## Considered Options

1. Write to Desktop's files
2. Keep reading Desktop's layout, for good
3. Keep Capcom's own layout, seeded once from Desktop's

## Decision Outcome

Chosen option: "Keep Capcom's own layout, seeded once from Desktop's", because it is the only option the owner can change from Capcom, and after the first start it does not depend on Desktop's files.

- `layout.json` in Capcom's state folder holds the groups (an id and a name), the group each session is in, keyed by the CLI session id, and the pinned sessions. Capcom writes it to a temporary file and renames it over the old one. It reads the file on every list refresh, so a hand edit shows without a restart, and an unreadable file is reported at the top of the list and never written over.
- The first time Capcom starts without a `layout.json`, it copies Desktop's groups, memberships and pins in, mapping Desktop's local session ids to CLI session ids, and records when. A session that Desktop shows as pinned and in a group is copied as pinned only. If Desktop's files cannot be read at that start, the layout starts empty and Capcom tries again on each later start. Anything the owner placed in Capcom before the copy keeps its place.
- From then on Capcom's layout is the only source of groups and pins, and Desktop's later changes are ignored. Titles, folders, archive state and routines still come from Desktop's records, read only.
- A session is in one place: a group, Pinned or neither. Pinning takes it out of its group, as in Desktop. Moving it into a group, or out of its group, takes it out of Pinned.
- `POST api/layout/move` (`{ id, group }`, a `group` of null meaning ungrouped) and `POST api/layout/pin` (`{ id, pinned }`) change the layout. Both refuse a session or a group that Capcom does not know.
- In the list, a row is dragged onto a group, Pinned, Ungrouped, Started here or Terminal and other. Routines is not a target. The drag uses pointer events, so one implementation serves a mouse, which drags after a few pixels, and a finger, which drags after a 350 ms long press.

**Amended 2026-10-16.** A group lists its sessions by title, A to Z, with the titles that start with an emoji first and each half in the collator's order (case ignored, 2 before 10). Pinned, Routines and the loose lists still show their newest session first. The server sorts, and the page uses the same module (`public/ui/order.js`) to place a row that was just dropped.

### Consequences

- ✅ The owner can move and pin sessions from Capcom, on a phone too, and Desktop cannot overwrite the result.
- ✅ A Desktop update that moves its settings no longer takes the groups away.
- ❌ Desktop's later changes to its groups and pins do not reach Capcom, so the two layouts drift apart from the first start.
- ❌ Capcom has no screen yet to create, rename, delete or reorder groups. Until it has, the owner edits `layout.json`.
- ❌ Ungrouped, Started here and Terminal and other still show their newest 60 sessions each, so a session moved out of a group that is older than those may not show.

## Pros and Cons of the Options

### Write to Desktop's files

Capcom's moves and pins would show in Desktop.

- ✅ One layout, shared with Desktop
- ❌ Desktop keeps its sidebar in memory and writes it back over its files, so the changes would be lost. This comes from a read of Desktop's code on 8 Oct, with no live test.

### Keep reading Desktop's layout, for good

- ✅ One layout, with nothing to copy and nothing to drift
- ❌ Capcom can never change it, and the owner no longer opens Desktop
- ❌ It depends on files that any Desktop update can move

### Keep Capcom's own layout, seeded once from Desktop's

- ✅ It starts from the layout the owner built, changes from Capcom, and does not depend on Desktop after the first start
- ❌ It drifts from Desktop's layout, and Capcom has to grow its own screens for groups

## Links

- [List sessions from transcripts and Desktop's records, read only](20261006-read-only-session-list.md), amended 2026-10-15 to point here
- [Capcom is the only client](20261015-capcom-is-the-only-client.md), which put Capcom's own session organisation first on the roadmap
