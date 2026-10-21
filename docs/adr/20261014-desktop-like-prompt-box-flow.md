# Match Desktop's flow for new sessions, settings, stopping and tool calls

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-14
- Tags: prompt-box, control-requests, tool-calls, claude-desktop

## Context and Problem Statement

Capcom's first version had a separate form for new sessions, the mode and Chrome controls in the chat header, a Stop button of its own and one row for each tool call. Desktop puts the controls in the prompt box, turns Send into Stop while Claude works, and summarises a run of tool calls in one line. On 14 Oct the owner chose four changes to build: the new-session flow, the controls, Send turning into Stop, and grouped tool calls.

Should Capcom copy all four?

## Decision Drivers

- The owner uses Desktop and wants the same habits in Capcom.
- Model and effort should change mid-session without a restart.
- A message typed while Claude works should steer it.

## Considered Options

1. Build all four changes
2. Build some of the four
3. Keep the first version's flow

## Decision Outcome

Chosen option: "Build all four changes", because the owner wants Capcom to work the way Desktop does.

- **New session.** "+ New session" opens an empty chat with a folder picker above the prompt box. The first message starts the session in that folder.
- **Controls.** The mode, model and effort pickers sit under the text, with Desktop's labels. The `+` menu holds the Chrome switch.
- **Send and Stop.** While Claude works and the box is empty, Send turns into Stop, and Esc stops too. A message typed during a turn redirects Claude. The CLI holds it until the running tool finishes, and Claude reads it before its next step.
- **Tool calls.** Calls between Claude's messages collapse into one row, such as "Read 3 files, ran 2 commands". A Normal and Verbose switch in the chat header shows them ungrouped, and the browser remembers the choice.
- **Model and effort.** A change goes to the running process as a `set_model` or `apply_flag_settings` control request, so Capcom does not restart the process. It applies from Claude's next request, even mid-turn. Capcom saves each pick in `picks.json` in its state folder, so the pick survives the idle stop and a restart.

**Amended 2026-10-15.** The owner had the Normal and Verbose switch removed, so tool calls are always grouped and a group opens to show each call. The `+` menu went with the Chrome switch. Ctrl+N starts a new session, and the "+ New session" button was removed. A Ctrl+K spotlight replaced the search box, and every section of the list shows its newest session first, with routines at the top.

**Amended 2026-10-16.** A thought among the calls joins the row, as in "Thought, ran 2 commands", and opens with the calls. A thought with no call beside it is a row of its own. See [Show Claude's live work](20261016-live-work-from-the-cli-stream.md).

**Amended 2026-10-19.** Cmd+N also starts a new session in the installed app, at the owner's request. In a tab, Chrome lists New Window among its reserved commands (`kReservedCommandIds` in [accelerator_table.cc](https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/ui/accelerator_table.cc)) and runs it before the page gets the key. In an app's window `BrowserCommandController::IsReservedCommandOrKey` reserves no keys ([browser_command_controller.cc](https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/ui/browser_command_controller.cc)), so the page gets Cmd+N first and Capcom calls `preventDefault` to keep it from Chrome. Capcom takes Cmd+N only while `(display-mode: standalone)` matches. A full-screen app window reports `fullscreen`, so Capcom treats it as a tab. The hints in the search, on the Find button and on the empty page name Cmd in the app on a Mac, since only a Mac has a Cmd key, and Ctrl everywhere else. The page never sees the key on the sign-in page or while a widget's sandboxed frame has focus, so there Cmd+N still opens a second Capcom window, and File > New Window always does.

**Amended 2026-10-21.** At the owner's request, New session is back, as the first item in the + menu at the top of the list, above New project and New group. On a phone, with no keyboard, the + and the search are the ways to start a session. The + opens before the list has loaded, with only New session until it has, and the new chat at `#/new` opens without waiting for that first load. The item shows the same key as the search's New session action, Cmd in the app on a Mac and Ctrl everywhere else, and Capcom hides both hints on a touch screen. Later the same day New project moved out of the + into the projects sidebar, so the + now holds New session and New group. See [Let groups sit under projects, and make every change from a menu](20261016-projects-above-groups.md).

**Amended 2026-10-21.** Cmd+A archives a session, at the owner's request. Chrome does not reserve Cmd+A (it is not in `kReservedCommandIds`), so the page gets the key in a tab and in the app, and Capcom calls `preventDefault` when it archives. Capcom takes the key only on a Mac. Elsewhere the Meta key belongs to the system, and Select All is Ctrl+A, which Capcom leaves to the browser on every system. Text fields (`input`, `textarea`, `select`, `contenteditable`) and the forms in the list and the projects sidebar keep Select All. Otherwise the key archives the session whose row menu is open, or else the row that shows the focus ring, or else the open chat (`archiveTarget` in `public/ui/tree.js`). With any other menu open it archives nothing, the search, the image viewer and a question keep the key, and with no session to archive and no ring in the list or the projects sidebar it still selects the page. A row focused by a click shows no ring and does not count, because Chrome leaves the focus on a clicked link, where the owner cannot see it. In headless Chromium 151 such a row stays without `:focus-visible` while Cmd is held. After the key archives a session, the row the focus moves to gets the ring through `focus({ focusVisible: true })`, because Chrome gives none to a script's focus that follows a click. A second press then archives that row. When no row is left beside it, the ring goes to the first header in the list, or to the Projects button when no header is left. A ring on anything in the list or the projects sidebar that is not a row takes the key and archives nothing, so a press too many cannot reach the open chat, which may sit in another view. A key is easier to press by mistake than a menu item, and archiving a chat that is working or waiting stops its turn for good, so for one of those Capcom asks first, in a dialog over the whole page with Cancel focused. While the dialog is open, a capture listener on the document takes every key, so Esc cannot also reach the prompt box and stop the chat. A second question waits for the first, and the question's one text holds for a working chat and a waiting one, since the list can be behind on which it is. The list's state can be 15 seconds old, so any other chat is archived with `stop: false`, by the key and by the menu's Archive item alike. If a turn has started, the server refuses with a 409 and the page asks. Archiving the open chat, from the key or the menu, goes back to the list, because below 56rem the list and its note with Undo are hidden while a chat is open. A refusal goes back too when the list is hidden, so its note can be seen. Undo opens the chat again while the page is still on the list. On a Mac the row menu shows Cmd A beside its archive item, except on a touch screen.

### Consequences

- ✅ New sessions, settings and stopping work as they do in Desktop.
- ✅ A model or effort change does not interrupt the work.
- ❌ `set_model` and `apply_flag_settings` are Agent SDK control requests, not a published contract. They were proven on CLI 2.1.299. `apply_flag_settings` accepts any effort level, so `server.mjs` checks the level against the CLI's list first.

## Pros and Cons of the Options

### Build all four

- ✅ One consistent flow, matching Desktop
- ❌ The most work to build and to test

### Build some of the four

- ✅ Smaller change
- ❌ The flow would match Desktop in some places and not others

### Keep the first version's flow

- ✅ No work
- ❌ A separate form, header controls and a separate Stop button that Desktop does not have

## Links

- [Settings follow Claude Desktop](20261008-settings-follow-claude-desktop.md)
- [Preact with htm for the front end](20261015-preact-htm-front-end.md), the rewrite that carries this flow forward
