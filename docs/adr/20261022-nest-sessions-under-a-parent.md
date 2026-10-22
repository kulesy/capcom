# Nest sessions under a parent, and follow the links Desktop records

- Status: Accepted, amended 2026-10-22
- Deciders: Eli
- Date: 2026-10-22
- Tags: sessions, nesting, linked-sessions, layout, drag-and-drop, claude-desktop

## Context and Problem Statement

Claude Desktop records a link from a side chat to the session it was started from, and sets a flag on the side chat when the owner takes it out of the family. Desktop shows the linked sessions together. Capcom listed every session on its own, so a side chat sat apart from its parent, in another section or lower down the same one.

The owner asked to drag one session onto another to make it a child, to see children nested under their parent, to take a child out again, and to see the families Desktop already has without dragging each one. Capcom cannot write Desktop's records, and Desktop writes over them (see the [read-only list record](20261006-read-only-session-list.md)). Where does a session's parent live, where does it come from, and which side wins when Capcom and Desktop disagree?

## Decision Drivers

- Desktop's files are read only for Capcom, so a nest made in Capcom has to live in `layout.json`.
- The families Desktop has should show with no drag, and a link Desktop makes later should show too.
- Capcom's choice has to win in both directions, as the archive flag does: a session the owner nested stays nested, and one the owner took out stays out, whatever Desktop records.
- A row is also the content of a section, so a drop on a row must leave the drop on the section working.
- A family the page shows has to stay as shown when one of its sessions is taken out, moved, pinned or archived, whatever chain of links lies behind it.
- Every step has to work on a phone, so a menu has to do everything a drag does.
- The walk over the links has to survive bad data: a cycle, a chain, and a parent that is archived, missing or a routine run.

## Considered Options

1. Follow Desktop's links on every refresh, and keep Capcom's nests and take-outs beside them
2. Copy Desktop's links into `layout.json` once, as the groups and pins are
3. Nest only what the owner drags in Capcom

## Decision Outcome

Chosen option: "Follow Desktop's links on every refresh, and keep Capcom's nests and take-outs beside them", because it shows Desktop's families with no drag, including the links Desktop makes later, and still lets the owner overrule Desktop in either direction. It applies the rule the archive flag already follows (see the 2026-10-18 amendment of the [layout record](20261015-own-session-layout-seeded-from-desktop.md)).

- **File.** `layout.json` gains `parents`, which maps a CLI session id to a parent's id or to null. An id nests the session under that parent. A null takes it out of the parent Desktop links it to. A session with no entry follows Desktop. A file without `parents` loads as having none and is not rewritten until something changes. An entry that is neither null nor an id is dropped as the file is read, and a `parents` that is not an object makes the file unreadable, as a bad `titles` does.
- **Desktop's links.** `lib/desktop.mjs` reads `spawnedFrom`, `forkedFromSessionId` and `lineageDetached` from each session record and keeps the link beside the fields the rows take. It follows Desktop's own rule (`parentOf`), so side chats, forks and suggested tasks all nest. A record with `lineageDetached` set has no link, and neither has one whose `spawnedFrom.userFork` is true. A side chat (`spawnedFrom.sideSession`) links to the session it was started from. When its record also names a fork (`forkedFromSessionId`) of some other session, other than the deleted parent that `spawnedFrom.deletedParent` names, the fork wins. Any other record links to the session it was forked from, or else to the one `spawnedFrom` names. A link to the record itself counts as none. Desktop names the parent by its own id, so Capcom maps it to the CLI session id through the other records and drops a link whose parent has no record or no CLI session. This is Desktop's rule with its user-links gate on, checked on Desktop 3.1623.0 only, and a NOTE beside the code says so. Capcom reads the links on every refresh, writes nothing to Desktop, and has no links when Desktop cannot be read.
- **A session's link** is Capcom's entry in `parents` when it has one, otherwise Desktop's link, otherwise none.
- **The walk.** `lib/families.mjs` follows each row's links upward through every row, archived ones included, and gives each row three ids. The holder is the topmost session its links reach, or the row itself. The parent is the topmost one the list shows, or null. `via` is the nearest one the list shows, or null, and orders the family. A chain stops at a null link, at an id with no row, at a routine run, which never holds children, and at a row it has passed already. A row whose chain comes back to itself is in a cycle and shows at the top level. A chain that runs into a cycle without the row in it stops at the first session of the cycle it reaches. That session is in a cycle, so it shows at the top level, and an archived session further round the cycle cannot pull the family into another place. Every parent is top level, so a family is one level deep: a grandchild shows under its topmost live ancestor, and the children of an archived parent move up to the parent's place and nest under it again when it comes back.
- **Place.** A family shows in its holder's place, so a child takes the holder's group or pin and its own group or pin is ignored while it is nested. Moving or pinning a parent moves its children with no extra write.
- **List.** `GET api/sessions` gives each row a `parent` (an id or null) and each top level row with children a `children` list. A child is in no other list: Pinned, the groups, Routines and the three loose lists hold top level sessions only. Children go depth first, as Desktop's do: each session that nests straight under the head, in the order of the parent's list, followed at once by the sessions that nest under it by `via`. Under a recency sort a family sorts where its best member does, so a busy child does not drop out of view under an old parent, and under the other sorts it sorts where its head does. The sorts are in [Order each list and mark each row as Claude Desktop does](20261022-list-order-and-row-marks.md). The cut at the newest 60 counts a family as one session and keeps it whole when any member was brought back from the archive. The counts in section heads and in the projects sidebar include the children.
- **Route.** `POST api/layout/nest` (`{ id, parent }`) sits behind the same sign-in and same-origin checks as the other layout routes. The server resolves `parent` to a top level session first, so a drop on a child nests under that child's parent. It writes `parents[id]` and drops the session's own pin and group, because its place is now the family's. A session that already shows under that parent is answered with the parent and nothing is written, so a repeat keeps the session's group and any link Desktop makes. A `parent` that is neither an id nor null is a 400, an unknown session or parent is a 404, an archived parent or a routine run is a 400, and so is a session nested under itself or under any session below it. That check follows the links up from the parent all the way (`chainOf` in `lib/families.mjs`), archived sessions included, because a loop through an archived session is still a loop. Each refusal is one short sentence and writes nothing. The answer is the session's `id`, `group` and `pinned` with the `parent` the list now shows.
- **Taking out.** A `parent` of null takes the session out of its parent, whether Capcom or Desktop made the link. It writes a null and the place the family showed in, so the session stays in its parent's group or in Pinned as a top level row. A parent in neither leaves the session with no group, and it shows in the loose list for the app it started in, as any such session does. The rest of the family is linked straight to the parent in the same write (see Hidden links). A session with no link gets no write, so a link Desktop makes later is not hidden by a null written now.
- **Move, pin and archive.** `POST api/layout/move` and `pin` write a null for a session that has a link, in the same write, so a nested session that is moved or pinned leaves its parent and lands where it was sent. A session without a link gets no entry. Archiving archives the one session, and the walk moves the children of an archived parent up.
- **Hidden links.** A family shows one level deep, but the links behind it can run through a middle session. Kid links to Boss and Boss to Peer, and the page shows Peer with Boss and Kid side by side. Taking Boss out, moving it, pinning it or nesting it under another session would take Kid along. Archiving Peer would leave Kid under Boss. The page showed neither. So in the same write the server links every other session shown in that family straight to the session the family shows under, which is the family's parent, or the session itself when it is the parent (`keepFamily` in `server.mjs`). `lib/layout.mjs` takes those links as `relink` on `move`, `pin`, `nest`, `unnest` and `archive` and writes them with the change. A session already linked straight to that session gets no entry, and a refused change writes nothing. Archiving a parent links its children to it in the same way, so they show as rows of their own in its place and nest under it again when it returns.
- **Drag.** A row that can take the carried row carries `data-drop="nest:<id>"` and `data-drop-middle`. `public/ui/drag.js` counts such a target only in the middle half of the row's height. In the top and bottom quarters the point falls to the section around the row, so a drop between rows still moves a session into the section. The carried row, its children and routine runs take no nest. The row that would take the nest gets the sidebar accent and the ring a group gets, and says "Nest here" at its right end, left of the dot, so nothing shifts, and the section is not lit. The buttons on rows take no pointer during a drag. While a nested row is carried, its own family's list takes `nest:<parent>` without the middle-half rule, so a release anywhere in that list, on the carried row too, resolves to its current parent and sends nothing. A nested session dropped on its family's section, or on the top or bottom quarter of its parent's row, is taken out. The family's list starts where the nested rows start, so the indent to their left belongs to the section, and a nested session let go there is taken out too. One dropped on the middle of its parent's row or on a sibling sends nothing.
- **Page.** A parent's row has the fold button and nested list that a routine's earlier runs use, now shared (`.fold` and `ul.sub-rows`). Families start open, a folded family does not roll its children's marks into the parent's row, and each browser remembers the folded ones (`folded` in local storage, holding only folded ids). A nest by drop or by menu opens the parent's family, so the row can be seen where it went. `public/app.js` shows a nest at once (`nestRow` and `unnestRow` in `public/ui/tree.js`) and puts the old list back if the server refuses, as it does for a drop on a section. A row taken out shows where the server files it: in Pinned or the group its parent is in, and otherwise in the loose list for the app the row started in. A routine run has no loose list, so it leaves the page until the server's list arrives. Archiving a parent frees its children the same way, so under a group or a pin they stay in that list and under a loose parent each goes to the loose list for its own app. The search and the views treat a nested row as part of the list its parent is in.
- **Look.** Nested rows are drawn as Desktop draws them, and a routine's earlier runs share the look. A child's text starts `--nest-indent` right of its parent's, 1.25rem (18.75px) on a mouse and 1.1875rem (19px) on a touch screen, and its row ends where the parent's row ends. A line starts 0.375rem below the parent's row, with its left edge 0.75rem in from the row's left edge, which is 0.25rem right of the start of the parent's title. It runs down and turns into the middle of the last child with a `--radius-sm` corner, ending 0.375rem short of that child's title, and the rows between get no tick. On a mouse the line is 0.5px wide in the sidebar's text colour at 20%, so a 2x screen draws it one device pixel wide and a 1x screen rounds it up to one pixel. In light mode that is the grey Desktop uses, and nobody has compared dark mode with Desktop. On a touch screen it stays 1px in the sidebar's border colour. A nested row paints over the line, so a lit last child hides the end of the hook, and the line dims with a carried parent's children. The line is placed from `--row-pad`, `--row-gap` and `--nest-indent` and drawn with `--nest-line`, all tokens on `:root`, so it moves with the rows when they change size. The mouse numbers come from a 2x screenshot of Desktop's sidebar in light mode, and each lands within one device pixel of Desktop's there.
- **Keyboard.** Right on a parent opens a folded family and, with it open, moves to the first child. Left on a parent closes an open family, and left on a child moves to its parent's row. A routine's earlier runs walk the same way.
- **Menus.** A nested row's menu has Move out of “parent”. Every row's menu has Nest under, which opens a second menu of the other top level sessions in the row's section, without the row's own parent or any routine run, and the item is hidden when that list is empty. A toast says `Nested “C” under “P”.` or `Moved “C” out of “P”.`, or `Not nested: <reason>` or `Not moved out: <reason>` when the server refuses. None has an Undo, as a move has none. A title can run to 120 characters and Nest under lists them, so a menu is at most 26rem wide (`min(26rem, calc(100vw - 1rem))`) and cuts a longer label with an ellipsis.

### Consequences

- ✅ The families Desktop shows appear in Capcom with no drag, and a link Desktop records later appears on the next refresh.
- ✅ The owner nests, takes out and re-nests from a drag or from a menu, on a phone too.
- ✅ Capcom's choice wins in both directions, so a Desktop link neither undoes a nest nor brings back a family the owner took apart.
- ✅ A family stays as the page showed it when one of its sessions leaves, moves or is archived, whatever chain of links lies behind it.
- ✅ Nothing is written to Desktop's files.
- ❌ Nesting is one level deep. A session that holds others takes them along when it is nested, and a chain of links shows as one level under its topmost live session.
- ❌ A nest made in Capcom shows in Capcom only. Desktop keeps the links it has, so a session the owner took out in Capcom stays in its family in Desktop.
- ❌ An entry in `parents` stays for good. Capcom has no way yet to hand a session back to Desktop's link, so a session the owner nested or took out ignores what Desktop records for it until `parents` is edited by hand.
- ❌ A routine run cannot hold sessions, and an archived session cannot take a new child.
- ❌ A change to one session of a family can add entries to `parents` for others in it. They are the links the page already showed, written down so that the change does not move them.
- ❌ The links rest on three fields of Desktop's records, as Desktop 3.1623.0 writes them, and on its user-links gate staying on. If Desktop turns the gate off, its forks and suggested tasks stop nesting there and still nest in Capcom. After an update that moves them the families unlink until the test changes, and the nests made in Capcom stay.
- ❌ A Capcom from before this change keeps `parents` when it writes `layout.json` but does not read it, so its list shows no nesting until this version runs again. Checked by running the layout module from just before this change on a scratch file.
- ❌ A Chromium screenshot test of the line on a mouse has to set a real 2x scale with the `--force-device-scale-factor=2` flag. Under Playwright's emulated scale factor Chromium rounds the 0.5px line up to 1px and draws it two device pixels wide, where a real 2x screen draws one. WebKit's emulated scale draws one too.

## Pros and Cons of the Options

### Follow Desktop's links on every refresh, and keep Capcom's nests and take-outs beside them

- ✅ Desktop's families show with no drag, and so do the links it makes later.
- ✅ The owner's choice still wins, as the archive flag's does.
- ❌ The list reads two more fields of Desktop's internal records, which an update can move.
- ❌ Two sources decide a session's parent, so a family in Capcom can differ from the one in Desktop.

### Copy Desktop's links into `layout.json` once, as the groups and pins are

- ✅ After the first start the list does not read Desktop's links.
- ❌ A link Desktop records after the copy never shows.
- ❌ It needs a seeding rule for links on top of the one for groups and pins, and the two layouts drift apart the way those did.

### Nest only what the owner drags in Capcom

- ✅ It is the smallest change, with nothing new read from Desktop.
- ❌ The owner nests each of Desktop's families again by hand.

## Links

- [Capcom keeps its own session layout, seeded once from Desktop's](20261015-own-session-layout-seeded-from-desktop.md), amended 2026-10-22 to point here. Its 2026-10-18 amendment set the rule that Capcom's own archive choice beats Desktop's flag in both directions.
- [List sessions from transcripts and Desktop's records, read only](20261006-read-only-session-list.md), amended 2026-10-22: the links between sessions are read the same way.
- [Let groups sit under projects, and make every change from a menu](20261016-projects-above-groups.md), whose views and counts now include nested sessions.
- [Build Capcom's look and behaviour on shadcn/ui](20261022-shadcn-design-language.md), whose menu, sidebar and focus rules the nested rows follow.
- [Order each list and mark each row as Claude Desktop does](20261022-list-order-and-row-marks.md), which places and orders the families.
