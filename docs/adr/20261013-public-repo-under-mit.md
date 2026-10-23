# Publish Capcom as a public repository under the MIT licence

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-13
- Tags: licence, open-source, configuration, history

## Context and Problem Statement

Capcom began in a private repository with the owner's own setup in it: machine names, a private network address and a personal launchd file. On 13 Oct the owner chose to make it public. For that, the code had to work on any Mac, and the history held the owner's setup.

Under which licence, and with what history, should Capcom go public?

## Decision Drivers

- Anyone can run their own copy.
- Machine-specific values stay out of the repo.
- The earlier personal setup stays unpublished.

## Considered Options

1. Public under MIT
2. Public under another licence
3. Keep it private

## Decision Outcome

Chosen option: "Public under MIT", because MIT is permissive and the owner wants others to be able to run and change their own copy.

- `LICENSE` is MIT.
- Machine-specific values go in a git-ignored `config.local.json`, which overrides `config.json` (`lib/config.mjs`). The machine name and the path to `claude` are two examples.
- `npm run install-agent` fills in `launchd/capcom.plist.template` with the reader's own paths. It replaces the personal launchd file.
- The docs describe remote access in general terms: a reverse proxy or a private network the reader trusts.
- The owner had the history squashed to one fresh commit before the repo went public, so the earlier personal setup stayed unpublished.

### Consequences

- ✅ Anyone can run or fork Capcom.
- ✅ Per-machine values stay out of the repo.
- ❌ The public history starts at the squashed commit. The earlier commits stay private.
- ❌ Anyone who runs a copy takes on the sign-in risk described in the [sign-in decision](20261007-password-sign-in-and-local-bind.md), because a signed-in browser can run commands.

## Pros and Cons of the Options

### Public under MIT

- ✅ Few conditions on people who copy it
- ❌ Strangers can read how sign-in works

### Public under another licence

- ✅ Could add conditions, such as sharing changes back
- ❌ More conditions for anyone who wants to use it

### Keep it private

- ✅ No exposure of the code
- ❌ Others cannot run or improve it

## Links

- [Password sign-in and local bind](20261007-password-sign-in-and-local-bind.md)
- [No dependencies, no build step](20261007-no-dependencies-no-build-step.md)
