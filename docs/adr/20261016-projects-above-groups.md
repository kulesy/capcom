# Let groups sit under projects, and make every change from a menu

- Status: Accepted, amended 2026-10-21
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
- **Names.** A name collapses to one line, loses the characters that reorder the text around it, runs to 80 characters at most and must show something, so a name of only invisible characters is refused. Two projects may share a name. The page draws a name as text.
- **Routes.** `POST api/layout/project/add` (`{ name }`), `project/rename` (`{ id, name }`), `project/remove` (`{ id }`), `group/add` (`{ name, project }`) and `group/move` (`{ id, project }`), where a `project` of null means the top level. Each answers with the project or group it made, changed or removed. A bad name is a 400 and an unknown project or group is a 404. A GET or a PUT to those paths is a 404. Each route checks the sign-in again once the body has arrived, so a new password that lands mid-request is honoured. A layout file that cannot be read is reported and never written over.
- **List.** `GET api/sessions` carries `projects` in order and a `project` on each group, null for a group at the top level. `groups` stays one flat list, so the code that finds a row, places a drop or searches the list is unchanged.
- **Delete.** Deleting a project moves its groups to the top level and deletes no group, session or pin. The page asks first and says how many groups will move.
- **Page.** The list runs Routines, Pinned, the projects, the groups at the top level, Started here, Ungrouped and Terminal and other. A project header and a group header fold, and each browser remembers which are folded. A project's count is the number of sessions in its groups. While a row is dragged every project is open, so each group is a place to drop it. **Amended 2026-10-21:** the list shows one view at a time, Home or one project, so a drag opens only the project on screen. The projects are picked in a sidebar of their own. See the second amendment below.
- **Menus.** A project and a group each have a dots button, and a right click or the menu key on a header opens the same menu. The + at the top of the list adds a project, or a group at the top level. A project's menu has New group here, Rename and Delete project. A group's menu has Move to top level and a Move to line for each project it is not in, and its button shows only when there is somewhere to move it. Rows drag as before, and headers do not drag. **Amended 2026-10-21:** the + starts a session or adds a group in the view on screen, and no longer adds a project, and the group menu says Move to Home. See the amendments below.

**Amended 2026-10-21.** The + also starts a session, and lists New session above New project and New group. It opens before the list has loaded, with only New session until then. See [Match Desktop's flow for new sessions](20261014-desktop-like-prompt-box-flow.md).

**Amended again 2026-10-21.** The owner asked for the projects to be a second sidebar to the left of the list, level with it and never over it, and for the search to find them too. The list now shows one view at a time, and that sidebar picks the view.

Home is the first view. It shows Routines, Pinned, the groups at the top level, Started here, Ungrouped and Terminal and other, and a group whose project is gone counts as one of the top level's. Each project is a view of its own. It shows Pinned and then that project, with its header and its groups as before. Pinned shows in every view. Routines and the loose sections show in Home only. Each browser remembers the view in use. If the project in view is gone, the view is Home. Delete project sends the owner there too.

In a window 56rem wide or more, the sidebar is a 14rem column to the left of the list, and the chat narrows to make room. The button at the left of the list's header opens and closes it, and each browser remembers whether it is open. In a narrower window there is no room beside the list, so the sidebar is a level of its own, as the list and the chat are. It fills the screen in place of the list, and nothing lies over anything. Its header has the same button in the same spot, pressed, with the title Projects beside it. Pressing the button, picking Home or a project, and pressing Esc all go back to the list, with the focus on the button that opens the sidebar. A change of route, a change of view and the window growing to 56rem go back to the list too, without moving the focus. The level is never remembered, so a phone always starts on the list. The sidebar is one element at both sizes, so a project name half typed in the level survives the window growing to 56rem when the column is open there.

Later the same day the owner asked for a key that opens the sidebar. Cmd+B and Ctrl+B open and close it, as Cmd+B shows and hides Desktop's sidebar. Neither is among the commands Chrome reserves (`kReservedCommandIds` in [accelerator_table.cc](https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/ui/accelerator_table.cc)), so both reach the page in a tab as well as in the installed app. As with Cmd+N, the page never sees them while a widget's sandboxed frame has focus. The keys close the search and any open menu first, as Ctrl+N and Ctrl+K do. In a window 56rem wide or more they leave the focus where it is, unless it is in the search or inside the column they close, when it goes to the button that opens the sidebar. The level opens and closes as it does from its button. In a narrower window with a chat on screen, the keys put the list on screen first, as a view picked in the search does, and the level opens in the list's place. The button's tooltip names the key with the modifier the other hints name: Cmd in the app on a Mac and Ctrl everywhere else.

The search finds the views too. It has a Projects chip after Sessions, which lists Home and then each project in the order of the sidebar, and the words typed filter them by name. Under All, a Projects section sits above Sessions when words are typed, and between Recents and Actions when none are. The section is left out when there is no project, because Home is then the only view. A result looks like a session's: the lamp, the name, the number of sessions where a session shows its time, and a line that says Project and what the lamp says. Home's line says Everything outside projects, and Home has no number. Opening one by click or Enter closes the search and shows that view, with the focus on the view's header. In a window 56rem wide or more an open chat stays open. In a narrower one the list takes the chat's place, and the level goes if it was showing. Only a pick from the search moves the focus. Showing the view of a chat never does.

When a chat is opened and its row is in another view, the page switches to that view. It does this once for each chat, as soon as the row is in the list, so a refresh of the list does not undo a view the owner picked, by hand or in the search. Opening a pinned chat leaves the view as it is. Home and each project show a lamp, amber when a chat in it needs the owner and green when one is working, with the same words for a screen reader. A pinned chat does not count towards a lamp, because it shows in every view. When the sidebar is not showing and a chat in another view needs the owner, the button gets an amber dot. New project is a button in the sidebar and nowhere else. The new project becomes the view, the page goes back to the list if the sidebar was a level of its own, and the focus goes to the new project's header. New project leaves the +, so the + now reads New session or group. New session stays first, and New group makes the group in the view on screen: at the top level in Home, and in the project in a project view. A group's menu says Move to Home where it said Move to top level. After a move the page says where the group went and stays in the view it was in. A row still drops onto any section on screen, and nothing drops onto the sidebar. Move to in a row's menu lists the groups of every project, so it moves a row to a view that is not on screen.

### Consequences

- ✅ Related groups can sit under one header that folds, and a phone can do every step.
- ✅ A list with no projects looks as it did, and an older file loads unchanged. **Amended 2026-10-21:** the list has the Projects button at the left of its header, and the sidebar lists Home alone.
- ✅ Deleting a project cannot lose a group, a session or a pin.
- ✅ A chat that needs the owner shows in the sidebar's lamps, in the search's results and on the button's dot even when its view is off screen, and a chat opened from the search or a link shows its row, because the page switches to its view.
- ❌ A group still cannot be renamed, deleted or reordered from the page. Those mean editing `layout.json`.
- ❌ Projects do not nest, and neither a project nor a group can be dragged.
- ❌ On a Mac, Ctrl+B no longer moves the cursor back a character in Capcom's text fields. Pressed there, it shows or hides the sidebar, so in a narrower window it leaves a chat for the list, and closing the sidebar drops a project name half typed in it.
- ❌ A row cannot be dragged into a group in another project, because only one view is on screen. Move to in the row's menu makes that move instead.
- ❌ On a phone, changing view takes two taps, one to open the sidebar and one to pick the view, or one pick in the search.
- ❌ At 56rem with the sidebar open, the chat is 20rem wide. It gains the width of the window from there, and the column can be closed to give it back.
- ❌ Each browser keeps its own view and its own open column, so a phone and a laptop can show different views.
- ❌ A Capcom from before this change drops `projects` and `unarchived` the next time it moves or pins a session, so the groups fall back to the top level and the sessions that a message brought back return to the archive. Checked by running that version's layout module on a scratch file.

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
