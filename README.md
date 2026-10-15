# Capcom

A browser chat client for every Claude Code session on this Mac: the ones started in Claude Desktop,
the routine runs, and the ones started in a terminal. The list uses Capcom's own groups and pins, which start
as a copy of Desktop's. It listens on http://localhost:4310.

The reasons behind the design are in [docs/adr](docs/adr/README.md), one record per decision.

## How it works

- **Sessions** come from two places, both read only. Claude Code saves every session as a JSON lines
  file under `~/.claude/projects`. Claude Desktop keeps its titles, groups and pins under
  `~/Library/Application Support/Claude`. Capcom reads the titles and records each time, and the groups and
  pins once (see "Groups and pins"). Those Desktop files are internal and undocumented, so when a Desktop
  update moves them the list carries on from the session files alone and says so at the top.
- **Chatting** runs the real CLI headless, one process per open chat:
  `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`,
  with `--resume <id>` for an existing session. It uses your normal login, skills, hooks and MCP
  servers. A process stops after 30 idle minutes and starts again on the next message.
- **Approvals** arrive from the CLI as permission requests and show as cards above the reply box.
  Closing the page leaves the work running, and a waiting approval is still there when you come back.
  "Always allow" applies the rule Claude suggests, which usually lands in the folder's
  `.claude/settings.local.json`.
- **The prompt box** follows Desktop's. The permission mode (Manual, Accept edits, Plan, Auto, Bypass
  permissions), the model and the effort sit under the text. A model or effort change applies from
  Claude's next request, even mid-turn, and is remembered
  for that session in `picks.json` in Capcom's state folder, so it survives the idle stop and a restart.
- **Images.** Paste a screenshot into the prompt box, or drop image files onto the page, and it attaches as a
  thumbnail above the text, with a cross to take it off again. PNG, JPEG, GIF and WebP, up to 10 to a message,
  and a message may be images alone. Before it sends, the page scales anything over 2000 pixels on its long
  edge down and keeps each image under 3.75 MB, so that even as base64 it is under the 5 MB the API takes. It
  keeps PNG and falls back to JPEG only when a PNG is too big. The CLI then re-encodes any image over about
  0.5 MB itself, so a large screenshot reaches Claude re-encoded whatever the page sent. A paste that also
  holds several lines of text, as a spreadsheet copy does, pastes the text instead. A message sent while
  Claude works can carry images too, and the CLI holds it until the running tool finishes, as it does a text
  message. Every message in a transcript that carries images shows them as thumbnails that open full size on
  click, including messages sent from Desktop or a terminal.
- **Stop and redirect.** While Claude works and the box is empty, Send turns into Stop, and Esc stops
  too. A message sent while Claude works redirects it without stopping it: Claude reads the message once
  the running tool finishes and adjusts before its next step.
- **New sessions** start with Ctrl+N: an empty chat with a folder picker above the prompt box (the home
  folder, or a recent one). The first message starts the session in that folder.
- **The list** shows routines first, then pinned sessions, your groups, the sessions started here, ungrouped
  ones and terminal sessions. Every section lists its newest session first.
- **Groups and pins** are Capcom's own, kept in `layout.json` in its state folder. The first time Capcom
  starts without that file it copies Desktop's groups, their sessions and its pins in, once, and records
  when. After that it ignores Desktop's groups and pins. If it cannot read Desktop's files at that start,
  the layout starts empty and it tries again on each later start. Drag a row onto a group to move it there,
  onto Pinned to pin it, or onto Ungrouped, Started here or Terminal and other to take it out of its group.
  Routines is not a place to drop. A mouse drags after a few pixels of movement, a finger after a long
  press, and Esc cancels. There is no screen yet to create, rename, delete or reorder groups. Edit
  `layout.json` for those: Capcom reads it on every refresh, and shows the error at the top of the list if
  it cannot.
- **Finding a session.** Ctrl+K (or Cmd+K), or the search icon at the top of the session list, opens a
  search laid out like Desktop's. Chips pick what to look through: All, Sessions, Routines and Archived,
  and the left and right arrows move between them from either end of the text. With nothing typed, All
  shows recent sessions and a New session action. Typing filters by title, folder, branch or routine.
  The up and down arrows and Enter open a result, and Esc closes it. Archived sessions stay out of the
  list and turn up here, under their own chip, most recently archived first, and after the live
  matches in any search.
- **Keyboard in the list.** The up and down arrows move through the section headers and sessions, Home
  and End jump to either end, and left and right fold a section or a routine's runs. Enter opens the
  focused session. With no chat open, up or down steps into the list.
- **Routines** open their latest run with a click. The arrow at the end of a routine's row folds its
  earlier runs out underneath. Runs that Capcom starts itself (see "Routines" below) list there with the
  routine's title, beside Desktop's runs of the same routine.
- **Tool calls** are collapsed into one row for each run between Claude's messages, such as "Read 3
  files, ran 2 commands, edited 1 file" with a `+12 -1` count of changed lines. Tap a row to see every
  call.
- **Reading** a long session loads only its last 2 MB, with "Load earlier" for the rest. Sessions
  running somewhere else, in Desktop or a terminal, update as their file grows. The images in a message are
  not part of what the page loads. Each message names them, and the page fetches each one from
  `api/sessions/<id>/images/<ref>` when it draws the thumbnail.

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
- **Claude in Chrome** is on in every session and every permission mode, as it is in Desktop. The
  `chrome` setting turns it off for all of Capcom (see Configuration). Capcom starts the CLI
  with `--chrome` and an ask rule for every Chrome tool, so Chrome asks before each action, even ones
  your settings already allow, and the question shows as an approval card. Bypass permissions is the
  exception: Capcom allows Chrome there without a card, as Desktop does, and a switch to a stricter mode
  asks again at once. Chrome cards have no Always allow.

Still Desktop only: the in-app browser, the iOS Simulator panel, Desktop's window and sidebar, and
computer use (not available to the CLI in `-p` mode).

Things to know:

- Sessions started here stay in Capcom, under "Started here", and do not appear in Desktop's sidebar.
  With `desktopHandoff` set to `true` (see Configuration), Capcom hands each new session to Desktop
  when its first reply finishes. It stops its own process for the session, adds a title to the
  transcript, and opens Desktop's hand-off link (`claude://resume?session=<id>`). Desktop adds the
  session to its sidebar and switches its window to it. The next message sent from Capcom starts the
  process again.
- Opening a session that is also open in Desktop continues the same session. If both are used at
  once, the two can drift apart.
- Settings follow Claude Desktop. A session Desktop knows continues with the permission mode, model
  and effort Desktop recorded for it. Any other session, and every new one, gets Desktop's mode for
  that folder (falling back to `permissions.defaultMode` in `~/.claude/settings.json`), Desktop's
  effort level, and the model from `~/.claude/settings.json`. The mode, model and effort can still be
  changed per chat from the prompt box.

## Routines

Capcom runs the routines that Claude Desktop runs, so Desktop does not have to stay open for them. A
routine is a prompt file that Desktop keeps, `~/.claude/scheduled-tasks/<id>/SKILL.md`, which Capcom reads
and never writes, and a schedule that Capcom keeps in `routines.json` in its state folder. Capcom has to be
running when a routine is due, which is what the launchd agent under "Always on" is for.

- **Seeding.** Desktop's own schedule file is internal to it and has no jitter in it, so the schedules
  are exported once from Desktop to a JSON file with a `routines` list. Each entry has an `id`, `title`,
  `cron`, `jitterSeconds`, `file`, `cwd`, `model`, `effort`, `mode` and `enabledInDesktop`.
  `npm run seed-routines -- <export.json>` copies them into `routines.json`, every one switched off, and
  prints when each would fire next. Run it again with a newer export to add routines that are new. The
  ones already there are left as they are, apart from `enabledInDesktop`. Capcom reads `routines.json`
  on every check, so a seed run or a hand edit shows without a restart. Capcom writes the file too, so
  reload it before a hand edit.
- **Switching over.** A routine runs in Capcom only once it is switched on here, so switch it off in
  Desktop first, or both apps run it. Switching on counts the schedule from that moment, so a fire time
  earlier in the day is not run on top of Desktop's own run.
- **When it fires.** The schedule is a five-field cron in the Mac's time zone, which Capcom follows if it
  changes, with the routine's jitter added as a fixed offset, as Desktop does it: `30 7 * * 1-5` with 737
  seconds of jitter fires at 07:42:17. Capcom checks every 30 seconds, and once when it starts. A routine
  that is due starts a new session in its folder with its permission mode, model and effort. The first
  message is Desktop's: the text of `SKILL.md` after its frontmatter, inside the same `<scheduled-task>`
  wrapper. The file is read afresh at each run, so an edit applies at once.
- **Missed runs.** If Capcom was not running at a fire time, the latest missed fire runs once as soon as
  Capcom is up, provided it is under 12 hours late. A later one is skipped and logged. However many fires
  were missed, that is at most one run.
- **One at a time.** A fire that comes while the routine's previous run is still working is skipped and
  logged, not held over until it ends. A previous run that is only waiting for an answer is stopped, and
  the new run starts in its place.
- **Three at once.** At most three routines run at the same time, as in Desktop, so fewer of them fight
  over one Chrome. A fourth that comes due waits for a free place, and starts as soon as one frees up. A
  run waiting for an answer does not take a place. Run now ignores the limit.
- **Restarts.** `routines.json` records when each routine was switched on and last ran, and the next
  fire is worked out from that. A restart does not repeat a run, and a run that came due while Capcom
  was down is caught up as above. A restart can cut a run in progress short, and Capcom does not start
  that run again. A run that cannot start is recorded in `lastError` and waits for the routine's next
  fire.
- **A wrong file.** Capcom runs nothing while `routines.json` cannot be read, has a routine with no id, or
  has an id twice, which is what a copied entry with its id left alone looks like. `GET api/routines` says
  which, and Capcom logs it once on stderr. An `enabled` that is not `true` or `false` counts as off.
- **API.** `GET api/routines` lists the routines with their next fire time, whether each is running, and
  what is wrong with it if anything. `POST api/routines/<id>/run` runs one now, switched on or not, and
  answers 409 while its previous run is working. `POST api/routines/<id>/enabled` takes
  `{ "enabled": true }` or `false`.
- **Logs.** Every run, skip and switch is a line on stdout, and every run that fails to start is a line on
  stderr. Under launchd those are `out.log` and `err.log` in `~/Library/Logs/capcom/`.

## The page

The page is a Preact app written with htm templates, so it runs straight from `public/` with no build
step and no `npm install`. Preact, its hooks and htm are vendored into `public/vendor/`, and an import map
in `public/index.html` points their bare names at those files. `public/vendor/README.md` has the
versions, the checksums and how to update them. The browser needs import maps: Safari 16.4, Chrome 89 or
Firefox 108 and later.

- `public/app.js` holds the routes and the session list's data, and mounts the app.
- `public/ui/session.js` is one open chat. It reads the transcript, follows the live event stream and
  sends everything you do. The other files in `public/ui/` are components that draw what it holds, and
  small helpers.
- `public/md.mjs` renders Claude's Markdown. It escapes everything first, so a reply cannot inject markup.
- The server sends the files in `public/` that end in `.js`, `.mjs`, `.css` or `.png` before anyone signs
  in, so keep anything private out of that folder.

## Run it

```bash
npm run set-password
node server.mjs
```

There are no npm dependencies (Node 20 or later), and the page's libraries are vendored. `npm test` runs
the unit tests, for the cron parser, the routine scheduler and the start timeout, with Node's own test runner. The password is
kept only as a scrypt hash in `~/.config/capcom/auth.json`, and setting a new one signs every browser
out. Until one is set, Capcom refuses every request.

Capcom has a web app manifest, so Chrome or Safari can install it as an app of its own, with its own
window and Dock icon. Window managers then see it as its own app rather than as the browser. On the Mac,
install it from http://localhost:4310, because Chrome only offers Install on a secure address, and it
treats localhost as one.

## Configuration

`config.json` holds the defaults: the port, the `claude` command, the folders Capcom reads and the
timeouts. To change a value on one machine, put it in `config.local.json` in the repo root. That file is
optional and git-ignored, and its values replace the ones in `config.json`.

```json
{ "station": "studio", "claude": "/usr/local/bin/claude" }
```

- `station` is the machine name shown in the header of the session list. It defaults to the short hostname.
- `claude` is the CLI to run. It defaults to `claude`, found on `PATH`.
- `chrome` is `true` by default. Set it to `false` to start every session without Claude in Chrome.
- `desktopHandoff` is `false` by default. Set it to `true` to hand new sessions to Claude Desktop (see
  "Things to know"). Turning it on also hands over, the next time Capcom starts, every session started
  here that Desktop does not have yet.

Three environment variables win over both files. `PORT` sets the port, `CAPCOM_CLAUDE` sets the CLI,
and `CAPCOM_STATE` points a test instance at its own login, registry and routines. Two instances that
share a state folder both fire its routines, so always give a test instance its own.

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

A message with images can be about 53 MB, because the page sends them as base64 inside the request. The
proxy has to let a request that large through, and nginx, for one, refuses more than 1 MB until
`client_max_body_size` says otherwise. Capcom itself takes that size only on the routes that send a message
or start a session, and keeps 1 MB on every other route.

The password is the only thing between that address and a shell on this machine. Anyone who signs in
can run commands as you. Capcom locks sign-in for 15 minutes after ten wrong guesses. Pick a long
password and keep the address private.

## License

MIT, see [LICENSE](LICENSE). The libraries in `public/vendor/` keep their own licenses, MIT for Preact and
Apache-2.0 for htm, which sit next to them.
