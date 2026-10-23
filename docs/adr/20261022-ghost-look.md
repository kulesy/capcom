# Make Ghost the look on every device, in a stylesheet of its own

- Status: Accepted, amended 2026-10-23
- Deciders: Eli
- Date: 2026-10-22
- Tags: ui, design, css, accessibility, motion

## Context and Problem Statement

Eli asked for a design of Capcom's interface inspired by the Ghost in Destiny: a shell of faceted plates around one glowing eye. Capcom's look is [shadcn/ui](20261022-shadcn-design-language.md). An earlier try at a Destiny-inspired design replaced Capcom's whole look, and Eli moved to shadcn/ui after it. The first Ghost look had a cyan eye and greys tinted blue, and Eli asked for black, white and grey instead. Its first shell was four grey plates turned like a pinwheel, and Eli asked for a symmetric shell in black and white. It first shipped as a choice for each device, from a button in the list's footer. Eli then asked for it on every device and for the button to go.

How can Capcom take on the Ghost's character on every device, without losing shadcn/ui's structure, Desktop's scale or its accessibility, and without taking anything from the game?

## Decision Drivers

- Every device gets the Ghost look. There is nothing to switch and nothing kept in the browser, so no device is left on another look. The sign-in and setup pages keep the standard look.
- Only the skin changes. Structure, behaviour, keyboard use, focus, Desktop's scale and the row spacing stay as they are.
- Black, white and grey, with colour only where it marks a status.
- WCAG AA contrast in light and dark, and less motion when the system asks for it.
- Everything is original. No logos, glyphs, icons, screenshots, fonts or sounds from the game, nothing traced from its art, and nothing that suggests a tie to its makers. Capcom loads nothing from other hosts.

## Considered Options

1. A second look in its own stylesheet, scoped under an attribute on the root and set on every device
2. Replace the standard look with the Ghost look
3. A second set of colours only

## Decision Outcome

Chosen option: "A second look in its own stylesheet, scoped under an attribute on the root and set on every device", because it puts the whole Ghost look in one stylesheet over the shadcn/ui styles in `public/app.css`, which the sign-in and setup pages keep.

- **Every device.** `public/index.html` carries `data-look="ghost"` on its root element, so the app wears the Ghost look from the first paint on every device, whatever the browser has stored. Its theme colour metas hold Ghost's colours. Nothing is switched and nothing is kept in the browser, and a `capcom.look` left in storage by the earlier switch is never read. Sign-in and setup keep the standard look.
- **The stylesheet.** `public/ghost.css` loads after `public/app.css`. Every rule in it that changes the look sits under `[data-look="ghost"]`, and the one rule outside it hides the shell drawings in the standard look. It gives shadcn/ui's token names Ghost's values and restyles a few components. Light and dark still follow the system.
- **Colour.** Black, white and untinted greys: graphite in dark and pale greys in light. The eye is the one light, near white in a black socket. Its ink is near white in dark and graphite in light, so it shows on either page, and it colours what has the focus or marks progress: the focus ring, the context ring and the step lamps. A focused button's ring is the eye's ink at full strength, on a destructive button too. An invalid button's ring is the destructive colour at full strength. The focused transcript keeps its soft inset ring, with a 1px ring of the eye's ink inside it. Orange, red, blue and green keep their standard jobs (waiting, failure and danger, unread, and lines added) and are the only colours in the look, so no status rests on a shade of grey. `--success` takes the eye's ink, because Capcom uses it only for those marks, and `--success-foreground` stays green for text. Every text colour measures at least 4.5:1 on each surface it sits on, and every mark at least 3:1, in both schemes, and a test checks them, focus rings included.
- **Shape.** The shell's plates have cut corners, so the Ghost look cuts corners where the standard look rounds them: `corner-shape: bevel` on everything that takes the radius tokens, in browsers that support it (Chromium 139 and later). Other browsers get near-square corners. Circles stay round. The owner's message bubble cuts its top right corner deeper than the others.
- **Lamps and marks.** A status lamp becomes an eye: a bright core in a dark socket. It is a hollow ring in the muted text colour when the chat is idle, lit and breathing while it works, orange while it waits, and red when it failed. The breath is a white glow in dark and a graphite one in light, because a white glow does not show on a pale page. In the list, a running chat's mark is the same breathing eye and a chat that needs input gets the orange one. The unread and failed marks keep their standard look.
- **Menus.** A menu's item turns to light text on dark, or dark on light, when it has the focus, or when the arrows of a search box or the mouse have lit it. Its hint and value turn with it, dimmed on an ordinary item and at full strength on a destructive one, so they keep 4.5:1 on the red. Menus and dialogs carry a highlight along their top edge, and the search box at the top of a menu carries it over its opaque fill.
- **The shell.** `public/ui/shell.js` draws Capcom's own shell: four plates round an eye, mirrored left to right and top to bottom, in a 24-unit box. Their outer sides curve in to four sharp points, and the shell is a little wider than it is tall. The plates take the text colour, so the shell is black on a light page and white on a dark one, with a white eye in a black socket. It is the working spinner, which breaks its plates apart and shrinks them, shows a soft core inside them, dark on a light page and light on a dark one, turns half round its eye and closes again. It is the mark beside Capcom's name, and the emblem in the empty pane, which floats and looks round every 12 seconds. It is also the icon, white on the dark page, in the browser tab and on a home screen, on the sign-in page as well as the app. The manifest's icons are the shell on a rounded tile inset like a Mac app's, with a soft gradient and a shadow. Chrome on the Mac makes the Dock icon from the manifest's maskable icon, the same tile and shell across the whole square, which it clips and shadows the same way. `scripts/make-icon.mjs` draws the icons from `public/ui/shell.js`, and the tab's icon puts a bigger shell on a rounded tile so it still reads at 16 pixels.
- **Type.** Geist stays. Group headers and menu section labels are uppercase with wide letter spacing, and nothing else is.
- **Motion.** Every Ghost animation runs only when the system has no wish for less motion. With less motion the spinner is a still shell with its eye lit.
- **Widgets** keep the standard colours, because the widget frame's palette has to match `--widget-card`.

### Consequences

- ✅ Every device gets the Ghost look with nothing to press, and a device that kept the standard look under the earlier switch is on Ghost from its next load.
- ✅ The Ghost look is one stylesheet, one drawing and one attribute on the root, so it is small to change or remove.
- ❌ Safari, which every iPhone browser uses, does not support `corner-shape` yet, so on a phone the corners are near square rather than cut.
- ❌ There are two looks to keep in step. A new component needs a check in the Ghost look too.
- ❌ Uppercase group names are wider, so a long name is cut off sooner.

## Pros and Cons of the Options

### A second look in its own stylesheet, scoped under an attribute on the root and set on every device

- ✅ A page without the attribute keeps the standard look, because no Ghost rule applies without it.
- ❌ Each Ghost rule has to win over app.css's, so a few selectors are longer than they would be in one stylesheet.

### Replace the standard look with the Ghost look

- ✅ One look to maintain.
- ❌ Throws away the shadcn/ui look, which the sign-in and setup pages use.

### A second set of colours only

- ✅ The least work.
- ❌ Colour alone does not read as a shell. The cut corners, the eyes and the spinner carry the idea.

## Credits

The Ghost look is inspired by the Ghost in Destiny. Capcom has no connection with Bungie or Destiny, and nothing in the look comes from the game: the shell drawing, the palette, the shapes and the motion are Capcom's own, under its MIT licence. Geist is the font of the standard look, under the SIL Open Font Licence 1.1.

## Links

- Builds on [Build Capcom's look and behaviour on shadcn/ui](20261022-shadcn-design-language.md)
- Keeps the contract in [Draw widgets the way Desktop does](20261019-widgets-render-like-desktop.md)
- CSS `corner-shape`: https://drafts.csswg.org/css-borders-4/#corner-shaping
