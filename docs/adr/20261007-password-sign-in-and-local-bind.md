# Protect Capcom with a password, a local-only bind and a private network

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-07
- Tags: security, authentication, network, sub-path

## Context and Problem Statement

Anyone who signs in to Capcom can run commands on the Mac as the owner. Session transcripts can also hold tokens and other secrets. On 7 Oct the owner weighed three hardening steps: a separate address for Capcom, a second password prompt for Bypass, and a shorter sign-in.

Should Capcom add any of them before use?

## Decision Drivers

- Signing in is equivalent to a shell, so the password has to hold.
- Only the owner's own devices should reach Capcom.
- The owner wants to use Capcom from a phone.

## Considered Options

1. A password, a local bind and a private network, with no further hardening
2. Option 1 plus a separate address for Capcom
3. Option 1 plus a second password prompt for Bypass
4. Option 1 plus a shorter sign-in

## Decision Outcome

Chosen option: "A password, a local bind and a private network, with no further hardening", because only the owner's own devices can reach Capcom.

- Capcom stores the password only as a scrypt hash in the state folder (`lib/auth.mjs`).
- A browser that signs in gets a random token in a 30-day cookie, `HttpOnly` and `SameSite=Strict`.
- Ten wrong guesses within 15 minutes lock sign-in until the oldest of them is 15 minutes old.
- Capcom binds to 127.0.0.1. A reverse proxy or a private network the owner trusts carries phone access.
- It works under a sub-path such as `/chat`. The page uses relative URLs, a script in `index.html` adds the trailing slash, the proxy strips the prefix, and the cookie sets no `Path`, so it stays scoped to the sub-path.

**Amended 2026-10-15.** The owner's other local apps share Capcom's host name under other paths, and the owner kept that for clean addresses. A browser treats them as one site, so the same-origin check on writes and `SameSite=Strict` do not stop a script bug in one of them from acting through Capcom with the owner's cookie. The owner says those apps escape untrusted text, so the risk is low. A separate port or host name would remove it.

### Consequences

- ✅ Only a device on the private network can reach Capcom, and sign-in still needs the password.
- ❌ A browser that has signed in stays signed in for 30 days.
- ❌ One wrong-guess count covers all clients, so a stranger's guesses can lock the owner out for up to 15 minutes.
- ❌ The shared host name leaves the neighbour risk above.

## Pros and Cons of the Options

### No further hardening

- ✅ Nothing extra to build or use
- ❌ Leans on the private network and the password alone

### A separate address

- ✅ Removes the neighbour risk
- ❌ Gives up the clean shared address

### A second prompt for Bypass

- ✅ Guards the mode that runs commands without asking
- ❌ More friction on the phone

### A shorter sign-in

- ✅ Limits how long a lost device stays signed in
- ❌ More frequent sign-ins

## Links

- [Public repository under MIT](20261013-public-repo-under-mit.md)
- [No dependencies, no build step](20261007-no-dependencies-no-build-step.md)
