---
"@checkstack/auth-frontend": patch
---

Redirect anonymous visitors from `/auth/profile` to the login page instead of
rendering the profile skeleton and firing the authenticated-only
`getCurrentUserProfile` query into a guaranteed 401. The profile query now
only runs once a signed-in session is resolved.
