# Pick the model, effort and fast mode from one menu, with the models read from the CLI

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-22
- Tags: ui, cli, prompt box, models, effort, fast mode, keyboard, accessibility

## Context and Problem Statement

Capcom's prompt box had a model picker and an effort picker, each a hidden native select. The models were a short list held in the page, which went stale as models came and went, and nothing switched fast mode. Claude Desktop shows one button with the model and the effort, and a menu behind it: the main models, an Effort submenu, a More models submenu and a Fast mode switch. The owner asked for the same menu in Capcom.

The models a chat can use depend on the CLI and the account, and a new session has no CLI process until its first message. Where should the models beyond the main four come from, how should fast mode be switched, and what should the menu do with a model or effort that none of its lists holds?

## Decision Drivers

- The menu should offer the models the CLI offers, with no list in the page to drift from it.
- A new session needs the models before its first message, and getting them must not write a session, start MCP servers, run hooks or call a model.
- Fast mode belongs to one chat. It has to be possible to turn it off again, and a chat must not start in fast mode unless it was picked.
- A page on another site must not be able to start a CLI process through Capcom.
- The menu and the button must always say what the chat is on, including a model or effort that Desktop recorded and the CLI does not list.
- The menu should use Desktop's names and shadcn/ui's dropdown menu, and work with a keyboard, a screen reader and a phone.

## Considered Options

1. Keep the four main models in the page, read the rest from the CLI's `initialize` reply, and switch fast mode per chat with `apply_flag_settings`
2. Keep every model in the page
3. Pass fast mode to the CLI in `--settings` when its process starts

## Decision Outcome

Chosen option: "Keep the four main models in the page, read the rest from the CLI's `initialize` reply, and switch fast mode per chat with `apply_flag_settings`", because it is the only one that shows the CLI's own models before the first message, and the only one found that turns fast mode off again after it was on.

- **The button.** One button on the right under the box names the model, then `Fast` while fast mode is on and the model takes it, then the effort in muted text, then a small warning triangle when the effort is Max. Its accessible name begins with those words. It reads `Model` and is disabled until the chat's status arrives.
- **The menu.** From the top: Opus 5.5, Fable 5.1, Sonnet 5.5 and Haiku 5.5 as radio items. Keys 1 to 4 pick them while the focus is in this list. Each row shows its key at the right, and the model in use shows a check there instead. Then Effort, which opens Low, Medium, High, Extra and Max. Extra is `xhigh`, as Desktop names it, and Max carries the warning icon and Desktop's tooltip about excessive tokens. Then More models, which opens Opus 5.5 (1M) and every other model the CLI lists, in the CLI's order. The CLI lists no `[1m]` model, so Capcom adds `claude-opus-5-5[1m]`, which its `set_model` accepts. A model that takes fast mode adds a Fast mode group with an Enable fast mode switch. Picking a row or the switch closes the menu and hands the focus back to the button, as Radix's menus do. Picking the checked row changes nothing. When the CLI's list arrives and adds rows, the focus stays on the row it was on. On a phone a submenu opens on a tap. The switch has the `menuitemcheckbox` role, because a menu may only own menu items and an `aria-required-children` check fails a `switch` inside a `menu`.
- **The four, and the rest.** The four names and ids are Desktop's catalog and stay in the page. Capcom reads the rest from the CLI's list, by full id, each id once. The CLI names the main four only by alias (`default`, `opus`, `sonnet` and the others), so an alias stands for the model it resolves to when no entry lists that model by id, and its flag says whether the model takes fast mode. On CLI 2.1.307 that flag is on for Opus 5.5 and off for the other three.
- **The list.** The CLI's reply to `initialize` carries `models` beside `commands`, and each has its id, display name and whether it takes fast mode. A running chat keeps the list its own process gave. A new session, or a chat with no process, gets the short folder probe of [the / list](20261022-slash-menu-from-the-cli.md), whose one reply now holds both lists, so one process serves the / list and the model menu. `POST /api/models` takes `{ id }` or `{ cwd }` as `/api/commands` does, and the page asks when the menu opens and reuses an answer for a minute.
- **What the menu never hides.** A model or effort that neither list holds, such as one Desktop recorded or an alias like `opus[1m]` from the user's settings, gets a checked row of its own at the end of More models or of the effort list, so the menu and the button say what the chat is on. Capcom matches the chat's own model by exact id and leaves an alias it is set to as it is, since resolving one is the CLI's job. When Claude refuses a pick, Capcom answers with the chat's status, so the page does not undo a later pick that went through. Until the CLI's list arrives only Opus 5.5 is known to take fast mode, and afterwards the list's own flag decides.
- **Fast mode.** It is a setting of one chat, switched as the effort is, with the `apply_flag_settings` control request: `{ settings: { fastMode: true } }`, or `false` to turn it off. A chat with a process gets it at once, and one without keeps it for its next process. Capcom saves it in `picks.json` with the model and effort. When a chat starts with fast mode picked, Capcom sends the request right after `initialize` and reads the answer when it comes. While a process starts, the status shows fast mode off until the CLI accepts the request, and then it shows the pick. A chat with no process shows the pick. The answer carries no fast mode state, and a model that cannot take fast mode is answered with success. The CLI reports `fast_mode_state` instead, as `'on'`, `'off'` or `'cooldown'`, on the `system` `init` message of each turn and on each `result`. Cooldown is fast mode paused after a rate limit, and it comes back by itself. The status follows each turn's report and counts cooldown as on. On CLI 2.1.308 an `'off'` with the `fast_mode_disabled_reason` `'pending'`, `'network_error'` or `'unknown'` can still turn on later in the same process, so it settles nothing and the status shows the pick. An `'off'` with any other reason, or none, turns the status off. The status goes back to the pick after a change of model or of fast mode, since what the CLI reported was about the model before, and when the chat has no process. The answer and the reports apply in the order Capcom reads them, so a report that comes before the answer gives way to the acceptance and one that comes after it wins. A refusal turns fast mode off for the chat and in `picks.json`, for a new session as for one that is resumed, so the next process does not ask again. No answer, and a report of `'off'`, leave the pick as it is, so the next process asks again. The page keeps its own `fast` when it applies the status that a send answers with, because each change of fast mode reaches it over the event stream and the answer can be older. Capcom never passes `fastMode` in `--settings` when it starts the process. On CLI 2.1.307 a value given there could not be turned off again, because `apply_flag_settings` with `false` or `null` left it on. Without the request a headless CLI reports `fast_mode_disabled_reason: 'sdk_opt_in_required'`. With it an Opus 5.5 chat reports `fast_mode_state: 'on'` and a Haiku chat `'off'`, since Haiku does not take fast mode. Capcom's Chrome `permissions.ask` rule, passed with `--settings`, survives both requests.

### Consequences

- ✅ The menu offers the models the CLI offers, so a new model shows up with no change to Capcom, and the probe that gives the / list gives the models too.
- ✅ Fast mode can be switched on and off for one chat, and it survives the idle stop and a restart until the CLI refuses it.
- ✅ The button and the menu always say what the chat is on.
- ✅ The status shows fast mode off while a process starts, until the CLI accepts the request, and the page is told when a refusal or a turn's report changes it.
- ❌ `initialize` with its `models`, and `apply_flag_settings` with `fastMode`, are the Agent SDK's contract with the CLI, not a published one, so a CLI update could change them. If the reply has no models, More models holds only Opus 5.5 (1M), and a failed ask shows its reason in a disabled row.
- ❌ `fast_mode_state` on the `init` message and the `result`, and the `fast_mode_disabled_reason` beside it, are no published contract either. If a CLI stops sending them, the status shows the pick once the request has been accepted. A new reason that clears by itself counts as a settled off until it is added to the three.
- ❌ The button drops `Fast` for a moment each time a chat's process starts, until the CLI has accepted the request.
- ❌ While a turn reports fast mode off, the switch shows off even though the pick holds, and the next process asks for it again.
- ❌ The models are asked for when the menu opens, so the word `Fast` on the button for a CLI-listed Opus model other than Opus 5.5 shows only after the menu has been opened once.
- ❌ A chat's fast mode stays set while a model that cannot take it is in use. The button and the menu hide it, and it applies again when a model that takes it is picked.

## Pros and Cons of the Options

### Keep the four main models in the page, read the rest from the CLI's `initialize` reply, and switch fast mode per chat with `apply_flag_settings`

- ✅ The first four are the choice Desktop puts first, with its names and the keys 1 to 4, and the rest follows the CLI.
- ✅ The same reply and probe as the / list, so no new process.
- ❌ Relies on control requests and a reply that the CLI does not document.

### Keep every model in the page

- ✅ No process to start, and the list shows at once.
- ❌ Goes stale each time the models change, and cannot know which models take fast mode.

### Pass fast mode to the CLI in `--settings` when its process starts

- ✅ `--settings` is a documented flag, and nothing has to be sent after `initialize`.
- ❌ On CLI 2.1.307 a value given there cannot be turned off later, and it cannot change for a process that is already running.

## Links

- Builds on [List a chat's skills and commands under / from the CLI's own list](20261022-slash-menu-from-the-cli.md), whose `initialize` reply and folder probe now give the models too
- Builds on [Match Desktop's flow for new sessions, settings, stopping and tool calls](20261014-desktop-like-prompt-box-flow.md), which put the model and effort under the box and sent a change as a control request
- Follows [Build Capcom's look and behaviour on shadcn/ui](20261022-shadcn-design-language.md) for the menu
