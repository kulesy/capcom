# The page

How the page is built: Preact and htm with no build step, the vendored libraries, the browsers it needs, the main files and what the server sends before sign-in.

## Libraries and browsers

The page is a Preact app written with htm templates, so it runs straight from `public/` with no build step and no `npm install`. The repo vendors Preact, its hooks and htm in `public/vendor/`, and an import map in `public/index.html` points their bare names at those files. `public/vendor/README.md` has the versions, the checksums and how to update them.

The browser needs import maps: Safari 16.4, Chrome 89 or Firefox 108 and later.

## Main files

- `public/app.js` holds the routes and the session list's data, and mounts the app.
- `public/ui/session.js` is one open chat. It reads the transcript, follows the live event stream and sends everything you do. The other files in `public/ui/` are components that draw what it holds, and small helpers.
- `public/md.mjs` renders Claude's Markdown. It escapes everything first, so a reply cannot inject markup.

## What the server sends before sign-in

The server sends the files in `public/` that end in `.js`, `.mjs`, `.css` or `.png` before anyone signs in, so keep anything private out of that folder. `public/login.js` and `public/ui/webauthn.js` run on the sign-in page, so they import nothing beyond each other.

## Licence

GhostShell is MIT (see [LICENSE](../LICENSE)). The libraries in `public/vendor/` keep their own licences, which sit next to them: MIT for Preact and the Tabler icons, Apache-2.0 for htm, and the SIL Open Font License 1.1 for the Geist fonts.
