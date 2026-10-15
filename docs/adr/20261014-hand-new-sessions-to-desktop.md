# Hand new sessions to Claude Desktop through its resume link

- Status: Accepted, amended 2026-10-15 (opt-in, off by default)
- Deciders: Eli
- Date: 2026-10-14
- Tags: claude-desktop, hand-off, sessions

## Context and Problem Statement

Sessions that Capcom starts do not appear in Desktop's sidebar. On 14 Oct the owner noticed this. Capcom cannot add them itself, because Desktop keeps its session list in memory and writes over its files.

Capcom needs a way to add a session it started to Desktop's sidebar.

## Decision Drivers

- Desktop's files are off limits for writes.
- Capcom and Desktop must not run one session at the same time.
- The sidebar entry needs a useful title.

## Considered Options

1. Hand off automatically after the first reply
2. Offer an "Open in Desktop" button
3. Leave sessions in Capcom only

## Decision Outcome

Chosen option: "Hand off automatically after the first reply", because Desktop's own resume link is the only way into its sidebar, and the owner preferred it automatic over a button.

After a new session's first reply, Capcom stops its own process for that session. It adds a `custom-title` entry with a short title to the transcript and opens `claude://resume?session=<id>`. Desktop takes the title from that entry, adds the session to its sidebar and switches its window to it. The next message sent from Capcom starts the process again with `--resume`.

**Amended 2026-10-15.** The hand-off is now opt-in. `desktopHandoff` in `config.json` is `false`, because Capcom became the only client (see the [only-client decision](20261015-capcom-is-the-only-client.md)) and each hand-off adds to Desktop's sidebar and switches its window. Turning it on also hands over, the next time Capcom starts, all sessions started in Capcom that Desktop does not have yet. The mechanism itself is unchanged.

### Consequences

- ✅ With the setting on, sessions started in Capcom reach Desktop's sidebar with a title.
- ✅ Capcom stops its process before the link opens, so the two apps do not run the session together.
- ❌ Each hand-off adds to Desktop's sidebar and switches its window.
- ❌ It rests on a link scheme and a transcript entry that Desktop does not document. This comes from Desktop's code as read on 14 Oct 2026, so recheck it after a Desktop update.

## Pros and Cons of the Options

### Hand off automatically

- ✅ Sessions appear in Desktop without a step from the owner
- ❌ Switches Desktop's window without a prompt from the owner

### An "Open in Desktop" button

- ✅ The owner chooses when Desktop changes
- ❌ One more step, and sessions stay out of the sidebar until pressed

### Leave sessions in Capcom only

- ✅ Nothing touches Desktop
- ❌ New sessions do not appear in Desktop's sidebar

## Links

- [Read-only session list](20261006-read-only-session-list.md), which rules out writing Desktop's files
- [Capcom is the only client](20261015-capcom-is-the-only-client.md)
