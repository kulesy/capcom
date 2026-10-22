# List a chat's skills and commands under / from the CLI's own list

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-22
- Tags: ui, cli, prompt box, skills, keyboard, accessibility

## Context and Problem Statement

In Claude Code, typing / at the start of the prompt lists the skills and slash commands the session can run, filtered as you type. Capcom's prompt box had no such list, so a skill could only be run by typing its full name from memory. Eli asked for the same list in Capcom.

The skills a chat can run depend on its folder and on the CLI: the user's own skills, the folder's project skills, plugin skills, the CLI's built-in commands and skills synced from claude.ai. A new session has no CLI process until its first message is sent, and neither does a chat that is not open. Where should the list come from, and how should it behave in the prompt box?

## Decision Drivers

- The list should match what the CLI runs for that chat, with the same names, descriptions and argument hints.
- A new session needs a list before its first message.
- Building the list must not write a session, start MCP servers, run hooks or call a model.
- A page on another site must not be able to start a CLI process through Capcom.
- A message that starts with / must still send as typed: a path, or a command the list leaves out.
- The menu should follow shadcn/ui's combobox and Claude Code's keys, and work with a screen reader, an IME and a phone's on-screen keyboard.

## Considered Options

1. Ask the CLI with the `initialize` control request: the chat's own process when it runs, a short probe of the folder when it does not
2. Read the skill and command folders on disk
3. Use the `slash_commands` names in the CLI's `system` `init` message

## Decision Outcome

Chosen option: "Ask the CLI with the `initialize` control request", because it is the only source with every command the chat can run, with its description and argument hint, before the first message.

- **The list.** The CLI answers the Agent SDK's `initialize` control request with `commands`, each with its name, description, argument hint and aliases. This is what the SDK's `supportedCommands()` reads. A running chat keeps the reply its own process gave when it started. For a new session, or a chat with no process, Capcom starts `claude -p` in that folder with `--strict-mcp-config --no-session-persistence` and hooks turned off, sends only `initialize`, and stops the process once it answers. No message is sent, so no model is called and no session file is written. Hooks are off because a folder's SessionStart hooks ran on such a probe, which is not a session. On CLI 2.1.307 the answer came in about 0.6 seconds. Capcom keeps a folder's list for 2 minutes, and a chat's own reply refreshes it.
- **What it leaves out.** Names that start with `__`, which the CLI marks as for server-launched sessions only, and `/clear`. The CLI answers `/clear` with a new conversation under a new session id, and Capcom's chat does not follow it. Typing either by hand still sends it.
- **The route.** `POST /api/commands` takes `{ id }` for a chat or `{ cwd }` for a new session's folder. It is a POST so that Capcom's same-origin check covers it.
- **The menu.** shadcn/ui's combobox: its command list in a popover above the prompt box. Typing / at the start opens it, and the rest of the word filters it by name and alias, best match first. The arrow keys move, Enter or Tab picks, a click or tap picks and Esc closes. Picking writes `/name ` and shows the command's argument hint after it in grey. While the list is open, Enter picks, as in Claude Code, so a command typed in full takes a second Enter to send. After Esc, Enter sends what is typed. When nothing matches, the list closes, so a message that starts with a path is left alone. The prompt box is the combobox for a screen reader, with `aria-expanded`, `aria-controls` and `aria-activedescendant` pointing into a listbox. The list stays closed while an IME is composing. On a phone it sits above the on-screen keyboard and scrolls inside the room left there.
- **Running it.** A picked command goes through Capcom's normal send as text, and the CLI expands the skill as it does in a terminal.

### Consequences

- ✅ The list is the CLI's own, so it has every skill the chat can run, in the CLI's order, and Capcom keeps no copy of the CLI's rules.
- ✅ A new session lists its folder's project skills before the first message.
- ❌ `initialize` and its `commands` are the Agent SDK's contract with the CLI, not a published one, so a CLI update could change them. If the reply has no list, the menu says it could not load the commands, and typing still sends.
- ❌ The first / in a new session's folder starts a short CLI process.
- ❌ A running chat keeps the list its process started with, so a skill added since shows there after the process restarts.

## Pros and Cons of the Options

### Ask the CLI with the `initialize` control request

- ✅ The same list as the CLI, with descriptions, argument hints and aliases.
- ❌ Relies on a control request the CLI does not document.

### Read the skill and command folders on disk

- ✅ No process to start.
- ❌ Misses the built-in commands, plugin skills and skills synced from claude.ai, and would copy the CLI's rules for precedence, plugin names and disabled skills.

### Use the `slash_commands` names in the CLI's `system` `init` message

- ✅ Already in the stream Capcom reads.
- ❌ Names only, with no description or hint, and it arrives after the first message, so a new session would have no list.

## Links

- Builds on [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md), whose process gives a running chat its list
- Follows [Build Capcom's look and behaviour on shadcn/ui](20261022-shadcn-design-language.md) for the combobox
