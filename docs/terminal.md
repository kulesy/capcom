# Terminal

The terminal panel beside the chat: where commands start, what environment they get, how output and limits work, and who can run one.

A terminal panel opens beside the chat, in the session's folder. The panel has no PTY. Each command is its own process on pipes, as Claude's Bash tool runs one, so `cd` carries from one command to the next and an exported variable does not. A full-screen program such as `vim`, `top` or `less` does not work. [The decision record](adr/20261023-terminal-without-a-pty.md) says why GhostShell has no PTY.

## Where it starts

A command typed in the panel, or run from a code block, starts in the panel's folder. That is the session's folder to begin with, and it follows `cd`. If the folder has gone, the command starts in the session's folder. A `!` command always starts in the session's folder and does not move the panel. A session whose folder is gone runs nothing.

## Environment

A command gets the environment of your interactive login shell, which GhostShell reads once and keeps for 10 minutes, so `PATH`, version managers and your own variables are there. GhostShell's own settings (`PORT`, `CAPCOM_STATE`) are not. `PAGER` and `GIT_PAGER` are `cat`.

## Output and input

A command's output shows as it arrives. Stderr is tinted. A command can be sent input while it runs, and Ctrl+C in the panel stops it. Stop ends the command and every job it started.

Text typed in the panel's input goes to the command it showed when you started typing, so a command that starts meanwhile takes nothing, and text for a command that has ended is kept and not run.

## Limits

A run keeps 1,000,000 characters and drops the oldest, and the panel keeps the last 100 runs of a session. A session runs 8 commands at once and GhostShell 32.

## Code blocks

Every code block has Copy. A block of shell commands in one of Claude's replies also has Run, which runs the block's text in the panel when you click it, and wraps its long lines so the whole command is in view. In a console block the commands are tinted, wrapped lines included, so you can tell output from commands.

A block holding a character you cannot see, such as a zero-width character, a soft hyphen, a line separator or a space that is not a plain one, cannot be run. A file open in the panel has Copy only. Nothing runs without a click.

## Commands typed in the prompt box

Text that starts with `!` runs as a command instead of being sent. GhostShell runs it, because the headless CLI GhostShell drives takes `!echo hi` as a prompt and has no shell mode.

When the command ends, GhostShell sends Claude the command and its output in the CLI's own form (colour codes removed, each of output and errors cut to 30,000 characters in the middle), and Claude answers as it does in the CLI. With `respondToBashCommands` set to `false` in `~/.claude/settings.json`, GhostShell holds the result and sends it with your next message.

The transcript shows the command as a block with its output, whether GhostShell, the CLI or Desktop ran it. A `!` command you have not run stays behind when you change chat, where a message you have not sent goes with you.

## Ending

GhostShell stops every command when it exits or restarts, and keeps nothing across a restart. A GhostShell that is killed outright (SIGKILL) cannot, and leaves its commands running.

## Who can run one

Only a signed-in page can. The routes that start, feed or stop a command (`api/sessions/<id>/terminal/...`) take POST only, with a JSON body, from a request whose `Origin` is present and matches GhostShell's own address. A form or script on another site cannot start one, whether or not the sign-in cookie comes with it, and a stray request that carried the cookie still runs nothing.

The folder is always the server's own. See [remote access](remote-access.md#security).
