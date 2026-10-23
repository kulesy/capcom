# GhostShell

A browser chat client for every Claude Code session on this Mac: the ones started in Claude Desktop,
the routine runs, and the ones started in a terminal. The list uses GhostShell's own projects, groups and pins,
and nests one session under another. The groups and pins start as a copy of Desktop's. It listens on
http://localhost:4310.

GhostShell used to be called Capcom. The repo, the service and the stored settings still use the name capcom,
so an existing install keeps working. [The decision record](docs/adr/20261023-ghostshell-name.md) lists what
keeps it and why.

The reasons behind the design are in [docs/adr](docs/adr/README.md), one record per decision.

## How it works

- **Sessions** come from two places, both read only. Claude Code saves every session as a JSON lines
  file under `~/.claude/projects`. Claude Desktop keeps its titles, groups and pins under
  `~/Library/Application Support/Claude`. GhostShell reads the titles, the records and the links between sessions
  each time, and the groups and pins once (see "Groups and pins" and "Nested sessions"). Those Desktop files
  are internal and undocumented, so when a Desktop update moves them the list carries on from the session
  files alone and says so at the top.
- **Chatting** runs the real CLI headless, one process per open chat:
  `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`,
  with `--resume <id>` for an existing session. It uses your normal login, skills, hooks and MCP
  servers. A process stops after 30 idle minutes and starts again on the next message.
- **Approvals** arrive from the CLI as permission requests and show as cards above the reply box.
  Closing the page leaves the work running, and a waiting approval is still there when you come back.
  "Always allow" applies the rule Claude suggests, which usually lands in the folder's
  `.claude/settings.local.json`.
- **The prompt box** follows Desktop's. It is one row: a + on the left attaches images, the text sits in the middle
  and the send button on the right. As you type more lines the text grows to 40% of the window's height and then
  scrolls, with the + and send level with its last line. The permission mode (Manual, Accept edits, Plan, Auto, Bypass permissions) sits under the box
  as plain text and opens its list when you click it. One button on the right names the model, `Fast` when fast mode is on, and the effort, and opens a
  menu like Desktop's. Opus 5.5, Fable 5.1, Sonnet 5.5 and Haiku 5.5 come first, and the keys 1 to 4 pick them while the focus is in that list.
  Effort opens Low, Medium, High, Extra and Max, with a warning on Max. More models holds Opus 5.5 (1M) and every other model the CLI
  lists. When the model takes fast mode, the menu also has an Enable fast mode switch. A change applies from
  Claude's next request, even mid-turn, and is remembered
  for that session in `picks.json` in GhostShell's state folder, so it survives the idle stop and a restart. Fast mode is off until you switch it on for a session.
  `Fast` shows off while a chat's process starts, until Claude accepts fast mode, and a chat with no process shows what you picked. A refusal turns it off for that session.
- **Skills and commands.** Type / at the start of the prompt box and a list of the skills and slash commands that
  chat can run opens above it, filtered by name and alias as you type. The arrow keys move, Enter or Tab picks, a
  click or tap picks, and Esc closes the list without stopping a running chat. Picking writes `/name ` into the box
  and shows the command's argument hint in grey after it, and sending runs it as a terminal would. While the list
  is open Enter picks, so a command typed in full takes a second Enter to send. After Esc, Enter sends what you
  typed, and a message that starts with / but matches nothing, such as a path, sends as typed. The list is the
  CLI's own. A running chat uses the one its process gave when it started. A new session, or a chat with no process
  yet, gets it from a short `claude -p` run in its folder that sends no message, starts no MCP servers, runs no hooks
  and writes no session. GhostShell keeps a folder's list for 2 minutes. `/clear` is left out, because the CLI answers it with a new
  session that GhostShell's chat would not follow. [The decision record](docs/adr/20261022-slash-menu-from-the-cli.md)
  says why the list comes from the CLI.
- **Context.** A ring at the right end of the row under the prompt box, where Desktop puts its own, shows how full
  the chat's context window is. It turns amber when the chat is 90% of the way to auto-compact, and its tooltip gives
  the tokens used and the percent. Press it to see the tokens used out of the window, where auto-compact starts, and
  what fills the context, largest first, as Claude Code's /context lists it. While GhostShell runs the chat, the figures
  come from the CLI's own count, which runs no model turn and writes nothing to the session. A chat with no process
  shows the total from its session file instead, as of Claude's last reply, with no parts. The window and the
  auto-compact point come from the CLI, and GhostShell keeps them per model in `windows.json` in its state folder, so a
  chat with no process shows its window once GhostShell has run a chat set to that model. On a narrow phone the
  permission mode's name shortens to keep that row on one line.
  [The decision record](docs/adr/20261022-context-usage-from-the-cli.md) says where each figure comes from.
- **Images.** Paste a screenshot anywhere on the page, drop image files onto it, or pick them with the +, and
  each attaches as a thumbnail above the text, with a cross to take it off again and a click to look at it in the viewer. PNG, JPEG, GIF and WebP, up to 10 to a message,
  and a message may be images alone. Before it sends, the page scales anything over 2000 pixels on its long
  edge down and keeps each image under 3.75 MB, so that even as base64 it is under the 5 MB the API takes. It
  keeps PNG and falls back to JPEG only when a PNG is too big. The CLI then re-encodes any image over about
  0.5 MB itself, so a large screenshot reaches Claude re-encoded whatever the page sent. A paste that also
  holds several lines of text, as a spreadsheet copy does, pastes the text instead, and so does one with any
  text into another field. An image pasted alone into a field, such as a question's answer box, attaches to
  the prompt box, because the field would drop it. A message sent while Claude works can carry images too,
  and the CLI holds it until the running tool finishes, as it does a text
  message. Every message in a transcript that carries images shows them as thumbnails that open in the viewer
  on click, including messages sent from Desktop or a terminal. The pictures Claude gets back from its tools,
  such as a browser screenshot or an image file it reads, show the same way under the call that returned them.
- **The image viewer** opens when you click or tap a thumbnail in a transcript, one still being sent included,
  a picture a tool returned to Claude, or a picture attached to the message you are writing. It shows the
  picture scaled to fit the screen. Esc, the cross at the top right or a click outside the picture
  closes it. The left and right arrow keys, the arrows under the picture or a swipe step through the other
  pictures in that chat in the order the thread shows them, those you sent and those Claude's tools returned
  together, with a count such as "2 of 5" between the arrows. Pictures attached to the box you are writing step
  among themselves only.
  Pinch with two fingers on a phone or a trackpad to zoom in on the spot between them, or hold Ctrl and turn the
  scroll wheel. Double tap the picture to zoom in where you tapped, and double tap again to go back. Actual size
  shows the middle of the picture at its own pixel size, and Fit to screen goes back. The button is greyed out
  until the picture has loaded, and when it already fits at its own size. While the picture is zoomed, you move
  around it with a drag, a swipe, the scroll wheel or the arrow keys, so only the arrows under the picture step.
  Page Up and Page Down move it a screen at a time, and Home and End go to its top and bottom. The next picture
  opens at fit. A pinch does not step or zoom the page behind. The link at the top opens the picture on its own in
  a new tab.
  While the viewer is open, Tab stays among its controls, the page behind does not scroll or take keys, and
  Esc closes the viewer without stopping a running chat. Closing it puts focus back on the thumbnail you
  clicked, however far you stepped, so you stay where you were reading. If that thumbnail has gone, as when a
  message still being sent has arrived, focus goes to the same picture's new thumbnail, or else to the nearest
  thumbnail you can see. The count and the arrows take in every picture in the chat, those in history the page has
  not loaded included, and an earlier picture shows without you scrolling up or pressing Load earlier.
- **Stop and redirect.** While Claude works and the box is empty, Send turns into Stop, and Esc stops
  too. A message sent while Claude works redirects it without stopping it: Claude reads the message once
  the running tool finishes and adjusts before its next step.
- **New sessions** start from New session, the first item in the + menu at the top of the list, from
  the search's New session action, with Ctrl+N, or with Cmd+N in the installed app. Each opens an empty
  chat with a folder picker above the prompt box (the home folder, or a recent one), and the first
  message starts the session in that folder. The + and the keys work while the list is still loading.
  The search shows its action once the list has arrived. In a browser tab Chrome runs Cmd+N as New
  Window before the page sees the key, so it still opens a window there. In the app's window Chrome
  gives the page the key first, so there Cmd+N starts a session instead. GhostShell tells a tab from the
  app's window with the `(display-mode: standalone)` media query, and treats a full-screen app window
  as a tab, because Chrome reports it as full screen. In the app Cmd+N still opens a second GhostShell
  window on the sign-in page and while a widget has focus, because GhostShell's page never sees the key
  there. File > New Window in the menu bar opens one too. New session in the + menu and in the search,
  the Find and Projects buttons' tooltips and the line on the empty page name the modifier that works
  where GhostShell is running: Cmd in the app on a Mac, and Ctrl everywhere else. A touch screen shows no
  key beside New session.
- **The list** shows one view at a time, which you pick in the projects sidebar (see "Projects" below).
  Home shows routines first, then pinned sessions, your groups that are in no project, the sessions
  started here, ungrouped ones and terminal sessions. A project's view shows pinned sessions, then that
  project's groups, with no header for the project, because the sidebar already names it. Every group
  lists its sessions by title, A to Z, and a family goes by its head's title. The other sections sort as
  you set them in Claude Desktop: by last turn, by when the session was made or by title, either way
  round. A group shows when it is empty, so one that was just made can be found and filled, and a project with no groups says so beside a New group button.
  The other sections show only when they hold a session. A session's row is one line on a mouse, as in
  Claude Desktop: the title, and a mark at the right end that says what the session needs from you. The
  mark is amber when the session needs your input, blue when it has something you have not read, grey
  while a turn runs, and a small warning triangle when the last turn failed. A row that needs nothing
  shows none. GhostShell reads Desktop's unread marks, read only, so a session you read only in GhostShell stays
  unread in Desktop. On a mouse a row's text is grey, and darkens on the open chat's row and under the
  pointer. A row whose turn
  is running also shows how long that turn has run, left of the mark and of any fold arrow, for a chat
  GhostShell runs and for one Desktop or a terminal runs. The open chat's row keeps time with its status line.
  Other rows pick up a turn's start and end on the list's next load, up to 15 seconds later. The dots
  button takes the mark's place only on a mouse in a window at least 48rem wide, while the pointer is over
  the row or the focus is in it. The arrow that folds a parent's nested sessions or a routine's earlier
  runs sits to its left, and shows only then or while they are folded. Below that width, or with no hover,
  the mark, the arrow and the dots all show. A tooltip with the folder, branch, state and when the session
  last ran opens on the right of the row 700ms after the pointer reaches it, at once if another tooltip
  closed in the last 300ms, and at once on keyboard focus. A touch screen has no tooltips, so its rows
  have a second line with those details, and the mark and the buttons always show.
- **Groups and pins** are GhostShell's own, kept in `layout.json` in its state folder. The first time GhostShell
  starts without that file it copies Desktop's groups, their sessions and its pins in, once, and records
  when. After that it ignores Desktop's groups and pins. If it cannot read Desktop's files at that start,
  the layout starts empty and it tries again on each later start. Drag a row onto a group to move it there,
  onto Pinned to pin it, or onto Ungrouped, Started here or Terminal and other to take it out of its group.
  Routines is not a place to drop. A row drops onto a section on screen. A mouse drags after a few pixels
  of movement, a finger after a long press, and Esc cancels. Move to in a row's menu makes the same moves
  without a drag. It opens a second menu of Pinned, the groups (a project's groups sit under the project's
  name) and the loose list the session came from, with the place the session is already in left out. It
  lists the groups of every project, so it also moves a session to a view that is not on screen. A
  routine's run that was moved into a group or pinned can go back to Routines from there. There is no
  screen yet to rename, delete or reorder groups. Edit `layout.json` for those: GhostShell reads it on every
  refresh, and shows the error at the top of the list if it cannot.
- **Nested sessions** show under a parent session in the list, indented, with a line from the parent that
  turns into the last of them, as Claude Desktop draws them. Drop a row on the middle of another row to
  nest it there. A row takes a nest only in the middle half of its height, so a row dropped on the top or
  bottom quarter lands in the section the row is in, as it did before. While you drag, the row that would
  take the nest lights up and says "Nest here" left of its mark. Nesting goes one level deep: a session
  that holds others takes them along when you nest it, and a drop on a nested row nests under that row's
  parent. A routine's run and an archived session cannot be a parent. A nested session shows in its parent's
  place, with the parent's group or pin, and counts in that section and project. The arrow on a parent's row
  folds its nested sessions, every family starts open, and the browser remembers which are folded. In a list
  sorted by last turn a family sorts by its most recent session, so a busy nested session keeps its
  parent near the top. Drop a nested session on a section, the indent beside its family included, or move or
  pin it from its menu, and it leaves its parent and goes there. Move out of in its menu takes it out,
  and it stays in its parent's group or in
  Pinned. A parent in neither sends it to the list for where it started: Started here, Ungrouped or Terminal
  and other. Nest under in any session's menu opens a second menu of the other top level sessions in the
  same section, so a phone nests without a drag. Archiving a parent archives only the parent. Each session
  that showed straight under it moves up to its place with the ones under it still under it, and they nest
  under the parent again when it comes back. Taking a
  nested session out, moving it, pinning it or archiving it leaves the rest of the family under the parent,
  even when Desktop links them through that session. Claude Desktop records which sessions it linked to a
  parent: side chats, forks and suggested tasks. GhostShell reads those links on every refresh, so it shows the families Desktop shows with no drag,
  and shows a link Desktop records later on the next refresh. GhostShell's own choice wins over Desktop's in
  both directions, as it does for the archive flag. A session you nest stays nested whatever Desktop
  records, and one you take out stays out although Desktop links it. `layout.json` keeps those choices under
  `parents`: a parent's id nests a session and a null takes it out. A session with no entry follows the chip it
  was started from, and then Desktop. A session you start from a chip nests under the session that made the
  chip, as Desktop nests the tasks it suggests. GhostShell reads that from `chips.json`, so chips you started
  earlier nest too. Moving the session, pinning it, taking it out or nesting it elsewhere wins over the chip,
  as it does over Desktop's links.
- **Projects** are an optional level above groups, so a project holds groups and a group holds sessions. A
  group belongs to at most one project, and one that belongs to none stays at the top level, which Home
  shows. Group headers fold, and the browser remembers which are folded. A group's name is bold, and a
  line separates each group from the one above. The + at the top of the list
  starts a session, or makes a group in the view you are in: at the top level in Home, and in the project
  in a project's view. A project's menu is on its row in the projects sidebar: New group here, Rename and
  Delete project. The dots at the end of the row open it, and so do a right click, the menu key or
  Shift+F10, and on a phone a long press. Rename puts a name field in the row's place. New group here
  shows that project's list first, as picking it does, and opens the group form there. Delete asks first,
  then moves the project's groups to Home, and shows Home if the project was on screen. No group or
  session is deleted. The dots on
  a group's header move it into a project, between projects or back to Home, and show only when there is
  somewhere to move it. A note then says where the group went, and the list stays on the view it was in.
  A right click or the menu key on a group's header opens the same menu. Every step is a menu, so a phone
  can do all of them. A name runs to 80 characters at most, and two projects may share one.
- **The projects sidebar** picks the view the list shows. Home is first, and each project follows it with
  the number of sessions in its groups. Pinned sessions show in every view. In a window 56rem wide or
  more, the sidebar is a column on the left, beside the list, and the chat narrows to make room. The
  Projects button at the left of the list's header opens and closes it, and the browser remembers whether
  it is open. Ctrl+B or Cmd+B opens and closes it too, as Cmd+B shows and hides Desktop's sidebar, and
  closes the search or a menu if one is open. The focus stays where it was, unless it was in the search or
  in the column as it closed, when it goes to the button. In a narrower window there is no room beside the
  list, so the sidebar is a sheet that slides in from the left over the page, a chat included. Its top has
  the same button, pressed, with the title Projects beside it. Pressing it, Esc and a press outside the
  sheet close it. So do picking Home or a project, which also shows that view's list, opening another
  page, a change of view and the window growing to 56rem. With a project's menu open in the sheet, Esc or
  a press outside closes the menu first. Ctrl+B or Cmd+B opens and closes the sheet as the button does.
  A phone always starts with it shut. The browser remembers the view. Opening
  a chat shows the view that has its row, once for each chat, and a pinned chat leaves the view as it is.
  A lamp beside Home and each project is green when a chat in it is working and amber when one needs you.
  When the sidebar is not showing and a chat in another view needs you, the button has an amber dot. New
  project is the button at the bottom of the sidebar. It asks for a name, shows the reason in the sidebar
  if GhostShell refuses one, and shows the new project when it takes it.
- **Finding a session.** Ctrl+K (or Cmd+K), or the search icon at the top of the session list, opens a
  search laid out like Desktop's. Chips pick what to look through: All, Sessions, Projects, Routines and
  Archived, and the left and right arrows move between them from either end of the text. With nothing
  typed, All shows recent sessions, then Home and each project, then a New session action. Typing filters
  by title, folder, branch or routine, and Home and the projects by their name. The up and down arrows and
  Enter open a result, and Esc closes it. Archived sessions stay out of the list and turn up here, under
  their own chip, most recently archived first, and after the live matches in any search. Home and the
  projects are results too, under All and under the Projects chip. Each has its lamp, and a project has
  its number of sessions. Opening one closes the search and shows that view in the list. The focus goes to
  Home's first header, to a project's first group header, or to New group in a project with no groups. In
  a window 56rem wide or more an open chat stays open. In a narrower window the list
  takes the chat's place. With no project, All leaves the Projects section out, and the chip lists Home
  alone.
- **Archiving.** Right-click a session in the list, or press the menu key or Shift+F10 on it, for a menu
  with Rename, Move to and Archive. On a phone, long-press the row and let go without moving it. Archive
  works for any session, whichever app started it. A note at the top of the list then offers Undo for 10
  seconds. When the chat is working or waiting for an approval, the item reads Stop and archive: the turn
  ends, the approval is denied and the chat's process closes. The list can take up to 15 seconds to show
  that a turn has started, so if Archive finds the chat running, it asks first. On a Mac, Cmd+A archives
  too, and the menu shows the key beside the item, except on a touch screen. The key archives the session
  whose menu is open, or else the row the keyboard moved to, which shows the focus ring, or else the open
  chat. A row you clicked shows no ring, so it doesn't count. After the key archives a session the ring
  moves to the row beside it, so pressing the key again archives that one. When no row is left beside it,
  the ring moves to the first header, or to the Projects button when there is no header. The key does
  nothing while the ring is on anything in the list or the projects sidebar that is not a session. Text
  fields and the forms in the list and the projects sidebar keep Cmd+A as Select All. So does the page
  when no menu is open, no ring is in the list or the projects sidebar, and there is no session to
  archive. GhostShell leaves Ctrl+A to the browser. For a chat that is working or waiting, Cmd+A asks first with
  Cancel focused, so Enter or Esc leaves the chat running. Archiving the open chat, from the key or the
  menu, goes back to the list, where the note shows. Undo then opens the chat again if you are still on the
  list. In the search, each archived result has an Unarchive button, and Shift+Enter unarchives the
  selected one. Unarchiving, or sending the session a message, brings it back to the group, pin or routine
  it had. Desktop's records are read only, so GhostShell keeps these choices in `layout.json`, and its choice
  wins over Desktop's archive flag in both directions.
- **Renaming.** Double-click a session's row, or choose Rename in its menu, and a text box takes the
  row's place with the title selected. Enter saves, Esc cancels, clicking away saves, and a title runs to
  120 characters at most. On a phone a double tap opens the session, so rename from the menu. GhostShell
  keeps the title in `layout.json` and shows it in place of every other title, for any session, whichever app started it. It shows in
  GhostShell only: Desktop's records are read only and a terminal session's title belongs to the CLI, so Desktop
  and the terminal keep the titles they have. A group lists its sessions by the new title, and the search
  finds them by it. With `desktopHandoff` set to `true`, a session renamed here before it is handed to
  Desktop takes its GhostShell title with it.
- **Keyboard in the list.** The up and down arrows move through the section headers and the sessions,
  Home and End jump to either end, and left and right fold a section, a routine's runs or the sessions
  nested under a row. Right on a row whose nested sessions show moves to the first of them, and left on a
  nested session or an earlier run moves back to the row above it. Enter opens the
  focused session, the menu key or Shift+F10 opens its menu, and on a Mac Cmd+A
  archives it. With no chat open, up or down steps into the list. Tab reaches the dots on a header, and
  Enter or Space on them opens the menu. In a menu the up and down arrows, Home and End move between items,
  Esc closes it, and Tab leaves it. In a row's menu the right arrow on Move to opens its list of places,
  and the left arrow there goes back. In the projects sidebar the up and down arrows, Home and End move
  between the views and the New project button. Tab reaches a project's dots, and the menu key or
  Shift+F10 on a project opens its menu.
- **Routines** open their latest run with a click. The arrow at the end of a routine's row folds its
  earlier runs out underneath. Runs that GhostShell starts itself (see "Routines" below) list there with the
  routine's title, beside Desktop's runs of the same routine.
- **Tool calls** are collapsed into one row for each run between Claude's messages, such as "Read 3
  files, ran 2 commands, edited 1 file" with a `+12 -1` count of changed lines. Tap a row to see every
  call. A thought among the calls folds into the row, as in "Thought, ran 2 commands". A call that returned
  pictures to Claude, such as a screenshot, shows them as thumbnails under its row, and under the group's row
  while the group is folded, so they need no tap to see. A row shows up to four. When there are more, the
  fourth thumbnail is dimmed with a count such as "+7" for the pictures that have no thumbnail of their own, and
  a click on it opens the viewer at that picture. Each thumbnail opens the viewer. A call to an MCP tool shows
  its server first, as in "Chrome computer" or "Gmail search threads", and its thumbnails are labelled with
  where they came from, such as "Image from Chrome". Desktop's app tools show as "Desktop". Some older
  Desktop chats name Chrome's server `Claude_in_Chrome`, where the CLI says `claude-in-chrome`. GhostShell
  reads both as Chrome, in tool rows and in group titles such as "Used Chrome 3 times". Desktop names a
  claude.ai connector by an id, so in a Desktop session it shows by the name that session's Desktop record
  gives it, or as "connector" when the record has none. A picture a tool returned in a form the page cannot
  draw still shows as "[image]" in the call's output. A message to another chat reads "to name: summary"
  and counts as "sent 2 messages", and a look at the other chats reads "looked up other sessions". A send
  asks for approval only when a permission rule makes the CLI ask, and the approval card then shows who it
  goes to and the message.
- **Live work.** While Claude works, its thinking streams into a Thinking block above the status line.
  The block folds into a Thought row when the thought ends, and a tap opens it again. Each tool call shows
  as soon as it starts. The status line sits under the last row, as in Desktop. Three lamps light in turn,
  then come the time the turn has run, the output tokens of the replies Claude has finished and what it is
  doing, as in "2m 26s · 804 tokens · Thinking" or "2m 26s · 804 tokens · Running a command". The token
  count moves when a reply ends, not while one is written, because the CLI reports an exact count only
  then. The last group of tool calls in a running turn is a live row. Four lamps turn where its chevron
  sits, its title is the step Claude is on, such as "Running npm test" or "Reading lib/runner.mjs", and its
  own timer counts from the group's first row. When the step changes, the old text fades out as the new
  text fades in, and the last step fades into the group's summary when the turn ends. With reduced motion
  on, the lamps stay lit and the text changes at once. A headless CLI redacts its thinking, so GhostShell asks
  it for summaries when the process starts, and the CLI saves them in the transcript. If the CLI sends no
  thinking text, no block appears and the status line says "Thinking" after the timer. A thinking block
  saved with no text shows nothing, and a turn stopped mid-thought keeps none of it, because the CLI saves
  a block only when it ends. Checked on CLI 2.1.301 with Haiku 5.5. A chat that Desktop or a terminal runs
  shows the same line and row, and its header lamp reads working. Those apps send GhostShell no stream, so
  GhostShell reads the chat's transcript. It counts the chat as working while the transcript ends inside a
  turn, GhostShell's own headless CLI did not write that turn, and the transcript or one of the chat's agents'
  files changed in the last 10 minutes. The time and tokens move when a step is saved. Such a chat has no
  thinking text. It reads as running while Desktop waits for an approval, because a call that waits for one
  looks the same in the transcript as a call that runs, and for up to 10 minutes after an app quits in the
  middle of a turn. A prompt from another app, or one that comes more than 10 minutes after the turn's last
  entry, starts a new turn, so a turn that never ended is not joined by the next one. A command you run with
  `!` in a terminal neither starts a turn nor ends one, because Claude does not reply to it.
- **Notices.** The CLI saves some of its own messages as user turns: a background task that finished,
  failed or was stopped, a line from a monitor, a message from another session or a subagent, the CLI's
  report on a message this chat sent to another session, and a command you ran with `!`. GhostShell shows each
  as a compact notice instead of a message from you. A notice has a lamp (green when a task finished or a
  message was delivered, amber while a message waits for approval, red when a task failed or a message was
  not delivered, grey otherwise), a title such as "Background task finished", and a line saying what
  happened. The task ids, the output file, the CLI's note and any text meant for Claude alone sit behind a
  Details toggle. Only known kinds of message become notices, so text you type that mentions a tag stays
  your message.
- **Messages between chats.** Chats message each other with the CLI's `SendMessage` tool and find each
  other with `ListAgents`. The CLI delivers a message when the sender and the receiving chat are in the
  same kind of permission mode, both bypassing permission prompts or both asking. An idle chat then starts
  a turn to answer it. GhostShell shows the message as a notice titled "Message from" and the sender's name,
  with the sender's address and mode behind Details. A report from one of this chat's own subagents is
  titled "Message from a subagent". The name and the address are claims the sender makes, so they label a
  message and do not prove who sent it. A chat that GhostShell stopped after 30 idle minutes has nothing
  listening and receives no messages until it starts again.
- **Held messages.** The CLI holds a message instead of delivering it when the two kinds of permission
  mode differ, when the sender does not say which kind it is in and this chat bypasses permission prompts,
  and for a few other reasons, such as the `crossSessionInbound` setting being `hold`. A held message
  shows above the reply box as a card with an amber lamp. The card names the sender and gives the reason,
  and one line under the amber cards says Claude has seen none of it. Several messages from one sender
  for the same reason share one card and a count, and a card that takes another message moves to the
  bottom, where the newest sits. The box scrolls to its foot when the cards change, so the newest card is
  in view on a phone. When the CLI gives up on a message, a grey card says why. It stays until you press
  Dismiss or reload the page, and it is still there when you come back to the chat from another one.
  GhostShell remembers up to 100 undelivered messages for each chat, and the oldest go first. Cards are live
  only. The CLI saves nothing about a held message, so GhostShell learns that a hold ended only while the chat
  is open, and a page opened later shows the messages still held and none that ended. The amber cards go
  when the chat's process ends, and when a new process starts after you stopped the chat.
- **Approving a held message** cannot be done from GhostShell. A terminal session shows its owner an approval
  dialog, which the CLI's code calls `peer_inbound_approval`. A chat run as GhostShell runs it was not sent
  that dialog when checked on CLI 2.1.302, even after it declared it could show one. It gets only a note
  that a message is held, and the CLI answers a made-up approval request with "Unsupported control request
  subtype". The CLI waits 5 minutes for an approval by default (its `dialogExpiry` setting, which the
  `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS` environment variable overrides), and then drops the message. Two
  things release a held message sooner. One is changing the chat's permission mode to the sender's kind.
  The other is setting `crossSessionInbound` to `accept`, which releases every held message and accepts the
  later ones. GhostShell does neither for you, because a message from another session is untrusted input.
  [The decision record](docs/adr/20261016-peer-messages-between-chats.md) says what approving one message
  would need from the CLI.
- **Reading** a long session loads only its last 2 MB, with "Load earlier" for the rest. Sessions
  running somewhere else, in Desktop or a terminal, update as their file grows. The images in a message, and
  the pictures a tool returned to Claude, are not part of what the page loads. Each message or tool result names
  them, and the page fetches each one from `api/sessions/<id>/images/<ref>` when it draws the thumbnail, which
  for a strip of Claude's pictures is when the thumbnail scrolls near the screen. The viewer uses the same address, so the
  browser reuses what the thumbnail loaded, and the viewer loads the pictures either side of the one on screen ahead of time.
  For the pictures before the part it has loaded, the page asks `api/sessions/<id>/images?before=<offset>` when the
  viewer opens, and keeps the answer until Load earlier moves that offset. The answer names each picture by its ref
  and type and carries no image data. The server builds the list in one pass over the transcript, keeps it, and
  afterwards reads only the lines added since, so the first list for a 130 MB chat takes about 200 ms and later ones 1 ms.
- **Look.** GhostShell is built on shadcn/ui and follows the system's light or dark setting. Every device gets the
  Ghost look, inspired by the Ghost in Destiny: black, white and grey, cut corners, status dots drawn as eyes,
  and a working spinner shaped like a shell that opens and turns round its eye. Sign-in and setup keep the
  plain shadcn/ui look. [The decision record](docs/adr/20261022-ghost-look.md) says what changes and why.

## Tools

GhostShell sessions get the standard Claude Code tools, the claude.ai connectors and the MCP servers in
`~/.claude.json`. Desktop's own built-in tools are served from inside the Desktop app, so GhostShell
cannot borrow them. It adds its own instead, the same way: a server called `capcom`, declared in the
initialize request and answered over the session's stdio (`lib/tools.mjs`).

- **Chips** (`spawn_task`, `dismiss_task`) show as cards with Start and Dismiss. Start opens a new
  GhostShell session with the chip's prompt, in the folder printed on the card. Chips that Desktop
  sessions created can be started too.
- **Chapters** (`mark_chapter`) show as titled dividers.
- **Group sessions.** Each group's header has a button that opens the group's own chat at `#/g/<group id>`,
  and it lights with the chat's mark while that chat works or waits for you. The chat works in a
  private folder under Capcom's state folder, shows the group's live status above the transcript, and gets
  three tools that reach that group alone: `list_group_sessions`, `read_group_session` and
  `start_group_session`. Starting a session always asks first, in every permission mode.
  The status is drawn from the list the page already loads, so it costs no tokens. It folds to one line,
  such as "2 need you · 3 working · 12 recent · 140 more", and opens to the sessions that need you, the
  ones working and the recent ones, each a link to its chat. Idle and archived sessions sit in a fold of
  their own, and the archived ones are read from the server only when it is opened. Both folds are kept
  for each group in the browser. A server that started before groups had sessions has no button, and the
  group's page says to restart GhostShell.
  [The decision record](docs/adr/20261023-a-session-for-each-group.md) says what it can and cannot do.
- **Widgets** (`show_widget`) draw in an iframe sandboxed to `allow-scripts`, with a content policy
  that limits requests to cdnjs, esm.sh, jsDelivr, unpkg and Google Fonts, so model-written HTML
  cannot reach GhostShell or its cookie. The frame carries Desktop's variable names, SVG classes and
  colour ramps (with GhostShell's own values) and the Tabler icons, so a widget written for Desktop draws
  the same. `sendPrompt` sends a message at once on a click inside the widget and asks you first for
  anything else, and links always ask first. `widget_guide` tells the model how to write one, once per
  chat, and its `loading_messages` show in a placeholder while it writes.
- **Questions** (`AskUserQuestion`) show as option buttons, plus a box for your own answer.
- **Claude in Chrome** is on in every session and every permission mode, as it is in Desktop. The
  `chrome` setting turns it off for all of GhostShell (see Configuration). GhostShell starts the CLI
  with `--chrome` and an ask rule for every Chrome tool, so Chrome asks before each action, even ones
  your settings already allow, and the question shows as an approval card. Bypass permissions is the
  exception: GhostShell allows Chrome there without a card, as Desktop does, and a switch to a stricter mode
  asks again at once. Chrome cards have no Always allow.

Still Desktop only: the in-app browser, the iOS Simulator panel, Desktop's window and sidebar, and
computer use (not available to the CLI in `-p` mode).

Things to know:

- Sessions started here stay in GhostShell, under "Started here", and do not appear in Desktop's sidebar.
  With `desktopHandoff` set to `true` (see Configuration), GhostShell hands each new session to Desktop
  when its first reply finishes. It stops its own process for the session, adds a title to the
  transcript, and opens Desktop's hand-off link (`claude://resume?session=<id>`). Desktop adds the
  session to its sidebar and switches its window to it. The next message sent from GhostShell starts the
  process again.
- Opening a session that is also open in Desktop continues the same session. If both are used at
  once, the two can drift apart.
- Settings follow Claude Desktop. A session Desktop knows continues with the permission mode, model
  and effort Desktop recorded for it. Any other session, and every new one, gets Desktop's mode for
  that folder (falling back to `permissions.defaultMode` in `~/.claude/settings.json`), Desktop's
  effort level, and the model from `~/.claude/settings.json`. You can change the mode, model, effort and fast mode
  per chat from the prompt box.

## Routines

GhostShell runs the routines that Claude Desktop runs, so Desktop does not have to stay open for them. A
routine is a prompt file that Desktop keeps, `~/.claude/scheduled-tasks/<id>/SKILL.md`, which GhostShell reads
and never writes, and a schedule that GhostShell keeps in `routines.json` in its state folder. GhostShell has to be
running when a routine is due, which is what the launchd agent under "Always on" is for.

- **Seeding.** Desktop's own schedule file is internal to it and has no jitter in it, so the schedules
  are exported once from Desktop to a JSON file with a `routines` list. Each entry has an `id`, `title`,
  `cron`, `jitterSeconds`, `file`, `cwd`, `model`, `effort`, `mode` and `enabledInDesktop`.
  `npm run seed-routines -- <export.json>` copies them into `routines.json`, every one switched off, and
  prints when each would fire next. Run it again with a newer export to add routines that are new. The
  ones already there are left as they are, apart from `enabledInDesktop`. GhostShell reads `routines.json`
  on every check, so a seed run or a hand edit shows without a restart. GhostShell writes the file too, so
  reload it before a hand edit.
- **Switching over.** A routine runs in GhostShell only once it is switched on here, so switch it off in
  Desktop first, or both apps run it. Switching on counts the schedule from that moment, so a fire time
  earlier in the day is not run on top of Desktop's own run.
- **When it fires.** The schedule is a five-field cron in the Mac's time zone, which GhostShell follows if it
  changes, with the routine's jitter added as a fixed offset, as Desktop does it: `30 7 * * 1-5` with 737
  seconds of jitter fires at 07:42:17. GhostShell checks every 30 seconds, and once when it starts. A routine
  that is due starts a new session in its folder with its permission mode, model and effort. The first
  message is Desktop's: the text of `SKILL.md` after its frontmatter, inside the same `<scheduled-task>`
  wrapper. The file is read afresh at each run, so an edit applies at once.
- **Missed runs.** If GhostShell was not running at a fire time, the latest missed fire runs once as soon as
  GhostShell is up, provided it is under 12 hours late. A later one is skipped and logged. However many fires
  were missed, that is at most one run.
- **One at a time.** A fire that comes while the routine's previous run is still working is skipped and
  logged, not held over until it ends. A previous run that is only waiting for an answer is stopped, and
  the new run starts in its place.
- **Three at once.** At most three routines run at the same time, as in Desktop, so fewer of them fight
  over one Chrome. A fourth that comes due waits for a free place, and starts as soon as one frees up. A
  run waiting for an answer does not take a place. Run now ignores the limit.
- **Restarts.** `routines.json` records when each routine was switched on and last ran, and the next
  fire is worked out from that. A restart does not repeat a run, and a run that came due while GhostShell
  was down is caught up as above. A restart can cut a run in progress short, and GhostShell does not start
  that run again. A run that cannot start is recorded in `lastError` and waits for the routine's next
  fire.
- **A wrong file.** GhostShell runs nothing while `routines.json` cannot be read, has a routine with no id, or
  has an id twice, which is what a copied entry with its id left alone looks like. `GET api/routines` says
  which, and GhostShell logs it once on stderr. An `enabled` that is not `true` or `false` counts as off.
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
  in, so keep anything private out of that folder. `public/login.js` and `public/ui/webauthn.js` run on the
  sign-in page, so they import nothing beyond each other.

## Run it

```bash
npm run set-password
node server.mjs
```

There are no npm dependencies (Node 20 or later), and the page's libraries are vendored. `npm test` runs
the unit tests, for the cron parser, the routine scheduler, the start timeout, the transcript parser, the
live work tracker, the messages the CLI holds, the thread display, the order of a group, the layout file, the
project and group routes, the arrow-key and move rules of the sidebar tree, which view of the list holds a
session, what a view's lamp and count show and which views a search finds, the session list and what a
message does to it, the sign-in and the passkey checks, with Node's own test runner. The tests of the model menu
in a page run it in Playwright's Chromium headless shell, the newest in Playwright's cache or the one that
`CAPCOM_BROWSER` names, and skip when there is none. The password is kept only as a
scrypt hash in `~/.config/capcom/auth.json`, and setting a new one signs every browser out and removes every
passkey. Until one is set, GhostShell refuses every request.

A browser that signs in stays signed in while it is used at least every 90 days, for up to a year from the
sign-in. Each day it is used, GhostShell pushes the expiry 90 days out, but never past a year after the sign-in,
and sends the cookie again with the time that is left. Every sign-in records when it was made, when it was
last used and a short device label such as "Chrome 155 on macOS".

Passkeys are the second way in. A passkey signs you in with a fingerprint, face or screen lock, and the
password keeps working beside it. After a password sign-in the page offers once to add one, and Passkeys in
the footer of the session list adds, lists and removes them. Browsers offer passkeys only on an https
address or on localhost, so http://localhost:4310 works as it is, and a remote address needs https and an
entry in `passkeyOrigins` (see "Remote access"). GhostShell keeps the public keys in `passkeys.json` in its state
folder. `npm run set-password` signs every browser out and removes every passkey, so a passkey added with a
stolen cookie cannot outlast a reset. Add yours again once you have signed in with the new password. To end
one passkey, remove it under Passkeys and delete it from the device or password manager that holds it as well.

GhostShell has a web app manifest, so Chrome or Safari can install it as an app of its own, with its own
window and Dock icon. Window managers then see it as its own app rather than as the browser. On the Mac,
install it from http://localhost:4310, because Chrome only offers Install on a secure address, and it
treats localhost as one.

## Configuration

`config.json` holds the defaults: the port, the `claude` command, the folders GhostShell reads and the
timeouts. To change a value on one machine, put it in `config.local.json` in the repo root. That file is
optional and git-ignored, and its values replace the ones in `config.json`.

```json
{ "station": "studio", "claude": "/usr/local/bin/claude" }
```

- `station` is the machine name shown in the header of the session list. It defaults to the short hostname.
- `claude` is the CLI to run. It defaults to `claude`, found on `PATH`.
- `chrome` is `true` by default. Set it to `false` to start every session without Claude in Chrome.
- `desktopHandoff` is `false` by default. Set it to `true` to hand new sessions to Claude Desktop (see
  "Things to know"). Turning it on also hands over, the next time GhostShell starts, every session started
  here that Desktop does not have yet.
- `passkeyOrigins` is a list of the https addresses that may use passkeys, empty by default. Write each
  entry as the browser shows the address, such as `https://capcom.example.com` or
  `https://capcom.example.com:8443`, with no path. `http://localhost:<port>` needs no entry and works for a
  browser that opens it directly. GhostShell ignores an entry that is not https or that is an IP address, and says
  so on stderr. Keep your real addresses in `config.local.json`.

Three environment variables win over both files. `PORT` sets the port, `CAPCOM_CLAUDE` sets the CLI,
and `CAPCOM_STATE` points a test instance at its own login, registry and routines. Two instances that
share a state folder both fire its routines, so always give a test instance its own.

## Always on

On macOS, a launchd agent starts GhostShell at login and restarts it if it stops. It runs the server through
Capcom.app, a small app this folder builds, so that macOS asks about permissions for the app. The app keeps
the name Capcom, so macOS lists it as Capcom.

```bash
npm run build-app
open ~/Library/Application\ Support/Capcom/Capcom.app
npm run install-agent
```

macOS asks before a process reads the calendar, opens the Desktop, Documents or Downloads folder, or
controls another app, and it asks about the app at the root of the process tree. Under launchd alone that
root is node, which has no permissions and none of the reason strings macOS shows when it asks, so a
session's calendar read fails. The app's executable runs the server as its child and stays its parent, so
the server and every session under it count as Capcom.

`npm run build-app` builds the app with Swift, from the Xcode command line tools, into
`~/Library/Application Support/Capcom/`. Opening it asks for full calendar access, the three folders, and
control of Calendar and Google Chrome if they are open. Click Allow on each. The answers show under Capcom
in System Settings, in Privacy & Security, and a session that later needs something else gets macOS's
usual question, naming Capcom. Use `npm run build-app -- --id com.example.capcom` for a bundle id of your
own. The app's signature is ad hoc, so macOS ties the answers to that exact build. After a rebuild, open
the app again and restart the agent.

`npm run install-agent` fills in `launchd/capcom.plist.template` with the app (when it is built), your Node
binary, this folder, your home folder and the folder that holds `claude`. It writes
`~/Library/LaunchAgents/local.capcom.plist`, creates `~/Library/Logs/capcom/` for the logs, and prints two
`launchctl` commands. You run those yourself:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.capcom.plist
launchctl kickstart -k gui/$(id -u)/local.capcom
```

Use `npm run install-agent -- --label com.example.capcom` for a different label. Run the installer
again after you move the folder or change Node versions, because the plist stores both paths.

## Remote access

GhostShell binds to 127.0.0.1 only, so no other device can reach it directly. To use it from a phone or
another computer, put a reverse proxy or a private network you trust in front of it.

It works when mounted under a sub-path such as `/chat`. Every URL in the page is relative, and the
page adds its own trailing slash. The proxy must strip the prefix before the request reaches GhostShell.

If the proxy ends https, it must send `X-Forwarded-Proto: https`, which nginx does with
`proxy_set_header X-Forwarded-Proto $scheme;`. GhostShell then adds `Secure` to the sign-in cookie. It also takes a
write only when the page's address, in the `Origin` header, matches the `Host` and the scheme of the request.
A proxy that ends https and leaves the header out, or that does not pass the original `Host` on
(`proxy_set_header Host $host;` in nginx), gets a 403 on every write, sign-in included. GhostShell believes the
header only on a connection from this Mac (127.0.0.1 or ::1), so a client that reached GhostShell some other way
could not switch `Secure` on. GhostShell listens on 127.0.0.1 only, so the test passes for every connection today.
An http address keeps working, because it sends no such header. The cookie is also `HttpOnly` and
`SameSite=Lax`, so a signed-in browser that follows a link to GhostShell from another website arrives signed in,
and the cookie is not sent with a form or script request from that website.

The browser keeps each picture it has shown for a year, so a chat opens fast. A picture comes with
`Vary: Cookie`, so the browser reuses its copy only while it holds the sign-in cookie it fetched the picture
with. Once Sign out has cleared that cookie, or the cookie has run out, opening a picture's address asks GhostShell
again and gets a 401. Sign out also sends `Clear-Site-Data: "cache"`, and Chrome and Edge, and Firefox from
version 138, then delete their copies, at an https address or at localhost. Safari 27 keeps its copies, and so
does any browser at a plain http address, but neither shows one without the cookie. After a new password ends
every sign-in, a browser keeps its old cookie until it signs in again, and until then it can show a picture it
kept. Sign out clears that cookie too, but only from a tab that has not yet gone back to the sign-in page.

Passkeys need an https address. A phone that reaches GhostShell over plain http, as on a private network without
https, signs in with the password only, and the sign-in page says why. To use passkeys remotely, serve
GhostShell over https and list the address in `config.local.json`:

```json
{ "passkeyOrigins": ["https://capcom.example.com"] }
```

Restart GhostShell after a change. A passkey belongs to a host name, so one made on `capcom.example.com` does
not work on another name. An IP address cannot have passkeys, which includes http://127.0.0.1:4310, so use
localhost there. GhostShell believes the localhost address only for a request that reaches it as localhost, with no
`X-Forwarded-*` or `Forwarded` header, so a proxy cannot hand it to a page on another device.

A message with images can be about 53 MB, because the page sends them as base64 inside the request. The
proxy has to let a request that large through, and nginx, for one, refuses more than 1 MB until
`client_max_body_size` says otherwise. GhostShell itself takes that size only on the routes that send a message
or start a session, and keeps 1 MB on every other route.

The password, and any passkey you add, is the only thing between that address and a shell on this machine.
Anyone who signs in can run commands as you. GhostShell locks sign-in for 15 minutes after ten failed tries with
the password or a passkey. Pick a long password and keep the address private. A lost phone stays signed in
until 90 days after its last use, or a year after its sign-in if that comes first, so set a new password with
`npm run set-password`, which signs every browser out and removes every passkey.

## License

MIT, see [LICENSE](LICENSE). The libraries in `public/vendor/` keep their own licenses, MIT for Preact and
Apache-2.0 for htm, which sit next to them.
