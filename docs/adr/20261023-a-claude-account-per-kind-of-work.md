# Run each session on one Claude account, picked by the kind of work

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-23
- Tags: accounts, sessions, config, routines, chips, groups, settings

## Context and Problem Statement

The owner is adding a second Claude Max subscription on his SSW email. SSW and Tina work goes on that account, and his own projects stay on his Gmail one. Every session GhostShell started ran on the one login in `~/.claude`, because `lib/runner.mjs` spawned the CLI with GhostShell's own environment.

The split has to follow the kind of work. Anthropic's Usage Policy bars using a second account to get around limits, so a session must never move to the other account because one hit its limit.

How does a session get its account, and how does it keep it?

## Decision Drivers

- No automatic failover, ever. No path may pick another account for a session that already has one.
- A work repo should land on the work account without the owner choosing it each time, and one chat can still choose.
- The owner logs in to each account himself. GhostShell never logs in and never handles a credential.
- Claude Desktop has one login and stays on `~/.claude`.
- No new dependencies and no build step ([Node's standard library and plain browser files](20261007-no-dependencies-no-build-step.md)).

## Considered Options

1. An account per session, set by folder with an override per chat, in its own Claude Code config folder, kept for the session's life
2. One login, switched by hand with `/login`
3. Switch to the other account when one reaches its limit
4. A second GhostShell for the second account

## Decision Outcome

Chosen option: "An account per session, set by folder with an override per chat, in its own Claude Code config folder, kept for the session's life", because it splits the work by folder, keeps one list, and leaves no path for a session to change account.

- **Separate logins.** The CLI keeps each login under its config folder, set by `CLAUDE_CONFIG_DIR`. On macOS it names the Keychain entry `Claude Code-credentials` when the variable is unset, and `Claude Code-credentials-` plus the first 8 hex digits of the SHA-256 of the folder's path when it is set (read from the CLI 2.1.309 binary, and confirmed with an empty throwaway folder, which reported `loggedIn: false` while the default reported `true`). Setting the variable to `~/.claude` would miss the default login, so the account in `~/.claude` runs with `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR` removed. Any other account runs with `CLAUDE_CONFIG_DIR` set to its folder's absolute path with no trailing slash. The CLI hashes the string it gets, so the owner logs in with that same string. With more than one account, every account also runs without `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`, since any of them would put every account on one credential.
- **Config.** `accounts` in `config.json` lists each account by `name` and `configDir`, with optional `folders`. `config.local.json` replaces the list. The first account takes any folder no account lists. The shipped list holds one account in `~/.claude`, and with one account the page shows nothing new. `projectsDir` is gone: each account's sessions are in `<configDir>/projects`. A `projectsDir` still in the config files stops the start unless it is the `projects` folder of a listed account, and the error says which account to list instead.
- **Folder default.** A new chat takes the account whose listed folder is the longest match for its folder, on whole path segments, compared by real path as the disk names it. A new chat can pick another account from the prompt box. The new session window starts every session in the home folder, so there the folder default is the home folder's, and the default does its work for routines and other starts that name a folder.
- **Index.** `indexTranscripts` reads each account's projects folder and notes the account on each transcript. A folder that does not exist yet is skipped.
- **A session's account.** Each spawn works it out in this order. The transcript decides first, because the CLI resumes a session only where its transcript is. A record that names another account than the transcript's is refused with a 409 that names both, and so is a transcript with no record while any account's projects folder cannot be read, since a copy may sit there. Otherwise the transcript's account wins, and a session with a transcript and no record, such as one from before accounts, is recorded on that account just before its first spawn. A session with no transcript yet has the account GhostShell recorded when it started it, in `accounts.json` in the state folder, which is written once per session and refuses a second, different account. A group's chat is recorded when GhostShell books its id, on the account its members' transcripts sit under. A session with neither a transcript nor a record is refused, because one GhostShell cannot see may still exist. The one exception is a group's chat booked before this version, which has no record. GhostShell treats it as new only after it finds no transcript of that id in any account's projects folder, in `~/.claude/projects`, or in the projects folder of a `CLAUDE_CONFIG_DIR` the server was started with, which the session's environment drops. That chat gets its default and a record just before its first spawn. GhostShell also refuses, with a 409 and nothing spawned, a session whose account config no longer lists, an id with a transcript under two accounts, a session with no transcript or record while an account's projects folder cannot be read, and a chat already running on an account other than the one worked out. A projects folder that cannot be read keeps the sessions the list last read from it.
- **What carries the account on.** A chip starts on the account of the session that offered it, whatever folder the chip names. A group's chat takes the account all its members' transcripts sit under, or the first account when they differ, at the moment its id is booked and then keeps it, and the sessions it starts take its account. A routine runs on its `account` in `routines.json` when it names one, or on its folder's default when it fires. Each run then keeps its account like any session.
- **Starting.** A start, or a probe for the `/` menu or the model menu, on an account whose config folder does not exist is refused with a 409 that gives the login command. GhostShell never creates the folder. It also refuses, with a 409 that says to list the folder once, an account whose folder is the same folder as `~/.claude` or as another listed account's, compared by device and inode so a link or a different case counts. The default account is told by its path, so a second spelling of `~/.claude` would run with `CLAUDE_CONFIG_DIR` set, on a different Keychain login from Desktop's. The paths themselves are never swapped for their real paths, as the CLI hashes the string it is given.
- **Settings.** A session reads the model, default mode and `respondToBashCommands` from its own account's `settings.json`. Desktop's mode for a folder and its effort still apply to every account. The `/` menu and the model menu probe the CLI on the chat's account, and the probe's cache is kept per account.
- **Showing it.** With more than one account configured, the chat's header names its account, and the new-session prompt box has an account menu that shows the home folder's account until the owner picks one.
- **Desktop.** The hand-off to Desktop works out the session's account as each spawn does, and skips the session when that is refused or is any account other than `~/.claude`.

### Consequences

- ✅ A chat in a work folder runs on the work account with no choice made, and a chat can pick another before its first message.
- ✅ A session cannot change account. The CLI resumes only where the transcript is, and GhostShell refuses rather than picking another account.
- ✅ GhostShell never logs in, never creates a config folder and never reads a credential.
- ❌ A new config folder starts empty. With `CLAUDE_CONFIG_DIR` set, the CLI reads `CLAUDE.md`, skills, agents, hooks, plugins, `settings.json` and `.claude.json` (user MCP servers) from that folder alone, so the second account has none of the owner's until he links or copies them.
- ❌ The owner's usage scripts (`~/.claude/skills/model-usage` and `~/bin/claude-usage-budget.py`) read only `~/.claude/projects` and miss the second account.
- ❌ A chip offered in a personal session and pointed at a work folder still runs on the personal account.
- ❌ Taking an account out of config takes its sessions out of the list, and GhostShell refuses to run any it is asked for. Nothing moves them.
- ❌ A `!` command runs in the owner's login shell with no account set, so `! claude` typed in a work session runs on the default login.
- ❌ A login made with a trailing slash on the folder's path, or any other spelling of it, is a different Keychain entry, and GhostShell's sessions on that account fail as not logged in.
- ❌ Claude in Chrome on the second account was not tried.

## Pros and Cons of the Options

### An account per session, kept for its life

- ✅ Work splits by folder, in one list, with a picker for the exceptions
- ❌ The second config folder needs its own setup

### One login, switched by hand

- ✅ Nothing to build
- ❌ A switch moves every running session at once, including ones mid-turn

### Switch when one reaches its limit

- ❌ Barred by Anthropic's Usage Policy. Rejected outright.

### A second GhostShell

- ✅ Each account fully apart
- ❌ Two servers, two ports and two lists, and groups and pins split between them

## Links

- [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md), amended 2026-10-23 for the account's environment
- [List sessions from transcripts and Desktop's records, read only](20261006-read-only-session-list.md), amended 2026-10-23 for each account's projects folder
- [Start sessions with the settings Claude Desktop would use](20261008-settings-follow-claude-desktop.md), amended 2026-10-23 for each account's settings
- [Capcom runs routines itself](20261015-capcom-runs-routines-itself.md)
- [Give each group a session of its own](20261023-a-session-for-each-group.md)
