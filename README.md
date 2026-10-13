# Capcom

A browser chat client for every Claude Code session on this Mac: the ones started in Claude Desktop,
the routine runs, and the ones started in a terminal. The list follows Desktop's own groups and pins.
It listens on http://localhost:4310.

## How it works

- **Sessions** come from two places, both read only. Claude Code saves every session as a JSON lines
  file under `~/.claude/projects`. Claude Desktop keeps its titles, groups and pins under
  `~/Library/Application Support/Claude`. Those Desktop files are internal and undocumented, so when a
  Desktop update moves them the list carries on without groups and says so at the top.
- **Chatting** runs the real CLI headless, one process per open chat:
  `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`,
  with `--resume <id>` for an existing session. It uses your normal login, skills, hooks and MCP
  servers. A process stops after 30 idle minutes and starts again on the next message.
- **Approvals** arrive from the CLI as permission requests and show as cards above the reply box.
  Closing the page leaves the work running, and a waiting approval is still there when you come back.
  "Always allow" applies the rule Claude suggests, which usually lands in the folder's
  `.claude/settings.local.json`.
- **Reading** a long session loads only its last 2 MB, with "Load earlier" for the rest. Sessions
  running somewhere else, in Desktop or a terminal, update as their file grows.

## Tools

Capcom sessions get the standard Claude Code tools, the claude.ai connectors and the MCP servers in
`~/.claude.json`. Desktop's own built-in tools are served from inside the Desktop app, so Capcom
cannot borrow them. It adds its own instead, the same way: a server called `capcom`, declared in the
initialize request and answered over the session's stdio (`lib/tools.mjs`).

- **Chips** (`spawn_task`, `dismiss_task`) show as cards with Start and Dismiss. Start opens a new
  Capcom session with the chip's prompt, in the folder printed on the card. Chips that Desktop
  sessions created can be started too.
- **Chapters** (`mark_chapter`) show as titled dividers.
- **Widgets** (`show_widget`) draw in an iframe sandboxed to `allow-scripts`, with a content policy
  that blocks network requests, so model-written HTML cannot reach Capcom or its cookie.
- **Questions** (`AskUserQuestion`) show as option buttons, plus a box for your own answer.
- **Claude in Chrome** is off until switched on per chat. It starts the CLI with `--chrome` and an
  ask rule for every Chrome tool, so each action reaches an approval card, even ones your settings
  already allow. Chrome cannot be on in Bypass or Auto, and its cards have no Always allow.

Still Desktop only: the in-app browser, the iOS Simulator panel, Desktop's window and sidebar,
computer use (not available to the CLI in `-p` mode) and routines.

Things to know:

- Sessions started here are not in Desktop's sidebar, because Desktop only lists sessions it started.
  Capcom shows them under "Started here".
- Opening a session that is also open in Desktop continues the same session. If both are used at
  once, the two can drift apart.
- Settings follow Claude Desktop. A session Desktop knows continues with the permission mode, model
  and effort Desktop recorded for it. Any other session, and every new one, gets Desktop's mode for
  that folder (falling back to `permissions.defaultMode` in `~/.claude/settings.json`), Desktop's
  effort level, and the model from `~/.claude/settings.json`. New sessions start in the home folder.
  The mode can still be changed per chat.

## Run it

```bash
npm run set-password
node server.mjs
```

There are no dependencies (Node 20 or later). The password is kept only as a scrypt hash in
`~/.config/capcom/auth.json`, and setting a new one signs every browser out. Until one is set, Capcom
refuses every request.

## Configuration

`config.json` holds the defaults: the port, the `claude` command, the folders Capcom reads and the
timeouts. To change a value on one machine, put it in `config.local.json` in the repo root. That file is
optional and git-ignored, and its values replace the ones in `config.json`.

```json
{ "station": "studio", "claude": "/usr/local/bin/claude" }
```

- `station` is the machine name shown in the header of the session list. It defaults to the short hostname.
- `claude` is the CLI to run. It defaults to `claude`, found on `PATH`.

Three environment variables win over both files. `PORT` sets the port, `CAPCOM_CLAUDE` sets the CLI,
and `CAPCOM_STATE` points a test instance at its own login and registry.

## Always on

On macOS, a launchd agent starts Capcom at login and restarts it if it stops.

```bash
npm run install-agent
```

This fills in `launchd/capcom.plist.template` with your Node binary, this folder, your home folder and
the folder that holds `claude`. It writes `~/Library/LaunchAgents/local.capcom.plist`, creates
`~/Library/Logs/capcom/` for the logs, and prints two `launchctl` commands. You run those yourself:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.capcom.plist
launchctl kickstart -k gui/$(id -u)/local.capcom
```

Use `npm run install-agent -- --label com.example.capcom` for a different label. Run the installer
again after you move the folder or change Node versions, because the plist stores both paths.

## Remote access

Capcom binds to 127.0.0.1 only, so no other device can reach it directly. To use it from a phone or
another computer, put a reverse proxy or a private network you trust in front of it.

It works when mounted under a sub-path such as `/chat`. Every URL in the page is relative, and the
page adds its own trailing slash. The proxy must strip the prefix before the request reaches Capcom.

The password is the only thing between that address and a shell on this machine. Anyone who signs in
can run commands as you. Capcom locks sign-in for 15 minutes after ten wrong guesses. Pick a long
password and keep the address private.

## License

MIT, see [LICENSE](LICENSE).
