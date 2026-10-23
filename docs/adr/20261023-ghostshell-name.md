# Call the app GhostShell, and keep capcom for every internal name

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-23
- Tags: naming, branding, compatibility, passkeys, mcp, macos

## Context and Problem Statement

The app has been called Capcom since it began, and the name is in many places: the page, the repo, the launchd service, the folders that hold its settings, the `capcom` MCP server whose tools running sessions call, and the app that macOS holds permission answers for. Eli wants the name people see to be GhostShell, to go with the [Ghost look](20261022-ghost-look.md), which is inspired by the Ghost in Destiny.

Which names should change to GhostShell, and which should stay capcom, so that the new name shows wherever a person reads it and an install that is running keeps working?

## Decision Drivers

- A person reads GhostShell wherever the app shows its name: in the page, the sign-in and setup pages, an installed app's name, a message, and the text a Claude session is given.
- A running install keeps its password, passkeys, layout, routines and marks, with nothing to migrate.
- Sessions that are running, and saved transcripts that call `mcp__capcom__` tools, keep working.
- The launchd service and the answers macOS holds stay as they are, so nothing is installed or granted again.
- A passkey that is already made keeps signing in.

## Considered Options

1. Rename what people and Claude read, and keep every internal name capcom
2. Rename everything to ghostshell, with a migration for what is stored
3. Keep the name Capcom

## Decision Outcome

Chosen option: "Rename what people and Claude read, and keep every internal name capcom", because it shows the new name everywhere it is read and moves nothing that is stored, running or granted.

- **What changes.** Every string a person or a Claude session reads. That is the titles and headings of `public/index.html`, `public/login.html` and `public/setup.html`, the manifest's `name` and `short_name`, the brand heading, tab titles, notes and help text in `public/`, the MCP tool descriptions and results, `lib/widget-guide.md`, the reasons sent to Claude when a request is denied, the passkey display names and limit message in `lib/passkeys.mjs`, the password prompt of `npm run set-password`, and the README.
- **What stays capcom.**
  - The `capcom` MCP server and the `mcp__capcom__` tool names. The widget guide says once that GhostShell's tools come from the `capcom` MCP server, so a session can tie the name to the tools it has.
  - The `CAPCOM_STATE`, `CAPCOM_CLAUDE` and `CAPCOM_BROWSER` environment variables.
  - The `capcom.` keys in the browser's storage and the `capcom` cookie.
  - The `~/.config/capcom` state folder and the files in it, which hold the password, the passkeys, the layout, the routines and the marks.
  - The launchd label (`local.capcom` unless `--label` says otherwise), `launchd/capcom.plist.template` and the `~/Library/Logs/capcom` folder.
  - The `macos/` sources, `bin/build-app.mjs` and the `Capcom.app` they build.
  - File and folder names, URLs and routes, the repo and package name, and the server's log lines. The test harness waits for the start-up line.
  - The comments in the code, and the earlier decision records, which describe the app under the name it had when they were written.
- **Why the service and the app keep their names.** Moving the label means a new plist and a new `launchctl bootstrap`, with the agent stopped in between. `Capcom.app` is the root macOS asks about, and macOS ties its answers to that exact build, as the [macOS app decision](20261016-capcom-app-for-macos-permissions.md) sets out. A rename that rebuilt it would need the app opened and answered again. So the app keeps its name, and macOS still lists it as Capcom.
- **Passkeys.** The relying party ID comes from `rpIdFor(origin)`, the host name of the address, and `lib/webauthn.mjs` checks the hash of that ID when it verifies a passkey. It never reads the name. Only `rp.name` and `user.displayName`, which a passkey manager can show, change. A passkey made before this change was stored with Capcom as its display name, so a manager may go on showing that. It signs in as before, and a new passkey carries GhostShell. A test in `test/passkeys.test.mjs` holds the name and the ID side by side.
- **Stored settings.** Nothing moves. The state folder and the storage keys are looked up by name, so renaming either would make an install look new: no password, no layout, no pins, no routines, and every folded section open again.

### Consequences

- ✅ A person reads GhostShell in the page, the sign-in and setup pages, a home-screen app's name and the messages.
- ✅ The password, passkeys, layout, routines, launchd service, macOS answers and tool names behave as before, with no migration.
- ✅ The change is strings, so it is small to review and to undo.
- ❌ There are two names to know. The README says near its top that the repo, the service and the stored settings still use capcom.
- ❌ macOS still shows the app as Capcom, in its questions and in System Settings.
- ❌ A passkey made before the change keeps Capcom as its display name.
- ❌ An app installed from the page earlier may keep the name it was installed with until it is installed again.

## Pros and Cons of the Options

### Rename what people and Claude read, and keep every internal name capcom

- ✅ Nothing stored, running or granted has to move.
- ✅ A running chat keeps calling the tools it already has.
- ❌ Code, config and the page say different names, and a reader has to learn which is which.

### Rename everything to ghostshell, with a migration for what is stored

- ✅ One name everywhere.
- ❌ A migration for the state folder, the storage keys, the cookie, the launchd label, the log folder and the macOS answers, each of which can fail on a machine that is running.
- ❌ A new MCP server name drops the `mcp__capcom__` tools from sessions that are running, and from a resumed session whose transcript calls them.

### Keep the name Capcom

- ✅ Nothing to change.
- ❌ The name has no link to the Ghost look, which Eli wants the name to follow.

## Credits

The name is inspired by the Ghost in Destiny. GhostShell has no connection with Bungie or Destiny and uses none of their assets.

## Links

- Follows [Make Ghost the look on every device](20261022-ghost-look.md)
- Keeps the server name from [Serve Desktop-style tools from Capcom's own MCP server](20261007-own-mcp-server-for-desktop-style-tools.md)
- Keeps the app from [Run the server under a small Capcom app](20261016-capcom-app-for-macos-permissions.md)
- Keeps the relying party from [Sign in with passkeys that Capcom checks itself](20261016-passkeys-on-node-crypto.md)
