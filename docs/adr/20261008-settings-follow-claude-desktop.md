# Start sessions with the settings Claude Desktop would use

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-08
- Tags: settings, permissions, model, effort, claude-desktop

## Context and Problem Statement

The 7 Oct build started each new chat in the most recently used folder and in Manual mode, with no model or effort of its own. Desktop had its own mode, model and effort for the same work. On 8 Oct the owner asked for new sessions to start in the home folder and to read their settings the way Desktop does.

Capcom needs to decide which settings a session gets and where it reads them.

## Decision Drivers

- A session should behave in Capcom as it does in Desktop.
- A session Desktop already knows should continue with what Desktop recorded for it.
- Capcom reads Desktop's files and does not write them.

## Considered Options

1. Follow Desktop's settings, in a fixed order of precedence
2. Keep a fixed Capcom default of Manual mode, as the 7 Oct build did

## Decision Outcome

Chosen option: "Follow Desktop's settings, in a fixed order of precedence", because the owner wants one set of defaults across both apps.

New sessions start in the home folder, with recent folders one tap away. The settings come from the first source that has a value (`desktopSettings` in `server.mjs`):

- **Mode:** the session's Desktop record, then Desktop's mode for that folder, then `permissions.defaultMode` in `~/.claude/settings.json`, then `defaultMode` in `config.json`.
- **Model:** the session's Desktop record, then `model` in `~/.claude/settings.json`.
- **Effort:** the session's Desktop record, then Desktop's effort level.

The owner can still change the mode, model and effort for one chat from the prompt box.

**Amended 2026-10-23.** The owner had the folder picker removed, so recent folders are no longer one tap away. A new session always starts in the home folder, and the page asks `api/defaults` for that folder's settings. The server's `api/folders` route stays, but nothing in the page calls it. See [Match Desktop's flow for new sessions, settings, stopping and tool calls](20261014-desktop-like-prompt-box-flow.md).

**Amended 2026-10-23.** `~/.claude/settings.json` above now means the `settings.json` in the config folder of the session's account. Desktop's mode for a folder and its effort still apply to every account, since Desktop has one login. See [Run each session on one Claude account](20261023-a-claude-account-per-kind-of-work.md).

### Consequences

- ✅ A new session opens with the settings Desktop would give it in that folder.
- ✅ A session Desktop knows keeps its recorded mode, model and effort.
- ❌ A new session can start in Bypass permissions when that is Desktop's mode for the folder.
- ❌ Desktop's folder modes and effort level live in its internal preferences. If Capcom cannot read them, it falls back to `settings.json` and then to `config.json`.

## Pros and Cons of the Options

### Follow Desktop

- ✅ One set of defaults for both apps
- ❌ Capcom inherits Desktop's permissive modes, and its reads can break with a Desktop update

### Fixed Manual default

- ✅ Asks before tool use until the owner changes the mode
- ❌ Differs from Desktop, so the owner has to change the mode in new chats

## Links

- [Read-only session list](20261006-read-only-session-list.md)
- [Desktop-like prompt box flow](20261014-desktop-like-prompt-box-flow.md), where the pickers live
- [Claude in Chrome guarded switch](20261007-claude-in-chrome-guarded-switch.md), whose Chrome switch a Bypass default left unavailable
