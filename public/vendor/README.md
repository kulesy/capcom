# Vendored libraries

The page runs on Preact with htm. Nothing is installed or built. These files are copied unchanged from
the npm tarballs and served as they are. The import map in `index.html` maps the bare names `preact`,
`preact/hooks` and `htm` to them. The Tabler files are not in the import map: the widget host reads the
stylesheet for its list of icon names and hands the font to a widget's frame as bytes (`ui/widget.js`).
The Geist files are not in the import map either: `app.css` declares them with `@font-face`, and
`index.html` preloads `geist-latin.woff2`.

| File | Package | File inside the tarball | License | SHA-256 of the file |
| --- | --- | --- | --- | --- |
| `preact.mjs` | `preact@11.0.1` | `package/dist/preact.mjs` | MIT, see `LICENSE-preact` | `3a3201e9ccef7d30ef1273427f1b17ef8323e464b2c8d73b4fd5636af730433e` |
| `hooks.mjs` | `preact@11.0.1` | `package/hooks/dist/hooks.mjs` | MIT, see `LICENSE-preact` | `6cb79fe9959ad185b8b86134aff47c12fd20216b24837597b19be59a133d9947` |
| `htm.mjs` | `htm@3.1.1` | `package/dist/htm.mjs` | Apache-2.0, see `LICENSE-htm` | `ab33dd3f38059b9be4d5f5350128eefb2356639c4e0bbe9d9e8b3ba75847e9e4` |
| `tabler-icons.min.css` | `@tabler/icons-webfont@3.48.0` | `package/dist/tabler-icons.min.css` | MIT, see `LICENSE-tabler-icons` | `e5d3dd86f713f548e8603de831d2d4de0cbf0de2d4479778abf51cccb5e84373` |
| `tabler-icons.woff2` | `@tabler/icons-webfont@3.48.0` | `package/dist/fonts/tabler-icons.woff2` | MIT, see `LICENSE-tabler-icons` | `dafbdda4cb0cdcb2cc0696a10314360dfee7fbc59d4195ec7a81c95d41e65f07` |
| `geist-latin.woff2` | `next@15.5.4` | `package/dist/next-devtools/server/font/geist-latin.woff2` | OFL-1.1, see `LICENSE-geist` | `1b5ebfb3a01a97343ac96873e6d59a8cb285c66012b6a1ac509cb2765e995ba8` |
| `geist-latin-ext.woff2` | `next@15.5.4` | `package/dist/next-devtools/server/font/geist-latin-ext.woff2` | OFL-1.1, see `LICENSE-geist` | `f7604a53a00250f66db4b47dd44327ce2a43f6edec850d5217bb80238819efdd` |
| `geist-mono-latin.woff2` | `next@15.5.4` | `package/dist/next-devtools/server/font/geist-mono-latin.woff2` | OFL-1.1, see `LICENSE-geist` | `b7ac144b394cbd81052d6397ec0c33397977b1d7e9bc095e744e652a378c6fb3` |
| `geist-mono-latin-ext.woff2` | `next@15.5.4` | `package/dist/next-devtools/server/font/geist-mono-latin-ext.woff2` | OFL-1.1, see `LICENSE-geist` | `7d5609538a79545ec945e019771ed562e2c65a6c1c3c4ccc4ea34372e277c396` |

The tarballs come from the official npm registry and were checked against the registry's own digest
(`npm view <package>@<version> dist.integrity`) before use:

- `preact@11.0.1`: `sha512-TNNwEq++jYNHy747LziCjPRVgEwnLSOIOAw/oYcjI3Tdnubx2EXtt76I0an8PATvUWtx/DX1kFIg1eFN+O/fkw==`
- `htm@3.1.1`: `sha512-983Vyg8NwUE7JkZ6NmOqpCZ+sh1bKv2iYTlUkzlWmA5JD2acKoxd4KVxbMmxX/85mtfdnDmTFoNKcg5DGAvxNQ==`
- `@tabler/icons-webfont@3.48.0`: `sha512-Cwqm0qkn6qqBeoBwDt9nFeMSFnRbwoC3e6y4u+weSroj4lecaFhTUfe2T24/ByQA6Rjn9tq76VhT5PL+5czhAw==`
- `next@15.5.4`: `sha512-xH4Yjhb82sFYQfY3vbkJfgSDgXvBB6a8xPs9i35k6oZJRoQRihZH+4s9Yo2qsWpzBmZ3lPXaJ2KPXLfkvW4LnA==`

`htm` is Apache-2.0, not MIT, so its license text is kept next to the file. `preact.mjs` and `hooks.mjs`
end with a `sourceMappingURL` comment. The maps are not shipped, so browser developer tools report them
missing.

`LICENSE-tabler-icons` is `package/LICENSE` from the Tabler tarball. Only the outline font is vendored, not
the filled one. The stylesheet still names the `.woff` and `.ttf` files beside the font, which are not
shipped, because the page never links the stylesheet.

The Geist files are the `latin` and `latin-ext` subsets of Geist and Geist Mono that `next` ships for its
development overlay. Each is a variable font with one `wght` axis from 100 to 900 (default 400), version
1.401, with no italics, so `app.css` declares them as `font-weight: 100 900`, with the unicode ranges
Google Fonts gives its subsets of the same names. `index.html` preloads only `geist-latin.woff2`, because
the server sends `public/` with `no-cache` and a page in English draws only from that subset.
The `next` tarball has no license file for the fonts. `LICENSE-geist` is the SIL Open Font License 1.1
under the copyright line in the fonts' own name table, which also names `https://openfontlicense.org`.

## Updating

1. `npm pack <package>@<version>` into a new, empty directory, and compare the tarball's SHA-512 (base64,
   prefixed `sha512-`) with `npm view <package>@<version> dist.integrity`.
2. Extract it into another new, empty directory, and copy over the files in the table, with the license.
3. Update the versions, digests and checksums here.
