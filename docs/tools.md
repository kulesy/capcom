# Tools

The tools GhostShell gives a session: its own `capcom` MCP server, and the Desktop features that are still Desktop only.

GhostShell sessions get the standard Claude Code tools, the claude.ai connectors and the MCP servers in `~/.claude.json`. Desktop serves its own built-in tools from inside the Desktop app, so GhostShell cannot borrow them. It adds its own instead, the same way: a server called `capcom`, declared in the initialize request and answered over the session's stdio (`lib/tools.mjs`).

How sessions start, what they inherit from Desktop and how hand-off works are in [how it works](how-it-works.md#settings-follow-claude-desktop).

## Chips

The `spawn_task` and `dismiss_task` tools make chips. A chip shows as a card with Start and Dismiss. Start opens a new GhostShell session with the chip's prompt, in the folder printed on the card. A chip can carry a model and an effort level, which the card shows after the folder. The session it starts runs on them, and you can change either from the model menu afterwards. Chips that Desktop sessions created can be started too. A session started from a chip [nests under the session that made it](session-list.md#sessions-started-from-a-chip).

## Chapters

The `mark_chapter` tool makes chapters, which show as titled dividers.

## Sub sessions

Every chat that is not a group's gets `list_sub_sessions` and `read_sub_session`, which reach the sessions below that chat, at any depth, and no others. `list_sub_sessions` lists them as a tree, the ones that need you first, each with its roll-up and the first sentence of its latest reply. `read_sub_session` reads the end of one of them and what it waits on. Both only read, so they run with no card in every mode. An id outside the chat's family gets the same refusal as an id that is no session.

GhostShell never starts a turn in a parent to pass status up. A parent's model learns what is below it when it calls these tools, and you see the same status in the chat's [Sub sessions tab](session-list.md#sub-session-status).

## Group sessions

Each group's header has a button that opens the group's own chat at `#/g/<group id>`, and it lights with the chat's mark while that chat works or waits for you. The chat works in a private folder under GhostShell's state folder, shows the group's live status in its side panel, and gets three tools that reach that group alone: `list_group_sessions`, `read_group_session` and `start_group_session`. Starting a session always asks first, in every permission mode. [The decision record](adr/20261023-a-session-for-each-group.md) says what it can and cannot do.

### The group status

The page draws the status from the list it already loads, so it costs no tokens. It is the chat's Sub sessions tab, laid out as [a session's](session-list.md#sub-session-status): each line is one of the group's sessions with its whole family under it, placed by the most urgent session in the family, and the line at the top rolls up the whole group, as "5 sessions, 1 waiting on you, 1 working". The panel opens by itself on a wide screen, and the button in the chat's header opens it on a phone.

Idle sessions show last, under their own heading. Archived sessions stay out of the tab, as they stay out of the list.

A server that started before sub session status draws the group's status above the transcript instead, folded to one line such as "2 need you · 3 working · 12 recent · 140 more", with the idle and archived sessions in a fold of their own. A server that started before groups had sessions has no button, and the group's page says to restart GhostShell.

## Widgets

The `show_widget` tool draws a widget in an iframe sandboxed to `allow-scripts`, with a content policy that limits requests to cdnjs, esm.sh, jsDelivr, unpkg and Google Fonts, so model-written HTML cannot reach GhostShell or its cookie.

The frame carries Desktop's variable names, SVG classes and colour ramps (with GhostShell's own values) and the Tabler icons, so a widget written for Desktop draws the same.

`sendPrompt` sends a message at once on a click inside the widget and asks you first for anything else, and links always ask first. `widget_guide` tells the model how to write one, once per chat, and its `loading_messages` show in a placeholder while it writes.

## Questions

`AskUserQuestion` shows as option buttons, plus a box for your own answer.

## Claude in Chrome

Claude in Chrome is on in every session and every permission mode, as it is in Desktop. The `chrome` setting turns it off for all of GhostShell (see [configuration](configuration.md#chrome)).

GhostShell starts the CLI with `--chrome` and an ask rule for every Chrome tool, so Chrome asks before each action, even ones your settings already allow, and the question shows as an approval card. Bypass permissions is the exception: GhostShell allows Chrome there without a card, as Desktop does, and a switch to a stricter mode asks again at once. Chrome cards have no Always allow.

## Still Desktop only

These stay in Desktop:

- The in-app browser.
- The iOS Simulator panel.
- Desktop's window and sidebar.
- Computer use (not available to the CLI in `-p` mode).
