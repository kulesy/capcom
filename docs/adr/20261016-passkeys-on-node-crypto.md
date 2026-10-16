# Sign in with passkeys that Capcom checks itself on node:crypto, against a list of origins

- Status: Accepted
- Deciders: Eli
- Date: 2026-10-16
- Tags: security, authentication, passkeys, webauthn, no-dependencies

## Context and Problem Statement

Capcom has one way in, a long password, and a phone keyboard makes that slow to type. A browser or password manager can sign in with a passkey instead. The owner taps a fingerprint, a face or a screen lock, the device signs a challenge, and Capcom checks the signature against a public key it stored earlier. Signing in is the same as getting a shell, so the check has to be right. Capcom has no npm dependencies, and it is reached under several addresses: `localhost`, a private network and a reverse proxy.

How should Capcom add passkeys?

## Decision Drivers

- Signing in on a phone should not need a long typed password.
- A mistake in the check lets a stranger in, so the code has to be short enough to read in one sitting and tested with real WebAuthn messages.
- Capcom keeps to Node's standard library ([no dependencies](20261007-no-dependencies-no-build-step.md)).
- A passkey is tied to one host name, its RP ID, and Capcom answers under more than one.
- Browsers offer passkeys only on https pages and on `localhost`.

## Considered Options

1. A WebAuthn library from npm
2. Capcom's own checks on `node:crypto`, with a list of allowed origins
3. Capcom's own checks, with the RP ID taken from the `Host` header
4. No passkeys

## Decision Outcome

Chosen option: "Capcom's own checks on `node:crypto`, with a list of allowed origins", because it keeps the no-dependency rule and leaves the owner in charge of which addresses may hold passkeys.

- `lib/webauthn.mjs` checks a registration and a sign-in, `lib/cbor.mjs` decodes the attestation object and the COSE key, and `lib/passkeys.mjs` keeps the store and the challenges. Together they are about 370 lines. `node:crypto` verifies the signature, using a JWK built from the COSE key. ES256, EdDSA and RS256 are accepted.
- The allowed origins are `http://localhost:<port>` and the https entries in `passkeyOrigins`. `config.json` holds an empty list and the git-ignored `config.local.json` holds the real addresses. The page sends `location.origin`, the server believes it only when it is on the list, and the RP ID is that origin's host name. The `Host` header never picks it. An IP address cannot be an RP ID, so the config reader drops any entry that is not https with a host name, and `127.0.0.1` has no passkeys. Capcom believes the localhost origin only on a request that reached it as `localhost`, with no `X-Forwarded-*` or `Forwarded` header. A passkey for `localhost` belongs to that name and not to this Mac, so without this a page on another device could fetch a localhost challenge through the proxy and have the owner sign it.
- A passkey is added from a signed-in session. Capcom asks for a discoverable credential with user verification and no attestation, lists the passkeys already added so a device is not added twice, and uses one random user handle for the whole install. It refuses a key that anyone could sign for, which means an RSA key under 2048 bits or with an exponent other than 65537, and an Ed25519 key on one of the eight points of small order.
- A challenge is random, tied to its kind and origin, spent the first time it is looked up and dropped after 5 minutes. At most 200 wait at once.
- A sign-in checks the type, challenge and origin in `clientDataJSON`, the RP ID hash, the user-present and user-verified flags, and the signature over the authenticator data and the hash of `clientDataJSON`. Once both the stored and the new sign count are above zero, it refuses a count that does not increase.
- A good sign-in issues the same token and cookie as the password. A refused one counts toward the same lockout, ten failures in 15 minutes.
- `passkeys.json` in the state folder, mode 0600, holds each passkey's id, public key, algorithm, RP ID, sign count, created and last-used times and a device label.
- The page shows the passkey parts only where they can work. On a plain http address other than `localhost`, or on an IP address, it hides them, and the sign-in page says why in one line.
- Removing a passkey in the page deletes Capcom's record. The device or password manager keeps its copy until the owner deletes it there. `npm run set-password` signs every browser out and leaves passkeys alone.

### Consequences

- ✅ Nothing new to install, and the code that decides who gets in is three short files.
- ✅ A passkey made for one host name cannot sign in at another, and a forged `Host` header cannot add a name to the list.
- ✅ Signing in on a phone takes one tap.
- ❌ Capcom owns the parsing and the checks. The tests build real attestation and assertion messages from P-256 and Ed25519 keys, and a Chrome run with a virtual authenticator passed. No hardware key, Safari or password manager has been tried.
- ❌ Capcom does not check attestation statements, so it cannot tell what kind of authenticator made a passkey.
- ❌ The plain-http private network address cannot use passkeys. It needs https and an entry in `passkeyOrigins`.
- ❌ A passkey removed in Capcom can still appear in the password manager's list, and picking it fails.
- ❌ Failed passkey attempts and wrong passwords share one lockout, so a stranger can lock both out for up to 15 minutes.

## Pros and Cons of the Options

### A WebAuthn library from npm

- ✅ Maintained by people who follow each browser's quirks
- ❌ Breaks the no-dependency rule and puts `npm install` into setup, for a check that fits in a few hundred lines

### Capcom's own checks, with a list of origins

- ✅ No dependency, and the owner names the addresses
- ❌ Capcom carries the code, and a new address needs a line of config

### The RP ID from the Host header

- ✅ Nothing to configure
- ❌ The server would accept whatever name arrives in the header, including names it was never meant to serve, so the RP ID check would prove nothing

### No passkeys

- ✅ Nothing to build
- ❌ A long password on a phone keyboard stays the only way in

## Links

- [Protect Capcom with a password, a local-only bind and a private network](20261007-password-sign-in-and-local-bind.md), amended 2026-10-16 for the year-long sign-in
- [Build Capcom on Node's standard library and plain browser files](20261007-no-dependencies-no-build-step.md)
