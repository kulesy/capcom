# Remote access

How to reach GhostShell from a phone or another computer: the reverse proxy, https, cookies, the picture cache, passkeys, request sizes and the security risk.

## Reverse proxy

GhostShell binds to 127.0.0.1 only, so no other device can reach it directly. To use it from a phone or another computer, put a reverse proxy or a private network you trust in front of it.

## Sub-path

GhostShell works when mounted under a sub-path such as `/chat`. Every URL in the page is relative, and the page adds its own trailing slash. The proxy must strip the prefix before the request reaches GhostShell.

## https, `X-Forwarded-Proto` and `Host`

If the proxy ends https, it must send `X-Forwarded-Proto: https`, which nginx does with `proxy_set_header X-Forwarded-Proto $scheme;`. GhostShell then adds `Secure` to the sign-in cookie.

GhostShell also takes a write only when the page's address, in the `Origin` header, matches the `Host` and the scheme of the request. A proxy that ends https and leaves the header out, or that does not pass the original `Host` on (`proxy_set_header Host $host;` in nginx), gets a 403 on every write, sign-in included.

GhostShell believes the header only on a connection from this Mac (127.0.0.1 or ::1), so a client that reached GhostShell some other way could not switch `Secure` on. GhostShell listens on 127.0.0.1 only, so the test passes for every connection today.

An http address keeps working, because it sends no such header.

## Cookies

The sign-in cookie is `HttpOnly` and `SameSite=Lax`. A signed-in browser that follows a link to GhostShell from another website arrives signed in, and the cookie is not sent with a form or script request from that website.

The terminal routes ask for more than the cookie (see [who can run one](terminal.md#who-can-run-one)).

## The picture cache and Clear-Site-Data

The browser keeps each picture it has shown for a year, so a chat opens fast. A picture comes with `Vary: Cookie`, so the browser reuses its copy only while it holds the sign-in cookie it fetched the picture with. Once Sign out has cleared that cookie, or the cookie has run out, opening a picture's address asks GhostShell again and gets a 401.

Sign out also sends `Clear-Site-Data: "cache"`, and Chrome and Edge, and Firefox from version 138, then delete their copies, at an https address or at localhost. Safari 27 keeps its copies, and so does any browser at a plain http address, but neither shows one without the cookie.

After a new password ends every sign-in, a browser keeps its old cookie until it signs in again, and until then it can show a picture it kept. Sign out clears that cookie too, but only from a tab that has not yet gone back to the sign-in page.

## Passkeys over https

A phone that reaches GhostShell over plain http, as on a private network without https, signs in with the password only, and the sign-in page says why. To use passkeys remotely, serve GhostShell over https and list the address in `config.local.json`:

```json
{ "passkeyOrigins": ["https://capcom.example.com"] }
```

Restart GhostShell after a change. See [`passkeyOrigins`](configuration.md#passkeyorigins) for the entry format, and [passkeys](setup.md#passkeys) for adding one.

A passkey belongs to a host name, so one made on `capcom.example.com` does not work on another name. An IP address cannot have passkeys, which includes http://127.0.0.1:4310, so use localhost there. GhostShell believes the localhost address only for a request that reaches it as localhost, with no `X-Forwarded-*` or `Forwarded` header, so a proxy cannot hand it to a page on another device.

## Request sizes

A message with images can be about 53 MB, because the page sends them as base64 inside the request. The proxy has to let a request that large through, and nginx, for one, refuses more than 1 MB until `client_max_body_size` says otherwise. GhostShell itself takes that size only on the routes that send a message or start a session, and keeps 1 MB on every other route.

A file goes up on its own, as the raw request body, to `api/uploads`, and that route takes up to 30 MB, so the proxy has to allow that too.

## Security

The password, and any passkey you add, is the only thing between that address and a shell on this machine. Anyone who signs in can run commands as you.

GhostShell locks sign-in for 15 minutes after ten failed tries with the password or a passkey. Pick a long password and keep the address private.

A lost phone stays signed in until its sign-in runs out (see [how long a sign-in lasts](setup.md#how-long-a-sign-in-lasts)). Set a new password with `npm run set-password`. [Setup](setup.md#set-the-password-and-start-the-server) says what that does to signed-in browsers and passkeys.
