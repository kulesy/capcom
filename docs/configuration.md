# Configuration

The settings in `config.json` and `config.local.json`, and the four environment variables that override them.

## Files

`config.json` holds the defaults: the port, the `claude` command, the folders GhostShell reads and the timeouts. To change a value on one machine, put it in `config.local.json` in the repo root. That file is optional and git-ignored, and its values replace the ones in `config.json`.

```json
{ "claude": "/usr/local/bin/claude", "chrome": false }
```

## Settings

### `station`

`station` is the machine's name, sent with the session index. The page does not show it. It defaults to the short hostname.

### `claude`

`claude` is the CLI to run. It defaults to `claude`, found on `PATH`.

### `accounts`

`accounts` lists the Claude accounts a session can run on, `[{ "name": "Default", "configDir": "~/.claude" }]` by default. Each has a `name`, a `configDir` that starts with `/` or `~/`, and optionally `folders`, a list of folders whose new sessions start on that account. See [accounts](#accounts).

### `chrome`

`chrome` is `true` by default. Set it to `false` to start every session without Claude in Chrome (see [Claude in Chrome](tools.md#claude-in-chrome)).

### `desktopHandoff`

`desktopHandoff` is `false` by default. Set it to `true` to hand new sessions to Claude Desktop (see [sessions started here](how-it-works.md#sessions-started-here)). Turning it on also hands over, the next time GhostShell starts, every session started here that Desktop does not have yet.

### `passkeyOrigins`

`passkeyOrigins` is a list of the https addresses that may use passkeys, empty by default. Write each entry as the browser shows the address, such as `https://capcom.example.com` or `https://capcom.example.com:8443`, with no path.

`http://localhost:<port>` needs no entry and works for a browser that opens it directly. GhostShell ignores an entry that is not https or that is an IP address, and says so on stderr. Keep your real addresses in `config.local.json`. [Remote access](remote-access.md#passkeys-over-https) has an example.

## Environment variables

Four environment variables win over both files:

- `PORT` sets the port.
- `CAPCOM_CLAUDE` sets the CLI.
- `CAPCOM_ACCOUNTS` sets the accounts, as the same JSON list.
- `CAPCOM_STATE` points a test instance at its own login, registry and routines.

Two instances that share a state folder both fire its routines, so always give a test instance its own.

## Accounts

Each account is a Claude Code config folder with its own login. A session runs on one account for its whole life, and nothing moves it to another, including when one account reaches its limit. [The decision record](adr/20261023-a-claude-account-per-kind-of-work.md) has the reasons.

```json
{ "accounts": [{ "name": "Default", "configDir": "~/.claude" }, { "name": "SSW", "configDir": "~/.claude-ssw", "folders": ["~/ssw"] }] }
```

### Adding an account

List the account in `config.local.json`, then log in once from a terminal with `CLAUDE_CONFIG_DIR=/Users/you/.claude-ssw claude` and `/login`. Use the folder's absolute path with no trailing slash, because the CLI keeps a separate login for each spelling of the path. GhostShell never logs in for you, and it refuses to start a session or ask for the `/` menu on an account whose folder does not exist yet.

A new config folder starts empty. The CLI reads `CLAUDE.md`, skills, agents, hooks, plugins, `settings.json` and `.claude.json` (your user MCP servers) from the account's own folder, so copy or link the ones you want there.

A `projectsDir` left in `config.json` or `config.local.json` from before accounts stops GhostShell starting, unless it is the `projects` folder of a listed account. Remove it and list that folder's account in `accounts` instead.

### Which account a new session gets

A new session takes the account named in the request. Otherwise it takes the account with the longest matching folder in `folders`, and otherwise the first account. A session from the new session window starts in your home folder, so with more than one account you pick its account from the Account menu in its prompt box (see [the chat page](chat.md#model-effort-and-fast-mode)). `folders` decides for a routine, which starts in its own folder.

- A chip starts on the account of the session that made it, whatever folder its card names.
- A group's chat starts on the account its members are on when you first open it, or on the first account when they differ, and keeps that one. The sessions it starts take its account.
- A routine takes an `account` name from its entry in `routines.json`, and otherwise its folder decides.

### A session stays on its account

A session resumes where its transcript is. `accounts.json` in the state folder records which account each session started on, once, so a session with no transcript yet cannot start again somewhere else. GhostShell records a group's chat when it books it, and a session from before accounts the first time it runs it.

GhostShell refuses a session, and starts nothing, when it cannot place it:

- Its transcript is under two accounts.
- Its record names a different account from its transcript.
- Its account is no longer in `accounts`.
- It has no record and an account's `projects` folder cannot be read, since a copy of it may sit there.
- `accounts.json` cannot be read.

### The default account

The default account is the one in `~/.claude`. It runs with `CLAUDE_CONFIG_DIR` unset, because on macOS the CLI keeps that login in a different Keychain entry from the one it uses when the variable is set. Any other account runs with `CLAUDE_CONFIG_DIR` set to the absolute path of its `configDir`. Only the default account's sessions are [handed to Claude Desktop](how-it-works.md#sessions-started-here).

List each folder once. A link to `~/.claude`, or `~/.Claude` on a disk that ignores case, is the same folder as `~/.claude` but would run with `CLAUDE_CONFIG_DIR` set, on a different login from Desktop's. GhostShell compares folders on disk and refuses an account whose folder is `~/.claude` under another name, or is another listed account's folder.

### Credentials in the environment

With more than one account, every session runs without `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`, so a key exported in the shell that started GhostShell cannot put every account on one credential. A `!` command runs in your login shell with no account set, so `! claude` runs on the default login.
