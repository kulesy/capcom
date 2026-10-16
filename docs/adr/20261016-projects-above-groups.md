# Let groups sit under projects, and make every change from a menu

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-16
- Tags: sessions, groups, projects, layout, menus, phone

## Context and Problem Statement

The sidebar had groups and nothing above them, so every group sat in one flat list. The owner asked for an optional level above groups, so that the list reads Projects, then Groups, then Sessions. Capcom also had no screen to create a group, and the owner uses it from a phone, where only a session row can be dragged, and only after a long press.

How are projects stored and shown, and how does the owner make, rename, delete and fill one?

## Decision Drivers

- A list with no projects has to look as it did, and a `layout.json` written before projects has to load unchanged.
- Every step has to work on a phone, so none can need a drag.
- Deleting a project must not lose a group, a session or a pin.
- Every change has to be a POST behind the same-origin check, because the sign-in cookie is `SameSite=Lax` and a link on another site can send a GET (see the [sign-in record](20261007-password-sign-in-and-local-bind.md)).
- A name is text the owner typed, so the page must never draw it as markup.

## Considered Options

1. Groups that nest to any depth
2. One optional level of projects above groups
3. A flat list that only folds

## Decision Outcome

Chosen option: "One optional level of projects above groups", because it gives the owner the three levels they asked for with one new list and one new field, and leaves the rest of the sidebar as it was.

- **Shape.** A project holds groups and a group holds sessions. A group is in at most one project, and a group in none stays at the top level, where every group used to be. Pinned, Started here, Ungrouped and Terminal and other are never in a project.
- **File.** `layout.json` gains `projects`, a list of `{ id, name }` in display order, and a group gains an optional `project` that holds a project id. A file without `projects` loads as having none and is not rewritten until something changes. A group whose project is gone shows at the top level. A project's id is `cp-` and a group's is `cg-`, each followed by a random UUID. Keys that this version does not know are kept when it writes the file.
- **Names.** A name collapses to one line, runs to 80 characters at most and cannot be empty. Two projects may share a name. The page draws a name as text.
- **Routes.** `POST api/layout/project/add` (`{ name }`), `project/rename` (`{ id, name }`), `project/remove` (`{ id }`), `group/add` (`{ name, project }`) and `group/move` (`{ id, project }`), where a `project` of null means the top level. Each answers with the project or group it made, changed or removed. A bad name is a 400 and an unknown project or group is a 404. A GET or a PUT to those paths is a 404. A layout file that cannot be read is reported and never written over.
- **List.** `GET api/sessions` carries `projects` in order and a `project` on each group, null for a group at the top level. `groups` stays one flat list, so the code that finds a row, places a drop or searches the list is unchanged.
- **Delete.** Deleting a project moves its groups to the top level and deletes no group, session or pin. The page asks first and says how many groups will move.
- **Page.** The list runs Routines, Pinned, the projects, the groups at the top level, Started here, Ungrouped and Terminal and other. A project header and a group header fold, and each browser remembers which are folded. A project's count is the number of sessions in its groups. While a row is dragged every project is open, so each group is a place to drop it.
- **Menus.** A project and a group each have a dots button, and a right click or the menu key on a header opens the same menu. The + at the top of the list adds a project, or a group at the top level. A project's menu has New group here, Rename and Delete project. A group's menu has Move to top level and a Move to line for each project it is not in, and its button shows only when there is somewhere to move it. Rows drag as before, and headers do not drag.

### Consequences

- ✅ Related groups can sit under one header that folds, and a phone can do every step.
- ✅ A list with no projects looks as it did, and an older file loads unchanged.
- ✅ Deleting a project cannot lose a group, a session or a pin.
- ❌ A group still cannot be renamed, deleted or reordered from the page. Those mean editing `layout.json`.
- ❌ Projects do not nest, and neither a project nor a group can be dragged.
- ❌ A Capcom from before this change drops `projects` the next time it moves or pins a session, so the groups fall back to the top level. Checked by running that version's layout module on a scratch file.

## Pros and Cons of the Options

### Groups that nest to any depth

A group could hold groups.

- ✅ Any shape of tree
- ❌ Counting, folding, dropping and searching would each walk a tree, and moving a group on a phone would need a picker over the whole tree
- ❌ The owner asked for three levels

### One optional level of projects above groups

- ✅ One new list and one new field, and `groups` stays flat
- ✅ The menu that moves a group is a short list of projects
- ❌ A fourth level would need a new decision

### A flat list that only folds

Groups already fold, so this adds nothing to the file.

- ✅ No new data
- ❌ Related groups cannot sit together

## Links

- [Capcom keeps its own session layout, seeded once from Desktop's](20261015-own-session-layout-seeded-from-desktop.md), which holds the layout file that this record extends
- [Protect Capcom with a password, a local-only bind and a private network](20261007-password-sign-in-and-local-bind.md), which requires every write to be a POST behind the same-origin check
- [Rewrite the front end on vendored Preact with htm](20261015-preact-htm-front-end.md), which the menus and forms are written in
