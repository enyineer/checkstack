---
"@checkstack/ui": patch
"@checkstack/backend-api": patch
"@checkstack/backend": patch
---

Address open CodeQL code-scanning findings:

- **`@checkstack/ui` (`LinksEditor`)**: validate URL scheme on render and on
  add; only `http:` / `https:` URLs are accepted, defeating stored XSS via
  `javascript:` / `data:` schemes in user-supplied hotlinks
  (`js/xss-through-dom`).
- **`@checkstack/backend-api` (`markdownToPlainText`)**: decode HTML entities
  before stripping tags, then strip tags in a loop until the output
  stabilizes. Decoding `&amp;` last avoids reintroducing tag delimiters
  via `&amp;lt;` round-trips (`js/double-escaping`,
  `js/incomplete-multi-character-sanitization`).
- **`@checkstack/backend` (`createScopedWsRegistry`)**: drop the
  identity-replacement on the path suffix; the leading-slash invariant
  is documented on `WebSocketRouteRegistry` (`js/identity-replacement`).
