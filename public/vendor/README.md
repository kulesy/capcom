# Vendored libraries

The page runs on Preact with htm. Nothing is installed or built. These files are copied unchanged from
the npm tarballs and served as they are. The import map in `index.html` maps the bare names `preact`,
`preact/hooks` and `htm` to them.

| File | Package | File inside the tarball | License | SHA-256 of the file |
| --- | --- | --- | --- | --- |
| `preact.mjs` | `preact@11.0.1` | `package/dist/preact.mjs` | MIT, see `LICENSE-preact` | `3a3201e9ccef7d30ef1273427f1b17ef8323e464b2c8d73b4fd5636af730433e` |
| `hooks.mjs` | `preact@11.0.1` | `package/hooks/dist/hooks.mjs` | MIT, see `LICENSE-preact` | `6cb79fe9959ad185b8b86134aff47c12fd20216b24837597b19be59a133d9947` |
| `htm.mjs` | `htm@3.1.1` | `package/dist/htm.mjs` | Apache-2.0, see `LICENSE-htm` | `ab33dd3f38059b9be4d5f5350128eefb2356639c4e0bbe9d9e8b3ba75847e9e4` |

The tarballs come from the official npm registry and were checked against the registry's own digest
(`npm view <package>@<version> dist.integrity`) before use:

- `preact@11.0.1`: `sha512-TNNwEq++jYNHy747LziCjPRVgEwnLSOIOAw/oYcjI3Tdnubx2EXtt76I0an8PATvUWtx/DX1kFIg1eFN+O/fkw==`
- `htm@3.1.1`: `sha512-983Vyg8NwUE7JkZ6NmOqpCZ+sh1bKv2iYTlUkzlWmA5JD2acKoxd4KVxbMmxX/85mtfdnDmTFoNKcg5DGAvxNQ==`

`htm` is Apache-2.0, not MIT, so its license text is kept next to the file. `preact.mjs` and `hooks.mjs`
end with a `sourceMappingURL` comment. The maps are not shipped, so browser developer tools report them
missing.

## Updating

1. `npm pack <package>@<version>` into a new, empty directory, and compare the tarball's SHA-512 (base64,
   prefixed `sha512-`) with `npm view <package>@<version> dist.integrity`.
2. Extract it into another new, empty directory, and copy over the files in the table, with the license.
3. Update the versions, digests and checksums here.
