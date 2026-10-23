# Show the CLI's own user turns as compact notices, from a closed list of known tags

- Status: Accepted, amended 2026-10-16 and 2026-10-23
- Deciders: Eli
- Date: 2026-10-16
- Tags: transcripts, notices, background-tasks, task-notification

## Context and Problem Statement

The CLI saves some messages it wrote itself as user turns. When a background task ends, it saves a `<task-notification>` block, as a user entry when Claude is idle and as a `queued_command` attachment when Claude is mid-turn. Messages from another session or a subagent, lines from a monitor and commands run with `!` are saved the same way (a command run with `!` stopped being a notice on 2026-10-23, see the amendment). Capcom showed each as a message from the owner, with the raw XML as its text. A sweep of the transcripts changed in the last 14 days found 2,611 task notifications in 371 sessions.

How should the page show them?

## Decision Drivers

- They are not the owner's words, so they should not look like the owner's messages.
- The result of a background task is worth one line, and its ids and paths are worth keeping out of the way.
- Loading a session and following one live have to give the same result.
- Text the owner types that mentions a tag has to stay the owner's message.

## Considered Options

1. Parse a closed list of known tags into a `system` item that the page draws as a notice
2. Hide every user turn that starts with a tag
3. Show the raw text in a quieter style

## Decision Outcome

Chosen option: "Parse a closed list of known tags into a `system` item that the page draws as a notice", because it shows what happened in one line and cannot mistake the owner's own typing for a notice.

- **Parser.** `lib/notices.mjs` turns the text of a user turn into a `system` item: a title, an optional state (done, failed or stopped), a line of text, an optional output block and labelled details. `userItem` in `lib/transcripts.mjs` calls it. The load and the live update read through the same parser, so they agree.
- **Known tags.** `task-notification`, `cross-session-message`, `ci-monitor-event`, `agent-message` and `side-sessions-event`. A task notice is titled by its status, as in "Background task finished" or "2 background tasks stopped". A monitor line has no status and reads "Background update".
- **Details.** The task ids, the tool call id, the output file, the CLI's note and text addressed to Claude alone sit behind a Details toggle, with the escapes the CLI adds undone. Ids that start with `__orphan_summary__` are the CLI's own markers and never show.
- **Lamp.** Green for finished, red for failed, grey otherwise, in the page's existing lamp style.
- **Mid-turn.** The reader accepts `commandMode: 'task-notification'` on a `queued_command` attachment, next to `prompt`. Checked on CLI 2.1.301.
- **Pasted text.** The `<pasted_content>` tags the CLI puts round a paste come off, and the text stays the owner's message.
- **Titles.** A session whose first user entry is a notice takes its title from its first real message.
- **Checked.** After the change, no user message in those transcripts begins with a tag.

**Amended 2026-10-16.** A message from another session now also arrives as a meta user entry whose `origin` has kind `peer`, or, when Claude is mid-turn, as a `queued_command` attachment with `commandMode: 'prompt'` whose prompt is the bare `<cross-session-message>` tag. `metaNotice` in `lib/notices.mjs` reads both, as the attachment carries `isMeta` and the `origin` itself, and the CLI's own reports on a message this chat sent (meta entries or meta attachments that start with `[Cross-session delivery notice]`) become notices too. See [Show messages between chats by sender](20261016-peer-messages-between-chats.md).

**Amended 2026-10-23.** A command run with `!` is no longer a notice. Its `<bash-input>`, `<bash-stdout>` and `<bash-stderr>` tags read as a `bash` item with the command, its output and its errors, because the page now draws a command as a block with Run and Copy, and Capcom hands its own `!` commands to Claude in the same shape. `bashFrom` in `lib/notices.mjs` reads the tags, `userItems` in `lib/transcripts.mjs` puts the item before a user item for any text after them, and the `bash-*` tags are off the list above. See [Run terminal commands on pipes with no PTY](20261023-terminal-without-a-pty.md).

### Consequences

- ✅ A finished background task reads as one line with a lamp, on load and live, and no raw XML shows.
- ✅ Typed text is never mistaken for a notice, even when it mentions a tag.
- ❌ The list is closed, so a new kind of CLI message shows as the owner's text until its tag is added.
- ❌ Both shapes are observed and not documented. Recheck them after a CLI update.

## Pros and Cons of the Options

### A closed list of known tags

- ✅ Each kind gets a title, a state and details that fit it
- ❌ A new kind of message needs a line of code

### Hide every user turn that starts with a tag

- ✅ No list to keep
- ❌ Drops the result of a background task, and hides markup the owner pasted or typed

### Show the raw text in a quieter style

- ✅ No parsing
- ❌ The XML stays on screen, on the owner's side of the thread

## Links

- [Send pasted images as content blocks](20261015-images-in-the-prompt-box.md), which reads the other kind of `queued_command` prompt
- [Run terminal commands on pipes with no PTY](20261023-terminal-without-a-pty.md), which turned the `!` command tags into `bash` items
