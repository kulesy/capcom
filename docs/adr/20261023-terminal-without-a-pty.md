# Run terminal commands on pipes with no PTY, and run `!` commands in GhostShell

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-23
- Tags: terminal, side-panel, bash-mode, security, child-process, transcripts

## Context and Problem Statement

Claude Desktop has a terminal in a pane beside the chat, runs a command from a code block, and runs `!command` typed in the prompt box the way Claude Code's shell mode does. The owner asked for the same in GhostShell: a terminal panel in the session's folder, a Run button on code blocks, and `!command` in the prompt box. GhostShell has no dependencies, no build step and no native modules (see [Build Capcom on Node's standard library and plain browser files](20261007-no-dependencies-no-build-step.md)), and its server is the one process that can run a command as the owner.

How does GhostShell run a command, and what keeps a page that is not the owner's from running one?

Two facts about the CLI shape the answer. In the CLI, `!` at the start of the prompt runs the command directly and saves one user message of `<bash-input>`, `<bash-stdout>` and `<bash-stderr>` tags, and Claude then answers it unless `respondToBashCommands` is `false` in `~/.claude/settings.json`. In GhostShell's headless `claude -p --input-format stream-json`, a user message of `!echo hi` is not shell mode. Claude received it as a prompt and ran it with its own Bash tool (checked 2026-10-23).

## Decision Drivers

- No `node-pty`, no other native module and no vendored terminal emulator, because GhostShell has no build step and installs nothing.
- A command has to start in the session's folder, and `cd` has to carry from one command to the next, as in Claude Code's own Bash tool.
- Stop has to end a command and everything it started, and a restart of GhostShell must not leave commands behind.
- A command has to see the owner's real environment (`PATH`, version managers, tokens), not GhostShell's own.
- A `!` command has to reach Claude in the CLI's own format, so the transcript reads the same whichever app ran it.
- A command runs as the owner, so nothing but a click or Enter on the owner's own page may start one.

## Considered Options

1. One process per command on pipes, with no PTY, and GhostShell runs `!` itself and hands Claude the result
2. A real PTY (`node-pty`, or `script` as a PTY wrapper) with a terminal emulator in the page
3. Send `!command` to the CLI and let Claude's own tool run it

## Decision Outcome

Chosen option: "One process per command on pipes, with no PTY, and GhostShell runs `!` itself and hands Claude the result", because it needs no native module and no emulator, behaves like the Bash tool Claude already uses, and is the only option where GhostShell can promise what `!` does.

- **Spawn.** `lib/terminal.mjs` runs `$SHELL -c <wrapper> capcom <command>` with pipes for stdin, stdout and stderr and a fourth pipe, fd 3, that reports the final `$PWD`. The wrapper is `__capcom_c=$1; shift; eval "$__capcom_c"; __capcom_s=$?; printf '%s' "$PWD" >&3; exit $__capcom_s`. The command is `$1` and is never part of the script text. The shell is `$SHELL` when its name is zsh, bash, sh, ksh or dash, and `/bin/zsh` otherwise.
- **Folder.** The folder is the session row's `cwd`, read by the server (`findRow`), and nothing the request sends. Panel and code-block runs start in the panel's folder, which starts as the session's folder and follows `cd` through fd 3. If that folder is gone the run starts in the session's folder. `!` runs always start in the session's folder and never move the panel's. A session whose folder is gone gets a 409 for `run`.
- **Environment.** GhostShell takes a snapshot of the owner's interactive login shell (`$SHELL -ilc`, printing a marker and then `env -0`) from a minimal environment, with stdin closed and a 10 second limit, keeps it for 10 minutes and refreshes it in the background. It falls back to `-lc` and then to a minimal environment. GhostShell's own variables (`PORT`, `CAPCOM_STATE` and the rest) never reach a command. Each command also gets `PAGER=cat`, `GIT_PAGER=cat` and `TERM=xterm-256color`, and `PWD` set to its folder.
- **Stop.** Each run is `detached`, so its shell leads a process group. Stop sends SIGTERM to the group, SIGKILL after 2 seconds if it is still there, and closes the run 1 second after that if something outside the group still holds its pipes. A job started with `&` is in the group, so Stop reaches it. A run ends when all its pipes close, so a background job keeps the run open until Stop ends it. Once the shell has exited its pid is free for reuse, so a group found empty after that is never signalled again. When GhostShell exits, on SIGTERM or SIGINT or any other exit it can handle, it kills every run's group.
- **Output and limits.** A run keeps up to 1,000,000 characters of output, dropping the oldest and marking the run `truncated`. A summary carries the last 64 KB. Output events are merged to one per run every 50 ms, and a burst above 256 KB waiting to be sent pauses the child's pipes until the next flush. A page that stops reading its event stream is dropped once 8 MB waits for it, and its EventSource reconnects to a fresh snapshot, so a slow viewer cannot hold the output in GhostShell's memory. A session runs at most 8 commands at once and GhostShell 32 in all, over that is a 429. It keeps the last 100 runs of a session in memory, so a restart loses them. A command is at most 100,000 characters.
- **Routes.** `POST api/sessions/<id>/terminal/run`, `input`, `stop` and `clear`, and `GET .../terminal` for the runs. Events go to the page as `event: terminal` on the chat's existing stream.
- **Security.** Every terminal route sits behind the sign-in check, and a POST must also have an `Origin` header that matches the host and scheme (the global check lets a request with no `Origin` through, and these routes do not), a `Sec-Fetch-Site` of `same-origin` when the browser sends one, and a JSON content type, which a cross-site form cannot send without a preflight that GhostShell never answers. Any method but the one a route names is a 405 that runs nothing. A command comes from a click or Enter on the owner's page and nowhere else: no link, no query string and no transcript text starts one, and the Run button reads the command from the block's own text when it is clicked. The folder is the server's. Answers carry `x-content-type-options: nosniff` and `cross-origin-resource-policy: same-origin`. Sign-in remains the only gate, so [the password record](20261007-password-sign-in-and-local-bind.md) still describes who can run a command: anyone who signs in already could.
- **`!` hand-off.** GhostShell runs a `!` command itself. When it ends, for any reason, GhostShell builds the CLI's text from it, strips ANSI escapes from the output, escapes `&`, `<` and `>`, cuts each stream to 30,000 characters (the head and the tail around a line `[... N characters cut ...]`) and sends it as a message, so Claude answers it as the CLI does. If `respondToBashCommands` is `false`, GhostShell holds the text and puts it in front of the next message the owner sends. The run is marked `delivered: 'sent'` or `'held'`.
- **Transcript.** A user message of `<bash-input>` tags now reads as `bash` items (`command`, `stdout`, `stderr`), one per group, and a user item for any text after the tags. They are no longer notices (see the amendment to [the notices record](20261016-notices-for-cli-written-user-turns.md)). GhostShell's own hand-off, the CLI's and Desktop's records all read the same way.

### Consequences

- ✅ No dependency, no native module and no emulator, and the same behaviour in the panel as in Claude's Bash tool: `cd` persists, exported variables do not.
- ✅ Stop reaches background jobs, and a GhostShell that exits normally leaves nothing running.
- ✅ A `!` command works though the headless CLI has no shell mode, and reads in the transcript as it does from the CLI.
- ✅ A page on another site cannot start a command, and a request with no `Origin` or a form post cannot either.
- ❌ A full-screen program such as `vim`, `top` or `less`, or anything that waits for a terminal, does not work. A program that asks a question reads its answer from stdin, which the panel can send, but it sees a pipe and not a terminal.
- ❌ Output has no terminal driver, so a program that checks for a terminal prints without colour and without a progress bar, and the page draws only the escape codes it understands.
- ❌ A GhostShell that is killed with SIGKILL, or that crashes, runs no exit handler and leaves its commands running.
- ❌ Runs and a held `!` text live in memory, so a restart loses them.
- ❌ The sign-in is still the only gate. A signed-in page can run anything the owner can, by design.

## Pros and Cons of the Options

### Pipes, no PTY, GhostShell runs `!`

- ✅ Standard library only
- ✅ Matches how Claude's own tool runs a command, so what the panel shows is what Claude would see
- ✅ GhostShell decides what a `!` command is and how its result reaches Claude
- ❌ No full-screen programs, and no terminal-only behaviour

### A real PTY with an emulator in the page

`node-pty` is a native module that needs a compiler at install time. `script -q /dev/null` gives a PTY from the standard library, but the page then needs a terminal emulator (a library such as xterm.js to vendor and keep current), and resizing needs `stty` through the same pipe.

- ✅ `vim`, `top` and `less` work, and colour is on
- ❌ A native module or a large vendored emulator, against the no-build decision
- ❌ A terminal has no end to a command, so the exit code, the per-command blocks, Run on a code block and the `!` hand-off all need prompt parsing
- ❌ A shell that stays open keeps the owner's session state, which the Bash tool does not, so the panel and Claude would differ

### Send `!command` to the CLI

- ✅ Nothing to build
- ❌ Headless Claude takes it as a prompt and runs it with its own Bash tool, subject to permission prompts and a model's reading of it, so `!` would not run what was typed

## Links

- [Show the CLI's own user turns as compact notices](20261016-notices-for-cli-written-user-turns.md), which listed the `bash-*` tags before they became `bash` items
- [Protect Capcom with a password, a local-only bind and a private network](20261007-password-sign-in-and-local-bind.md)
- [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md), which sends the `!` hand-off
- [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode), for shell mode and `respondToBashCommands`
