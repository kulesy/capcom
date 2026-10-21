# Show Claude's live work from the CLI's stream, and ask the CLI for thinking summaries

- Status: Accepted, amended 2026-10-19 and 2026-10-21
- Deciders: Eli
- Date: 2026-10-16
- Tags: live-work, thinking, stream-json, status-line

## Context and Problem Statement

While Claude worked, Capcom showed a lamp beside the word "Working" and the reply text as it streamed. A turn at max effort can think for more than a minute, and the page learned of a tool call only from the transcript file, after the CLI had written the whole call. Desktop streams the thinking into a block you can read, shows each tool call as it starts and says what Claude is doing. On 16 Oct 2026 the owner asked for the same feedback.

The CLI's stream raises three questions. A headless CLI redacts thinking by default, so its `thinking_delta` events carry no text. The `thinking_tokens` messages are a running estimate. The exact output count arrives once for each API message, in `message_delta`. What should the page show, and which of these can it trust?

## Decision Drivers

- A number on the page has to be one the CLI reported, so that it never jumps back when the real count arrives.
- The status line should say what Claude is doing, not only that it is busy.
- The transcript stays the record, so nothing new is saved for live work.
- It has to read calmly in light and dark, with the page's existing variables and lamps.

## Considered Options

1. Track the work from the stream on the server, ask the CLI for thinking summaries, and show only exact token counts
2. The same, with the CLI's running thinking-token estimate shown live
3. Read live work from the transcript file
4. Keep the "Working" line

## Decision Outcome

Chosen option: "Track the work from the stream on the server, ask the CLI for thinking summaries, and show only exact token counts", because it gives Desktop's feedback from text and numbers the CLI really sent.

- **Tracker.** `lib/work.mjs` reads each message the CLI prints and returns `think` events (the text so far, and that a block ended) and `work` events. A `work` event is a snapshot: whether Claude is thinking or writing, the tool calls running with a short summary each, the output tokens of the replies finished this turn, and how long the turn has run. `Chat.status()` carries the same data, so a page opened mid-turn catches up and a reload keeps its timer. Nothing is saved. A subagent's own stream is ignored.
- **Summaries.** After `initialize`, Capcom sends a `set_max_thinking_tokens` control request with `thinking_display: 'summarized'`. The CLI then streams a summary as `thinking_delta` text and saves it in the transcript, so a later load shows the same Thought rows. A long thought arrives progressively, and a short one as one burst at the end of its block.
- **Thinking block.** It is open while it grows, scrolls inside itself and stays pinned to its bottom. It folds into a Thought row when its block ends. The saved row replaces it in one render once the transcript read returns that row. A thought among tool calls folds into the group.
- **Status line.** It names the step: the running tool with a short summary, "Running 3 tools" for several, otherwise Thinking, Writing or Working. Beside it are the time the turn has run, which ticks every second, and the tokens.
- **Tokens.** The sum of each finished reply's `output_tokens` from `message_delta`. A later count for the same message replaces the earlier one, and the sum is hidden at zero. It moves when a reply ends, so during a long thought the timer is the sign of life.
- **No text.** If the CLI sends no thinking text, no block appears and the status line says "Thinking" beside the timer.
- **Checked.** On CLI 2.1.301 with Haiku 5.5 only. In a probe of a redacted turn the estimate read 206 tokens where the final count was 83.

**Amended 2026-10-19.** The tracker also reads `loading_messages` from the partial input of a `show_widget` call while the call is written. A tool in a `work` event can then carry `loading`, a list of up to four phrases, each cut to one line of 80 characters with empty ones dropped. The tracker finds the key in the streamed input and reports a phrase only once its closing quote has arrived, so a phrase is never sent half written, and it reports again only when the list grows. A finished message supplies the same list for a CLI that streams no partial messages. The page shows the phrases in a placeholder where the widget will draw. See [Draw widgets the way Desktop does](20261019-widgets-render-like-desktop.md).

**Amended 2026-10-21.** The status line now reads as Desktop's does: three lamps that light in turn, then the time, the tokens and what Claude is doing, as in `2m 26s · 804 tokens · Thinking`. This replaces the Status line bullet above. The phrase names the kind of step ("Running a command", "Reading a file", "Running 3 tools"), and the detail it used to carry, such as `npm test`, moved to the last group of tool calls in a running turn. That group is a live row. Its title is the step Claude is on, its own timer counts from its first row, and four lamps turn where the chevron sits. A step with no detail to add reads as the status line does ("Running a command"). When the step changes, the old text fades out as the new text fades in, and the last step fades into the group's summary when the turn ends. A group that is first known to be running takes the step in place of its summary with no fade, because a chat opens on its rows before its status arrives and the summary would flash and fade for no reason. Every animation runs only when the visitor has not asked for reduced motion.

For a chat Capcom is not running, Desktop and a terminal send no stream, so `lib/outside.mjs` rebuilds the open turn from the transcript. The result holds what the page reads of a `work` snapshot (each pending call as its id and tool name, the tokens, and how long the turn has run) plus when the turn began. It carries no call summary and no app name, because the page reads neither. The events stream sends it with the first `status` and again as an `outside` event when its start, its tokens or its pending calls change. A chat Capcom is working on reports none, and `status.state` is left alone, because the composer's Stop and Esc rely on it and Capcom cannot stop another app's turn. The header lamp and the status line read the snapshot instead. A turn is open from its first entry until an entry ends it: a reply whose stop reason is not `tool_use` or `pause_turn`, an interrupt marker, the output of a local command, or a `turn_duration` entry. Until then each tool call is pending until a result clears it, and output tokens are kept for each message and not for each entry, because the CLI saves a message once for every block and repeats the usage on each. Entries from a side chain are skipped. A command run with `!` in a terminal, and the caveat the CLI writes before local command output, neither open a turn nor end one, because Claude never replies to them. A prompt (a user entry that answers no call) or a queued message starts a new turn when one is open and the prompt comes from another entrypoint, or more than the 10 minutes after the open turn's newest entry. An app that quit saves no ending, and the next prompt must not inherit that turn's start, tokens and calls. A reply or a result always continues the open turn. The turn belongs to the app whose entry opened it. The turn is shown as live when the transcript, or a file in the chat's `subagents` folder, was written in the last 10 minutes, and when its entrypoint is not `sdk-cli`. Capcom's own turns already show from the CLI's stream, and one cut off by a restart would otherwise look alive. A turn whose app quit saves no ending entry, so an age limit is the only way such a chat stops reading as working. The 10 minutes is a chosen limit. The agents' folder is read because an agent run can keep the main file still for minutes while the turn is alive, and it is looked at only when the main file is older than the limit, and at most once every 15 seconds. The reader keeps the byte offset it has parsed for each of the last 64 files, so the 1.5 second check parses only the lines added since. A first read goes back from the end of the file, as far as 16 MiB, to the last entry that ended a turn. Option 3 below stays rejected for Capcom's own chats. For the chats other apps run, the transcript is the only source there is. The rules follow the entries CLI 2.1.30x saves.

### Consequences

- ✅ The status line names the step, each tool shows when it starts, and a long thought can be read as it forms.
- ✅ Every number shown is one the CLI reported, so none jumps back.
- ✅ Nothing new is stored, and a restart loses only the live view.
- ✅ A chat that Desktop or a terminal runs shows the same line and live row as one Capcom runs.
- ❌ `set_max_thinking_tokens` with `thinking_display` is an Agent SDK control request, not a published contract. A CLI that drops it still works but shows no thinking.
- ❌ The text is a summary and not the model's own reasoning, and a short thought shows only at its end.
- ❌ The token count does not move during a long thought.
- ❌ A turn stopped mid-thought keeps none of that thought, because the CLI saves a block only when it ends.
- ❌ A model other than Haiku 5.5 may send no thinking text, and has not been tried.
- ❌ A chat another app runs shows no thinking text, and its tokens count only replies the app has saved, so they move when a step is saved.
- ❌ A call that waits for an approval in Desktop looks the same in the transcript as a call that runs, so the chat reads as running until the 10 minutes pass.
- ❌ A chat whose app quit in the middle of a turn reads as running for up to 10 minutes after its last write.
- ❌ A turn that began more than 16 MiB of transcript ago starts at the oldest entry the first read reaches, so its time is undercounted.
- ❌ A running group's timer compares the browser's clock with the transcript's times, so a device whose clock is off shows a shifted timer.

## Pros and Cons of the Options

### Track the work from the stream on the server, ask for summaries, show exact counts

- ✅ Uses events the CLI already sends with `--include-partial-messages`, and the same data feeds a first load and every later one
- ❌ One more request depends on the CLI's unpublished control requests

### The same, with the live estimate

- ✅ A number that moves every second
- ❌ The estimate disagrees with the final count, so the number would jump back when the reply ends

### Read live work from the transcript file

- ✅ No new request to the CLI
- ❌ A block reaches the file only when it is complete, and the page reads the file up to 1.5 seconds later, so a long thought could not be read as it forms and a tool call with long input shows late
- ✅ For a chat another app runs it is the only source, so the 2026-10-21 amendment reads it there

### Keep the "Working" line

- ✅ No work
- ❌ Nothing to read during a long thought

## Links

- [Drive each chat with a headless Claude Code process](20261006-headless-claude-cli-per-chat.md), whose control requests this adds one to
- [Match Desktop's flow](20261014-desktop-like-prompt-box-flow.md), whose grouped tool calls now take thoughts in
