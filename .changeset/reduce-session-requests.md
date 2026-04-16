---
"@checkstack/auth-backend": patch
"@checkstack/auth-frontend": patch
"@checkstack/frontend": patch
---

Reduce excessive /api/auth/get-session requests

- Enable better-auth's `cookieCache` on the server (5-minute TTL) so repeated session
  checks verify a signed cookie instead of querying the database. Compatible with
  horizontal scaling since validation uses the shared `BETTER_AUTH_SECRET`.

- Introduce a `SessionProvider` React context that fetches the session exactly once
  at the top of the component tree. All 7+ components that previously called
  `useSession()` independently now read from this shared context — eliminating
  duplicate HTTP requests on every page load.

- Remove the `useAuthClient()` hook which created per-component better-auth client
  instances via `useMemo`, causing separate nanostore atoms and independent fetches.
  All imperative usages (signIn, signUp, resetPassword, etc.) now use the singleton
  `getAuthClientLazy()` instead.
