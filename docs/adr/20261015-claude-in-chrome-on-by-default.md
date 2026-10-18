# Turn Claude in Chrome on by default in all chats and modes, as Desktop does

- Status: Accepted, amended 2026-10-15 and 2026-10-18
- Deciders: Eli
- Date: 2026-10-15
- Tags: chrome, permissions, bypass, tools

## Context and Problem Statement

Chrome was off until switched on, and Capcom refused it in Bypass and Auto. Wherever Desktop's default mode is Bypass, the switch stayed unavailable for new sessions. On 15 Oct the owner asked for Chrome to be on by default, as it is in Desktop.

On CLI 2.1.300, checked on 15 Oct, the injected ask rule beats the permission mode, so Chrome asks in Bypass and Auto too. The premise behind the old refusals was wrong.

Should Chrome ask in Bypass when it is on by default?

## Decision Drivers

- Desktop has Chrome on in all modes, and shows no Chrome cards in Bypass.
- Pre-allowed Chrome tools must still reach Capcom.
- A switch of mode must take effect without a restart.

## Considered Options

1. Match Desktop: Chrome on in all chats and modes, with Capcom answering in Bypass
2. On by default, with a card in all modes, Bypass included
3. On by default only in the modes that ask

## Decision Outcome

Chosen option: "Match Desktop", because Capcom can give the owner the same Bypass experience as Desktop, with no cards, while keeping a card in the modes that ask.

- Each chat starts with Chrome on. The `+` menu or the Chrome tag switches it off for one session, and Capcom saves the choice in `picks.json`.
- Capcom injects the ask rule into each process, so Chrome asks before each action, even ones a user's settings allow.
- In Bypass, Capcom answers Chrome's asks with allow, so no card shows. In Auto and the asking modes, a card shows. Capcom cannot run Auto's own safety check. Chrome cards have no Always allow.
- **Amended 2026-10-15.** The owner had the per-chat switch removed the same day. Chrome is always on, and the `chrome` setting in `config.json` turns it off for all of Capcom. Capcom ignores the per-session choices already saved in `picks.json`.
- Each process launches with `--allow-dangerously-skip-permissions`, so a chat can switch into Bypass mid-session. `setMode` waits for the CLI's reply and keeps the old mode if the CLI refuses the switch.
- **Amended 2026-10-18.** Desktop served Chrome from its own process as a server named "Claude in Chrome", so some older Desktop chats call it `Claude_in_Chrome`. Capcom draws those calls as Chrome. The ask rule, the allow in Bypass and the hidden Always allow still cover `claude-in-chrome` only. A chat Capcom runs cannot load Desktop's server: on CLI 2.1.302 its servers include `claude-in-chrome` and no `Claude_in_Chrome`, and no MCP config names one. Recheck this if a chat Capcom runs ever lists a server by that name. The runner now tells the page whether a card may offer Always allow, so the page keeps no copy of the Chrome prefix.

### Consequences

- ✅ Chrome is available in all chats and modes, and Bypass behaves as it does in Desktop.
- ✅ Because the rule stays on in Bypass, a switch to a stricter mode applies at once.
- ❌ Auto shows a card for each Chrome action, because Capcom cannot run Auto's own safety check.
- ❌ The design rests on how CLI 2.1.300 ranks an ask rule against a mode. Recheck it after CLI updates.

## Pros and Cons of the Options

### Match Desktop

- ✅ Same Bypass behaviour as Desktop, and an instant mode switch
- ❌ Capcom, not the owner, answers Chrome's asks in Bypass

### On, with a card in all modes

- ✅ The owner sees each Chrome action
- ❌ Cards in Bypass, which Desktop does not show

### Only in asking modes

- ✅ The smallest change from the guarded switch
- ❌ Leaves Chrome unavailable wherever the default mode is Bypass

## Links

- Supersedes: [Claude in Chrome guarded switch](20261007-claude-in-chrome-guarded-switch.md)
- [Settings follow Claude Desktop](20261008-settings-follow-claude-desktop.md)
