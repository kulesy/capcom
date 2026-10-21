# Architecture decision records

One file per decision, named by the day the decision was made. A record that a later decision replaced stays in place, marked as superseded, with a link to its replacement. Start a new record from [template.md](template.md).

| Date | Decision | Status |
| --- | --- | --- |
| 2026-10-06 | [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md) | Accepted, amended 2026-10-16 |
| 2026-10-06 | [List sessions from transcripts and Desktop's records, read only](20261006-read-only-session-list.md) | Accepted, amended 2026-10-21 |
| 2026-10-07 | [Offer Claude in Chrome as a guarded per-chat switch](20261007-claude-in-chrome-guarded-switch.md) | Superseded by [Claude in Chrome on by default](20261015-claude-in-chrome-on-by-default.md) |
| 2026-10-07 | [Build Capcom on Node's standard library and plain browser files](20261007-no-dependencies-no-build-step.md) | Partly superseded by [Preact with htm for the front end](20261015-preact-htm-front-end.md) |
| 2026-10-07 | [Serve Desktop-style tools from Capcom's own MCP server](20261007-own-mcp-server-for-desktop-style-tools.md) | Accepted, amended 2026-10-19 |
| 2026-10-07 | [Protect Capcom with a password, a local-only bind and a private network](20261007-password-sign-in-and-local-bind.md) | Accepted, amended 2026-10-15 and 2026-10-16 |
| 2026-10-08 | [Start sessions with the settings Claude Desktop would use](20261008-settings-follow-claude-desktop.md) | Accepted |
| 2026-10-13 | [Publish Capcom as a public repository under the MIT licence](20261013-public-repo-under-mit.md) | Accepted |
| 2026-10-14 | [Match Desktop's flow for new sessions, settings, stopping and tool calls](20261014-desktop-like-prompt-box-flow.md) | Accepted, amended 2026-10-15, 2026-10-16, 2026-10-19 and 2026-10-21 |
| 2026-10-14 | [Hand new sessions to Claude Desktop through its resume link](20261014-hand-new-sessions-to-desktop.md) | Accepted, amended 2026-10-15 (opt-in, off by default) |
| 2026-10-15 | [Make Capcom the only client and stop integrating with Desktop](20261015-capcom-is-the-only-client.md) | Accepted, amended 2026-10-15 |
| 2026-10-15 | [Turn Claude in Chrome on by default in every chat and mode, as Desktop does](20261015-claude-in-chrome-on-by-default.md) | Accepted, amended 2026-10-15 |
| 2026-10-15 | [Rewrite the front end on vendored Preact with htm, with no build step](20261015-preact-htm-front-end.md) | Accepted. Shipped 2026-10-15. |
| 2026-10-15 | [Capcom keeps its own session layout, seeded once from Desktop's](20261015-own-session-layout-seeded-from-desktop.md) | Accepted, amended 2026-10-21 |
| 2026-10-15 | [Send pasted images as content blocks and show transcript images through an endpoint](20261015-images-in-the-prompt-box.md) | Accepted, amended 2026-10-17 |
| 2026-10-15 | [Capcom runs routines itself, from Desktop's prompt files](20261015-capcom-runs-routines-itself.md) | Accepted |
| 2026-10-16 | [Run the server under a small Capcom app, so macOS permissions belong to Capcom](20261016-capcom-app-for-macos-permissions.md) | Accepted |
| 2026-10-16 | [Show Claude's live work from the CLI's stream, and ask the CLI for thinking summaries](20261016-live-work-from-the-cli-stream.md) | Accepted, amended 2026-10-19 |
| 2026-10-16 | [Show the CLI's own user turns as compact notices, from a closed list of known tags](20261016-notices-for-cli-written-user-turns.md) | Accepted, amended 2026-10-16 |
| 2026-10-16 | [Sign in with passkeys that Capcom checks itself on node:crypto, against a list of origins](20261016-passkeys-on-node-crypto.md) | Accepted |
| 2026-10-16 | [Show messages between chats by sender, and show a held message with no way to approve it](20261016-peer-messages-between-chats.md) | Accepted |
| 2026-10-16 | [Let groups sit under projects, and make every change from a menu](20261016-projects-above-groups.md) | Accepted, amended 2026-10-21 |
| 2026-10-19 | [Draw widgets the way Desktop does, in a frame that cannot reach Capcom](20261019-widgets-render-like-desktop.md) | Accepted |
