# Offer Claude in Chrome as a guarded per-chat switch

- Status: Superseded by [Claude in Chrome on by default](20261015-claude-in-chrome-on-by-default.md)
- Deciders: Eli
- Date: 2026-10-07
- Tags: chrome, permissions, tools, security

## Context and Problem Statement

The CLI can drive the owner's real Chrome, with the owner's signed-in sessions, when it starts with `--chrome`. The owner wanted that in Capcom. Chrome acts in a browser that holds the owner's logins, so each action should reach an approval card the owner sees.

Settings can pre-allow Chrome tools, and a pre-allowed call skips the approval card. The design also assumed that Bypass and Auto let Chrome actions through without asking.

## Decision Drivers

- Each Chrome action should reach an approval card.
- Pre-allowed Chrome tools must not skip the card.
- Chrome drives a browser with the owner's logins.

## Considered Options

1. A per-chat switch, off by default, refused in Bypass and Auto
2. A plain per-chat switch, with no guard beyond the CLI's own modes

## Decision Outcome

Chosen option: "A per-chat switch, off by default, refused in Bypass and Auto", because Chrome needs guards of its own in Capcom. Pre-allowed tools, and the Bypass and Auto modes as the design understood them, would otherwise let Chrome actions through without a card.

- A Chrome switch in the chat header, and a checkbox on the new-session form, turned Chrome on for one chat.
- Capcom started the CLI with `--chrome` and `--settings '{"permissions":{"ask":["mcp__claude-in-chrome"]}}'`, so even pre-allowed Chrome tools asked.
- Capcom refused to start Chrome in Bypass or Auto, and refused a switch into either mode while Chrome was on.
- Chrome cards had no Always allow.

**Superseded 2026-10-15.** On CLI 2.1.300, checked on 15 Oct, the ask rule beats the permission mode, so Chrome asks in Bypass and Auto as well. The premise behind refusing those modes was wrong. Commit `4fcf715` removed the refusals.

### Consequences

- ✅ Each Chrome action showed a card.
- ❌ When Desktop's mode for a folder was Bypass, new sessions there started in Bypass and the Chrome switch was unavailable until the mode changed.
- ❌ Chrome behaved differently from Desktop, where it is on in all modes.

## Pros and Cons of the Options

### Guarded per-chat switch

- ✅ A card for each Chrome action
- ❌ Chrome unavailable in Bypass and Auto, and off until switched on

### Plain per-chat switch

- ✅ Simpler to build and to use
- ❌ Pre-allowed tools would skip the card, and the design assumed Bypass and Auto would too

## Links

- Superseded by: [Claude in Chrome on by default](20261015-claude-in-chrome-on-by-default.md)
- [Settings follow Claude Desktop](20261008-settings-follow-claude-desktop.md), which made Bypass the default mode for new sessions in some folders
