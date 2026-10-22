# Build Capcom's look and behaviour on shadcn/ui

- Status: Accepted, amended 2026-10-22
- Deciders: Eli
- Date: 2026-10-22
- Tags: ui, design, css, accessibility, fonts, keyboard

## Context and Problem Statement

Capcom's look grew one screen at a time, with its own token names and a blue-tinted palette. Eli asked for Capcom to look and behave like an app built from [shadcn/ui](https://ui.shadcn.com): its colours, radius, borders, shadows, focus ring, type, spacing and component states, and the [Radix](https://www.radix-ui.com/primitives) behaviour behind its menus, dialogs, command palette, sheet, tooltips and toasts, in light and dark, on a desktop and on a phone.

shadcn/ui ships React components styled with Tailwind. Capcom has no build step and runs [Preact with htm](20261015-preact-htm-front-end.md) from plain files. How can Capcom follow shadcn/ui without React, Tailwind or a build?

## Decision Drivers

- Someone who knows a shadcn/ui app should see one in Capcom: the same tokens, recipes and states.
- Keyboard and focus should behave as Radix does, since that is much of how a shadcn/ui app feels.
- No build step, no new runtime dependency, and nothing loaded from another host.
- A widget written for Claude Desktop must still draw the same, so the widget frame keeps Desktop's variable names ([widgets ADR](20261019-widgets-render-like-desktop.md)).
- Capcom is public under the MIT licence, so what it takes from shadcn/ui has to be under a compatible licence and credited.

## Considered Options

1. Port shadcn/ui's new-york-v4 styles and Radix's behaviour to plain CSS and small Preact modules
2. Add Tailwind, React and shadcn/ui's components behind a build step
3. Keep Capcom's own design and borrow a few details from shadcn/ui

## Decision Outcome

Chosen option: "Port shadcn/ui's new-york-v4 styles and Radix's behaviour to plain CSS and small Preact modules", because it gives Capcom shadcn/ui's look and keyboard behaviour and keeps the no-build, no-dependency rule.

- **Tokens.** `public/app.css` defines shadcn/ui's token names on `:root` with the values of its new-york-v4 neutral theme: `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, the `--sidebar-*` set, `--radius` (0.625rem) with its `sm` to `xl` steps, and Tailwind's shadow scale. The dark values sit under `prefers-color-scheme: dark`, so Capcom follows the system setting and has no toggle. Capcom's old token names are gone. shadcn/ui has no status colours, so Capcom adds `--success` and `--warning`, each with a `-foreground` and a `-muted`.
- **Type.** Geist and Geist Mono, the fonts of shadcn/ui's own site, are vendored in `public/vendor/` under the SIL Open Font Licence 1.1.
- **Scale.** On a fine pointer the root font size is 15px, because Geist renders about 6% wider than Desktop's font at the same size, and every rem follows it. The rem media queries do not, so the 48rem and 56rem breaks stay where they were. The chat column is 47rem and the list 25.5rem there, which at 15px are 705px and 382.5px, to match Desktop. A session row is one line 1.75rem tall, on Desktop's 28px pitch: the title at the left, the status dot at the right end, and the folder, branch, state and last activity in the row's tooltip. A row whose turn is running adds how long the turn has run, just left of the dot, and left of the fold arrow on a parent's or a routine's row. Desktop's rows show only the dot, so the time is Capcom's own addition. The dots button takes the dot's place only on a mouse in a window at least 48rem wide, while the pointer is over the row or the focus is in it, and the time stays where it is. Below that width, or with no hover, the dot, fold and dots all show. A touch screen has no tooltips, so it keeps the 16px root, 2.75rem targets and the two-line row, with that detail on the second line, the dot and buttons always showing, and the time at the end of the title line.
- **Components.** Each shadcn/ui component becomes one class, with its variants and sizes as data attributes, for example `<button class="btn" data-variant="outline" data-size="icon-sm">`. The CSS carries the Tailwind classes of the matching file in shadcn/ui's `apps/v4/registry/new-york-v4/ui/` over into plain rules: button, input, input group, kbd, badge, dropdown and context menu, command, dialog, alert dialog, sheet, sidebar, card, empty, tooltip and Sonner's toast. A group's header goes further than the sidebar's grey group label, which Desktop's labels look like too. Eli found those labels easy to miss, and on a phone they matched a row's second line. So a group's name is semibold in the sidebar's text colour, its count stays grey, and a 1px line in `--sidebar-border`, as shadcn/ui's sidebar separator draws, sits above each group after the first. Focus shows shadcn/ui's ring: a `--ring` border with a 3px ring at half strength. The transcript follows shadcn's chat examples: the owner's words sit in a muted bubble, Claude's text is plain, and tool rows are muted until they open. Sign-in and setup are shadcn's login card.
- **Behaviour.** `public/ui/menu.js` and `public/ui/menu-rules.js` give every popup menu Radix's dropdown and context menu behaviour: the page under an open menu takes no press, arrow keys stop at the ends, Home, End and typeahead work, Move to is a submenu, a right click or a long press opens the menu at the pointer, and the focus goes back to the button that opened it. `public/ui/dialog.js` and `public/ui/layer.js` do what Radix's dialog does for the search, every question and the projects sidebar, which is a sheet below 56rem: the page behind is locked and hidden from a screen reader, Tab stays inside, Esc closes only the top layer, and the focus goes back to what had it. The search keeps cmdk's keys. `public/ui/toast.js` shows notes as Sonner does, for 10 seconds with Undo and 6 without. `public/ui/tooltip.js` gives each icon-only button shadcn/ui's tooltip, with its shortcut in a `kbd`. A tooltip opens with no delay on the first pointer move over its button or on keyboard focus, and never for a touch. A session row's tooltip is the exception. It opens on the right of the row, or on the left when the window has no room there, 700ms after the pointer reaches the row, which is Radix's own delay, at once if another tooltip closed in the last 300ms, and at once on keyboard focus.
- **Motion.** Buttons and rows change colour over 150ms and a chevron turns over 200ms, as shadcn/ui's classes do. Menus and dialogs fade and zoom in, and the sheet slides in from the left. When the system asks for less motion, Capcom drops these transitions.
- **Widgets.** `public/ui/widget-theme.js` keeps Desktop's variable names (`--surface-1`, `--text-primary` and the rest) and maps their values to the tokens above. `--fill-accent` takes the value of `--primary`.

### Consequences

- ✅ Capcom reads as a shadcn/ui app, and the next screen has a reference to copy: the matching file in shadcn/ui's registry.
- ✅ No build step, no new dependency, and every file still comes from Capcom's own host.
- ✅ On a mouse the list is as dense as Desktop's, with rows 28px apart where they were 48px.
- ❌ Someone has to copy each change by hand. An update to shadcn/ui reaches Capcom only when someone ports it.
- ❌ Capcom re-implements Radix's behaviour, so it can miss edge cases Radix covers.
- ❌ A widget's accent is near black in light and near white in dark, where it was blue, because shadcn/ui's accent is its primary colour.
- ❌ Widgets draw in the system font. The frame's content security policy does not load Geist.
- ❌ On a mouse a row's folder, branch, state and last activity show only in its tooltip, so they appear after a pause where a touch screen shows them at once.
- ❌ A screen reader hears a row's state but not its run time, because the time changes every second and is hidden from it.

## Pros and Cons of the Options

### Port shadcn/ui's new-york-v4 styles and Radix's behaviour to plain CSS and small Preact modules

- ✅ Matches shadcn/ui's look closely and keeps Capcom's plain files.
- ❌ The port drifts from shadcn/ui until someone updates it.

### Add Tailwind, React and shadcn/ui's components behind a build step

- ✅ The real components, with updates a command away.
- ❌ Needs a build step, React, Tailwind and Radix, which the [no-build decision](20261007-no-dependencies-no-build-step.md) rules out.

### Keep Capcom's own design and borrow a few details from shadcn/ui

- ✅ The least work.
- ❌ Leaves Capcom's look where it was, which is not what Eli asked for.

## Credits

shadcn/ui is copyright (c) 2023 shadcn and published under the [MIT licence](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md). Capcom's CSS follows the class recipes and token values in its new-york-v4 registry. No shadcn/ui code ships in Capcom. Radix Primitives, also MIT, defines the keyboard and focus behaviour Capcom copies. Geist and Geist Mono are copyright Vercel under the SIL Open Font Licence 1.1, with the licence in `public/vendor/LICENSE-geist`.

## Links

- Refines [Preact with htm for the front end](20261015-preact-htm-front-end.md)
- Keeps the contract in [Draw widgets the way Desktop does](20261019-widgets-render-like-desktop.md)
- Amends the look in [Let groups sit under projects](20261016-projects-above-groups.md), whose sidebar became shadcn/ui's sidebar and sheet
- shadcn/ui: https://ui.shadcn.com
- Radix Primitives: https://www.radix-ui.com/primitives
- Geist: https://vercel.com/font
