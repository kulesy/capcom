# Drive each chat with a headless Claude Code process

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-06
- Tags: engine, claude-code, stream-json, sessions

## Context and Problem Statement

The owner wanted a browser chat client for all Claude Code sessions on the Mac: the ones started in Claude Desktop, the routine runs and the ones started in a terminal. The owner had several existing web clients researched. Some read the session folder but do not organise sessions the way Desktop does. Others list only the sessions they launched themselves. None did both.

Capcom needs one way to send messages to Claude and to receive its replies and permission requests. Should it run the real CLI, or build on a library?

## Decision Drivers

- Chats must use the owner's own login, skills, hooks, MCP servers and settings.
- Chats must write the same transcripts the other clients read, so any client can continue a session.
- Capcom must be able to continue sessions it did not start.

## Considered Options

1. Run the Claude Code CLI headless, one process per open chat
2. Use the Agent SDK with an API key
3. Drive terminal sessions
4. Fork an existing web client

## Decision Outcome

Chosen option: "Run the Claude Code CLI headless, one process per open chat", because it uses the owner's own login, skills, hooks, MCP servers and settings, and it writes the same transcripts the other clients read.

Capcom starts `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio` for each open chat, with `--permission-mode` and a few more flags (`lib/runner.mjs`). An existing session adds `--resume <id>`. The CLI sends permission requests as control requests, and the page shows them as approval cards. A process stops after 30 idle minutes with no page open on it, and the next message starts it again.

**Amended 2026-10-16.** Right after `initialize`, Capcom also sends a `set_max_thinking_tokens` control request that asks for thinking summaries, and it reads the thinking, tool call and token events in the stream to show what Claude is doing while it works. See [Show Claude's live work](20261016-live-work-from-the-cli-stream.md).

**Amended 2026-10-23.** Each chat's process now runs on one Claude account. The account in `~/.claude` gets GhostShell's environment without `CLAUDE_CONFIG_DIR`, and any other account gets `CLAUDE_CONFIG_DIR` set to its config folder. See [Run each session on one Claude account](20261023-a-claude-account-per-kind-of-work.md).

### Consequences

- ✅ A chat behaves as it does in a terminal, and Capcom stores no API key.
- ✅ Capcom can continue any session by id, whoever started it.
- ❌ It depends on stream-json control requests, which are not a published contract. Notes in the code mark each place that leans on this, with the CLI version it was checked on (2.1.292 to 2.1.301).
- ❌ A session also open in Desktop continues in place under the same id, and the two can drift apart if the owner uses both at once. The owner accepted that over a fork or a read-only view.

## Pros and Cons of the Options

### Headless CLI, one process per chat

- ✅ Same login and setup as the owner's terminal
- ❌ The control requests can change between CLI versions

### Agent SDK with an API key

- ✅ A library interface instead of process flags
- ❌ The option on offer used an API key, while the CLI uses the owner's existing login

### Drive terminal sessions

- ✅ Real terminal sessions
- ❌ The clients researched that took this route listed only the sessions they launched

### Fork an existing web client

- ✅ Less to build
- ❌ None of the clients researched both saw all sessions and organised them by Desktop's groups

## Links

- [Read-only session list](20261006-read-only-session-list.md)
- [Capcom's own MCP server](20261007-own-mcp-server-for-desktop-style-tools.md)
