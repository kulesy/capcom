# Always on

How to keep GhostShell running on macOS with a launchd agent and Capcom.app.

On macOS, a launchd agent starts GhostShell at login and restarts it if it stops. It runs the server through Capcom.app, a small app this folder builds, so that macOS asks about permissions for the app. The app keeps the name Capcom, so macOS lists it as Capcom.

```bash
npm run build-app
open ~/Library/Application\ Support/Capcom/Capcom.app
npm run install-agent
```

## Why the app is there

macOS asks before a process reads the calendar, opens the Desktop, Documents or Downloads folder, or controls another app, and it asks about the app at the root of the process tree. Under launchd alone that root is node, which has no permissions and none of the reason strings macOS shows when it asks, so a session's calendar read fails. The app's executable runs the server as its child and stays its parent, so the server and every session under it count as Capcom.

## Build the app

`npm run build-app` builds the app with Swift, from the Xcode command line tools, into `~/Library/Application Support/Capcom/`. Opening it asks for full calendar access, the three folders, and control of Calendar and Google Chrome if they are open. Click Allow on each.

The answers show under Capcom in System Settings, in Privacy & Security, and a session that later needs something else gets macOS's usual question, naming Capcom.

Use `npm run build-app -- --id com.example.capcom` for a bundle id of your own. The app's signature is ad hoc, so macOS ties the answers to that exact build. After a rebuild, open the app again and restart the agent.

## Install the agent

`npm run install-agent` fills in `launchd/capcom.plist.template` with the app (when it is built), your Node binary, this folder, your home folder and the folder that holds `claude`. It writes `~/Library/LaunchAgents/local.capcom.plist`, creates `~/Library/Logs/capcom/` for the logs, and prints two `launchctl` commands. You run those yourself:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.capcom.plist
launchctl kickstart -k gui/$(id -u)/local.capcom
```

Use `npm run install-agent -- --label com.example.capcom` for a different label. Run the installer again after you move the folder or change Node versions, because the plist stores both paths.
