# Run the server under a small Capcom app, so macOS permissions belong to Capcom

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-16
- Tags: macos, permissions, launchd, routines

## Context and Problem Statement

macOS asks before a process reads the calendar, opens the Desktop, Documents or Downloads folder, or controls another app. It asks about the app responsible for the process, which is the app at the root of its process tree, and a child gets that app's answers. Under Claude Desktop, each session ran under Desktop's own copy of the CLI, a signed app that held the owner's answers. Under Capcom's launchd agent the root is node, a bare binary that had no answers and none of the reason strings macOS shows when it asks. On 16 Oct 2026 the first routine Capcom ran that reads the calendar found no access, while the same check passed in Desktop. How can sessions under Capcom get the permissions they need, asked once and kept?

## Decision Drivers

- Routines run unattended, so a permission has to be granted before the run that needs it.
- Capcom has to keep working without Desktop, as the [only-client decision](20261015-capcom-is-the-only-client.md) set out.
- The browser page stays the product, and Capcom has no npm dependencies.
- The answers should show in System Settings under a name the owner recognises.

## Considered Options

1. Run sessions through Desktop's copy of the CLI, to borrow Desktop's answers
2. A small Capcom app that runs the server as its child
3. A standalone Capcom app with its own window

## Decision Outcome

Chosen option: "A small Capcom app that runs the server as its child", because it gives the server and every session under it one identity that macOS can ask about, in about 60 lines of Swift and with no change to the server.

- `macos/capcom.swift` is the app's executable. Given a command, it starts it with `posix_spawn` and stays its parent. It passes on SIGTERM, SIGINT and SIGHUP and exits with the child's status, so launchd's `KeepAlive` still restarts the server. It must not `exec`, which would make node the root again.
- Given no command, as when the app is opened, it asks for full calendar access, the Desktop, Documents and Downloads folders, and control of Calendar and Google Chrome when they are running. It never opens an app just to ask about it.
- `macos/Info.plist` carries the reason strings for the calendar, reminders, Apple Events and the three folders, so that a session's own request later gets a question that names Capcom. `LSUIElement` keeps the app out of the Dock.
- `npm run build-app` compiles it with `swiftc`, adds the icon, signs it ad hoc and puts it in `~/Library/Application Support/Capcom/Capcom.app`. `npm run install-agent` runs the server through it when it is there.
- On 16 Oct 2026, a launchd job that ran the app, then node, then zsh, then a calendar check got full access (3), and listed Downloads. The same check without the app got not determined (0). That covers the calendar and one folder, not each app a session may control.

### Consequences

- ✅ One set of answers, under Capcom in System Settings, for the server, every session and every routine.
- ✅ A new kind of access gets macOS's usual question, naming Capcom, the first time a session needs it.
- ✅ No change to the server, and nothing taken from Desktop.
- ❌ The signature is ad hoc, so macOS ties the answers to that exact build. A rebuild that changes the binary needs the app opened again and the agent restarted.
- ❌ Building needs Swift, from the Xcode command line tools.
- ❌ Every session gets every answer the owner gave Capcom, as every session under Desktop got Desktop's.
- ❌ A question that comes up during an unattended run has no one to answer it, so a routine that needs a new kind of access should first be run by hand.

## Pros and Cons of the Options

### Run sessions through Desktop's copy of the CLI

Desktop starts its own copy of the CLI, a signed app in its support folder, through a helper that makes it the root of its own tree. Capcom could start sessions the same way.

- ✅ Nothing to build, and Desktop's answers apply at once
- ❌ The helper and the folder are Desktop internals, which can move with any Desktop update
- ❌ It ties Capcom back to Desktop

### A small Capcom app that runs the server as its child

- ✅ About 60 lines, and the server, the page and the launchd agent stay as they are
- ❌ An ad-hoc signature, so a rebuild can lose the answers

### A standalone Capcom app with its own window

A Mac app that shows the page in its own window and runs the server.

- ✅ A Dock icon and a window of its own
- ❌ Far more code for the same permissions, and a second front end beside the page, which phones still need
- ❌ Installing the page as a web app already gives it its own window and Dock icon

## Links

- [Capcom runs routines itself](20261015-capcom-runs-routines-itself.md), whose first calendar routine found no access
- [Capcom is the only client](20261015-capcom-is-the-only-client.md)
