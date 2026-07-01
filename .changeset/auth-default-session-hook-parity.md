---
"@checkstack/auth-frontend": patch
---

Fix a rules-of-hooks violation on initial load. The inert `defaultAuthApi`
(registered before the auth plugin loads) had a `useSession` that returned a
static object and called NO hooks, while the real implementation calls
`useSessionContext()` (one hook). When the API registry swapped the default for
the real implementation mid-load, shell components that read
`authApi.useSession()` (via `useAccessRules` / the help menu) changed their hook
count between renders, producing "Rendered fewer/more hooks than expected" /
"change in the order of Hooks" errors (e.g. in `NavList` and `HelpMenu`). The
default now reads the same `SessionProvider` context as the real one, so the
hook signature is identical across the swap.
