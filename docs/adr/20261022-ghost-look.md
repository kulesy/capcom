# Offer a Ghost look beside the standard one, switched per device

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-22
- Tags: ui, design, css, accessibility, motion

## Context and Problem Statement

Eli asked for a design of Capcom's interface inspired by the Ghost in Destiny: a shell of faceted plates around one glowing eye. Capcom's look is [shadcn/ui](20261022-shadcn-design-language.md), and it should stay the look anyone gets by default. An earlier try at a Destiny-inspired design replaced Capcom's whole look, and Eli moved to shadcn/ui after it. The first Ghost look had a cyan eye and greys tinted blue, and Eli asked for black, white and grey instead. Its first shell was four grey plates turned like a pinwheel, and Eli asked for a symmetric shell in black and white.

How can Capcom take on the Ghost's character as something Eli can switch on and compare, without losing shadcn/ui's structure, Desktop's scale or its accessibility, and without taking anything from the game?

## Decision Drivers

- The standard look stays the default and does not change. The Ghost look is a choice per device, quick to reach so the two can be compared.
- Only the skin changes. Structure, behaviour, keyboard use, focus, Desktop's scale and the row spacing stay as they are.
- Black, white and grey, with colour only where it marks a status.
- WCAG AA contrast in light and dark, and less motion when the system asks for it.
- Everything is original. No logos, glyphs, icons, screenshots, fonts or sounds from the game, nothing traced from its art, and nothing that suggests a tie to its makers. Capcom loads nothing from other hosts.

## Considered Options

1. A second look in its own stylesheet, scoped under an attribute on the root and switched per device
2. Replace the standard look with the Ghost look
3. A second set of colours only

## Decision Outcome

Chosen option: "A second look in its own stylesheet, scoped under an attribute on the root and switched per device", because it keeps the standard look exactly as it is and puts the whole Ghost look one press away.

- **The switch.** Ghost, a button in the list's footer beside Passkeys, turns the look on and off for this device. The choice is kept in the browser as `capcom.look`, as Capcom keeps its other display choices. A short script in `public/index.html` sets `data-look="ghost"` on the root element before the page paints, and swaps the browser's theme colour for Ghost's. A second marks the switch pressed in the copy of the list that shows while the app loads. Sign-in and setup keep the standard look.
- **The stylesheet.** `public/ghost.css` loads after `public/app.css`. Every rule in it that changes the look sits under `[data-look="ghost"]`, and the one rule outside it hides the shell drawings in the standard look. It gives shadcn/ui's token names Ghost's values and restyles a few components. Light and dark still follow the system.
- **Colour.** Black, white and untinted greys: graphite in dark and pale greys in light. The eye is the one light, near white in a black socket. Its ink is near white in dark and graphite in light, so it shows on either page, and it colours what has the focus or marks progress: the focus ring, the context ring and the step lamps. A focused button's ring is the eye's ink at full strength, on a destructive button too. An invalid button's ring is the destructive colour at full strength. The focused transcript keeps its soft inset ring, with a 1px ring of the eye's ink inside it. Orange, red, blue and green keep their standard jobs (waiting, failure and danger, unread, and lines added) and are the only colours in the look, so no status rests on a shade of grey. `--success` takes the eye's ink, because Capcom uses it only for those marks, and `--success-foreground` stays green for text. Every text colour measures at least 4.5:1 on each surface it sits on, and every mark at least 3:1, in both schemes, and a test checks them, focus rings included.
- **Shape.** The shell's plates have cut corners, so the Ghost look cuts corners where the standard look rounds them: `corner-shape: bevel` on everything that takes the radius tokens, in browsers that support it (Chromium 139 and later). Other browsers get near-square corners. Circles stay round. The owner's message bubble cuts its top right corner deeper than the others.
- **Lamps and marks.** A status lamp becomes an eye: a bright core in a dark socket. It is a hollow ring in the muted text colour when the chat is idle, lit and breathing while it works, orange while it waits, and red when it failed. The breath is a white glow in dark and a graphite one in light, because a white glow does not show on a pale page. In the list, a running chat's mark is the same breathing eye and a chat that needs input gets the orange one. The unread and failed marks keep their standard look.
- **Menus.** A menu's item turns to light text on dark, or dark on light, when it has the focus. Its hint and value turn with it, dimmed on an ordinary item and at full strength on a destructive one, so they keep 4.5:1 on the red. Menus and dialogs carry a highlight along their top edge.
- **The shell.** `public/ui/shell.js` draws Capcom's own shell: four plates round an eye in a diamond, mirrored left to right and top to bottom, in a 24-unit box. The plates take the text colour, so the shell is black on a light page and white on a dark one, with a white eye in a black socket. It is the working spinner, which opens its plates, turns half round its eye and closes again. It is the mark beside Capcom's name, and the emblem in the empty pane, which floats and looks round every 12 seconds.
- **Type.** Geist stays. Group headers and menu section labels are uppercase with wide letter spacing, and nothing else is.
- **Motion.** Every Ghost animation runs only when the system has no wish for less motion. With less motion the spinner is a still shell with its eye lit.
- **Widgets** keep the standard colours, because the widget frame's palette has to match `--widget-card`.

### Consequences

- ✅ Eli can compare the two looks on any device with one press, and the standard look is unchanged.
- ✅ The Ghost look is one stylesheet, one drawing and one switch, so it is small to change or remove.
- ❌ Safari, which every iPhone browser uses, does not support `corner-shape` yet, so on a phone the corners are near square rather than cut.
- ❌ There are two looks to keep in step. A new component needs a check in the Ghost look too.
- ❌ Uppercase group names are wider, so a long name is cut off sooner.

## Pros and Cons of the Options

### A second look in its own stylesheet, scoped under an attribute on the root and switched per device

- ✅ The standard look cannot change by accident, because no Ghost rule applies without the attribute.
- ✅ The two looks can be compared side by side.
- ❌ Each Ghost rule has to win over app.css's, so a few selectors are longer than they would be in one stylesheet.

### Replace the standard look with the Ghost look

- ✅ One look to maintain.
- ❌ Throws away the shadcn/ui look, and leaves nothing to compare against.

### A second set of colours only

- ✅ The least work.
- ❌ Colour alone does not read as a shell. The cut corners, the eyes and the spinner carry the idea.

## Credits

The Ghost look is inspired by the Ghost in Destiny. Capcom has no connection with Bungie or Destiny, and nothing in the look comes from the game: the shell drawing, the palette, the shapes and the motion are Capcom's own, under its MIT licence. Geist is the font of the standard look, under the SIL Open Font Licence 1.1.

## Links

- Builds on [Build Capcom's look and behaviour on shadcn/ui](20261022-shadcn-design-language.md)
- Keeps the contract in [Draw widgets the way Desktop does](20261019-widgets-render-like-desktop.md)
- CSS `corner-shape`: https://drafts.csswg.org/css-borders-4/#corner-shaping
