---
"@checkstack/auth-frontend": patch
---

Stop firing the authenticated-only capability RPCs (`canCreate`,
`myManageableTypes`, `listMyAccessibleResources`) for anonymous sessions. The
`AccessApi` capability hooks fell through to the team-derived path whenever the
global rule was absent - including for guests, whose requests can only fail and
spam the backend log with 401 "Authentication required" errors. The queries are
now additionally gated on `isAuthenticated`; anonymous callers resolve from the
global (anonymous-role) rules alone, which is also the only access they can
hold.
